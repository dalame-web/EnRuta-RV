/* RV Iryo — Registro de Viajes
 * Toda la lógica de la app: modelo, almacenamiento, calendario, editor de
 * turno, exportación PDF, estadísticas y ajustes. Vanilla JS, sin frameworks.
 * El Libro de Horarios se embebe vía horarios.js (window.RV_HORARIOS), así
 * funciona también abriendo el archivo directamente (file://) y sin conexión.
 */
(function () {
  'use strict';

  function normName(n) { return (n || '').toUpperCase().replace(/[-\s]+/g, ' ').trim(); }

  // ===== Constantes =====
  var K_TURNOS = 'rviryo_turnos_v1';
  var K_SETTINGS = 'rviryo_settings_v1';
  var APP_VERSION = 'enruta-v34';

  var COMPROBACIONES = [
    'Arranque rama', 'Estado Pantógrafo', 'DAT/DHLTV', 'ASFA', 'ETCS/LZB',
    'Datos Tren', 'Prueba estanqueidad', 'Prueba de freno (Básica/Instrumental)',
    'Prueba HM', 'Enclavamientos', 'Luces gran intensidad / limpia',
    'Registro GSM-R', 'Puertas'
  ];

  var DEFAULT_RAMAS = [];
  for (var r = 1; r <= 23; r++) DEFAULT_RAMAS.push(r < 10 ? '0' + r : '' + r);

  // ===== Telefonemas (Libro de Telefonemas del Maquinista, LNM-ILSA_AP2) =====
  // Atajos de Observaciones: mismo mecanismo de "partes" que TELEFONEMAS
  // (texto fijo + campos a rellenar), pero sin nada de lo que rodea a un
  // telefonema — no se persisten, no son reabribles, solo insertan una
  // línea de texto plano en Observaciones. Un campo con "options" se pinta
  // como <select> en vez de <input>. Añadir un atajo nuevo = un objeto más
  // aquí, sin tocar el resto del código.
  var OBS_ATAJOS = [
    { id: 'vmeta0', label: 'Vmeta = 0', partes: [
      { t: 'text', v: 'Vmeta = 0 en el PK ' },
      { t: 'campo', id: 'pk', label: 'PK' },
      { t: 'text', v: ' y se valida en ' },
      { t: 'campo', id: 'tipoValidacion', label: 'Se valida en', options: ['Pantalla', 'Señal'] },
      { t: 'text', v: ' ' },
      { t: 'campo', id: 'numeroValidacion', label: 'Número' }
    ] },
    { id: 'vmeta40', label: 'Vmeta = 40', partes: [
      { t: 'text', v: 'Vmeta = 40 en el PK ' },
      { t: 'campo', id: 'pk', label: 'PK' },
      { t: 'text', v: ' y se valida en ' },
      { t: 'campo', id: 'tipoValidacion', label: 'Se valida en', options: ['Pantalla', 'Señal'] },
      { t: 'text', v: ' ' },
      { t: 'campo', id: 'numeroValidacion', label: 'Número' }
    ] },
    { id: 'mv', label: 'Marcha a la Vista (MV)', partes: [
      { t: 'text', v: 'Se realiza MV (Marcha a la Vista) desde el PK ' },
      { t: 'campo', id: 'pkDesde', label: 'PK desde' },
      { t: 'text', v: ' al PK ' },
      { t: 'campo', id: 'pkHasta', label: 'PK hasta' },
      { t: 'text', v: '. Se comunica al CRC que ' },
      { t: 'campo', id: 'siNo', label: 'Observa', options: ['SI', 'NO'] },
      { t: 'text', v: ' observa ' },
      { t: 'campo', id: 'observa', label: 'Qué se observa' }
    ] },
    { id: 'parada', label: 'Punto de parada', partes: [
      { t: 'text', v: 'Detenido ante la ' },
      { t: 'campo', id: 'tipo', label: 'Tipo', options: ['Señal', 'Pantalla'] },
      { t: 'text', v: ' ' },
      { t: 'campo', id: 'numero', label: 'Número' },
      { t: 'text', v: ', se reanuda la marcha con ' },
      { t: 'campo', id: 'condiciones', label: 'Condiciones' }
    ] },
    { id: 'crc', label: 'Comunica al CRC', partes: [
      { t: 'text', v: 'Se comunica al CRC que se observa ' },
      { t: 'campo', id: 'observa', label: 'Qué se observa' },
      { t: 'text', v: ' en el PK ' },
      { t: 'campo', id: 'pk', label: 'PK' }
    ] },
    { id: 'balizas', label: 'Error lectura grupo de balizas', partes: [
      { t: 'text', v: 'Error lectura grupo de baliza, el error en el PK ' },
      { t: 'campo', id: 'pkError', label: 'PK del error' },
      { t: 'text', v: ', me detengo en el PK ' },
      { t: 'campo', id: 'pkDetencion', label: 'PK detención' },
      // Tramo condicional: si no se rellena, no deja ni rastro en el
      // texto final (ni el prefijo ni un hueco vacío).
      { t: 'campoCondicional', id: 'obs', label: 'Observaciones', prefijo: '. Observaciones: ' }
    ] }
  ];

  // Mapeo ruta → línea para Estadísticas (punto 6). Sin sentido de
  // dirección: Madrid→Barcelona y Barcelona→Madrid cuentan igual como
  // L50. Confirmado con el usuario. Traslados/maniobras (sin origen o
  // destino real) no encajan en ninguna línea.
  var LINEAS_RUTA = [
    { linea: 'L50', a: 'MADRID-P.ATOCHA-ALMUDENA GRANDES', b: 'BARCELONA-SANTS' },
    { linea: 'L10', a: 'MADRID-P.ATOCHA-ALMUDENA GRANDES', b: 'SEVILLA-SANTA JUSTA' },
    { linea: 'L30', a: 'MADRID-P.ATOCHA-ALMUDENA GRANDES', b: 'MALAGA MARIA ZAMBRANO' },
    { linea: 'L40', a: 'MADRID-CHAMARTIN-CLARA CAMP.', b: 'VALENCIA-JOAQUIN SOROLLA' },
    { linea: 'L42', a: 'MADRID-CHAMARTIN-CLARA CAMP.', b: 'ALACANT-TERMINAL' }
  ];
  function lineaDeServicio(s) {
    if (!s.origen || !s.destino) return null;
    var r = LINEAS_RUTA.find(function (x) {
      return (x.a === s.origen && x.b === s.destino) || (x.a === s.destino && x.b === s.origen);
    });
    return r ? r.linea : null;
  }

  // Cada variante se compone de "partes": texto fijo, campos a rellenar (con
  // pista opcional de las opciones entre paréntesis del original) y bloques
  // opcionales (corchetes en el original) que se incluyen o no con una casilla.
  // Añadir más categorías/variantes aquí sigue el mismo patrón.
  var TELEFONEMAS = [
    {
      cat: 'ETC', catLabel: 'ETCS', color: 'rc',
      nombre: 'Autorización de rebase y reanudación de la marcha en ETCS',
      variantes: [
        {
          codigo: 'ETC1', nombre: 'Rebase de EoA',
          guia: 'Cuando sea necesario autorizar el rebase de una EoA',
          viaBanalizada: true,
          advertencias: [
            'Cuando se trate de una señal que da acceso a una *vía doble banalizada*, se indicara la vía (I, II, etc) por la que el tren va ha circular.',
            'Siempre se prescribirá *marcha a la vista* hasta la siguiente señal que pueda ordenar parada, salvo el RC tenga seguridad de que la vía no se encuentra ocupada.',
            'En ETCS Nivel 2, aunque se transite tras el rebase a FS no se considerara circulando en dicho modo hasta rebasar la siguiente pantalla o señal que pueda dar parada y esta autorice su paso.',
            'Si circulando en N0+ASFA en la señal a rebasar se produce la *transición* a Nivel 1, se deberá actuar sobre el rebase del ASFA y del ETCS.',
            '*Atención con las velocidades máximas del tramo, LTV y situación de señales y Zonas Neutras.*'
          ],
          partes: [
            { t: 'text', v: 'Autorizo al Maquinista de tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' para rebasar el EoA de ' },
            { t: 'campo', id: 'punto', label: 'Punto', hint: 'km, señal, pantalla ETCS, estación, puesto, bifurcación, etc.' },
            { t: 'text', v: ' con ' },
            { t: 'campo', id: 'cond', label: 'Condiciones de circulación', hint: 'condiciones de circulación' },
            { t: 'text', v: '.' }
          ]
        },
        {
          codigo: 'ETC2', nombre: 'Rebase indebido EoA',
          guia: 'Para la reanudación de la marcha tras el rebase indebido de una EoA',
          advertencias: [
            'Cumplimentar el telefonema hasta donde se haya notificado.',
            'En ETCS Nivel 2, aunque se transite tras el rebase a FS no se considerara circulando en dicho modo hasta rebasar la siguiente pantalla o señal que pueda dar parada. Una vez rebasado alguno de los puntos mencionados, si continua en FS, el telefonema perderá su validez y se informara al RC.',
            '*Atención con las velocidades máximas del tramo, LTV y situación de señales y Zonas Neutras.*'
          ],
          partes: [
            { t: 'text', v: 'Autorizo al Maquinista de tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: 'a reanudar la marcha/retroceder con ' },
            { t: 'campo', id: 'cond', label: 'Condiciones de circulación', hint: 'condiciones de circulación' },
            { t: 'text', v: ' hasta ' },
            { t: 'campo', id: 'hasta', label: 'Hasta (punto)' },
            { t: 'text', v: '.' }
          ]
        },
        {
          codigo: 'ETC3', nombre: 'Desconexión y circule en BSL',
          guia: 'Cuando ordene el Responsable de Circulación por avería del sistema ETCS o necesidades de explotación u otras causas.',
          advertencias: [
            'Se circula con señalización lateral, *BSL.*',
            '*Atención con las velocidades máximas del tramo, LTV y situación de señales y Zonas Neutras.*'
          ],
          partes: [
            { t: 'text', v: 'Maquinista de tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: 'desconecte el ETCS y reanude marcha al amparo del BSL/BA/BLA con ' },
            { t: 'campo', id: 'cond', label: 'Condiciones de circulación', hint: 'condiciones de circulación' },
            { t: 'text', v: '.' }
          ]
        },
        {
          codigo: 'ETC4', nombre: 'Desconexión/conexión ETCS + nivel',
          guia: 'Por fallo del ETCS del equipo embarcado a de la infraestructura, o cuando se produzca una transición no programada a otro nivel inferior',
          advertencias: [
            'Comunicar al RC cuando se produzcan transiciones a modos o niveles no esperados.',
            '*Atención con las velocidades máximas del tramo, LTV y situación de señales y Zonas Neutras.*'
          ],
          partes: [
            { t: 'text', v: 'Maquinista de tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' ' },
            { t: 'campo', id: 'sel', label: 'Seleccione el / continúe en', hint: 'seleccione el, continúe en' },
            { t: 'text', v: ' Nivel' },
            { t: 'campo', id: 'nivel', label: 'Nivel' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'reanude', label: 'Incluir "y reanude la marcha al amparo del BCA/BSL/BA/BLA"', v: 'y reanude la marcha al amparo del BCA/BSL/BA/BLA' },
            { t: 'text', v: ' con ' },
            { t: 'campo', id: 'cond', label: 'Condiciones de circulación', hint: 'condiciones de circulación' },
            { t: 'text', v: '.' }
          ]
        },
        {
          codigo: 'ETC5', nombre: 'Fallo transición de LZB a ETCS',
          guia: 'Fallo de transición de ETCS a LZB o viceversa',
          advertencias: [
            'Si en el ETCS *se puede seleccionar* el Nivel 1 o LZB, avisar al RC y circular con "Marcha a la vista" hasta la señal siguiente con señalización lateral.',
            'En el caso de *no poder seleccionar* el Nivel 1 o LZB, seguir las condiciones de circulación del RC.',
            '*Atención con las velocidades máximas del tramo, LTV y situación de señales y Zonas Neutras.*'
          ],
          partes: [
            { t: 'text', v: 'Maquinista de tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ', desconecte y vuelva a conectar el ETCS. Seleccione el Nivel ' },
            { t: 'campo', id: 'nivel', label: 'Nivel', hint: '"0+ASFA", o "0"' },
            { t: 'text', v: ' y reanude la marcha al amparo del BSL/BA/BLA con ' },
            { t: 'campo', id: 'cond', label: 'Condiciones de circulación', hint: 'condiciones de circulación' },
            { t: 'text', v: '.' }
          ]
        },
        {
          codigo: 'ETC6', nombre: 'Transición no planificada de N2 a N0+ASFA',
          guia: 'Transición no planificada de Nivel 2 a Nivel 0+ASFA',
          advertencias: [
            'Aplicar freno de servicio y comunicar al RC, quien ordenara las condiciones de circulación.',
            '*Atención con las velocidades máximas del tramo, LTV y situación de señales y Zonas Neutras.*'
          ],
          partes: [
            { t: 'text', v: 'Maquinista de tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ', seleccione el Nivel ' },
            { t: 'campo', id: 'nivel', label: 'Nivel', hint: '2, 1' },
            { t: 'text', v: ' y reanude la marcha al amparo del BCA/BSL/BA/BLA con ' },
            { t: 'campo', id: 'cond', label: 'Condiciones de circulación', hint: 'condiciones de circulación' },
            { t: 'text', v: '.' }
          ]
        }
      ]
    },
    {
      cat: 'LZB', catLabel: 'LZB', color: 'rc',
      nombre: 'Telefonemas LZB',
      variantes: [
        {
          codigo: 'LZB1', nombre: 'Rebase de señal/pantalla',
          guia: 'Cuando sea necesario autorizar el rebase de un punto de parada',
          viaBanalizada: true,
          advertencias: [
            'Cuando se trate de una señal que da acceso a una *vía doble banalizada*, se indicara la vía (I, II, etc) por la que el tren va ha circular.',
            'Se prescribirá "*marcha a la vista*" hasta la siguiente pantalla o señal que pueda dar parada, salvo que exista total seguridad de estar el cantón libre.',
            'Cuando se recupere la transmisión, se tiene que validar en la siguiente pantalla o señal que pueda dar parada.',
            '*Atención con las velocidades máximas del tramo, LTV y situación de señales y Zonas Neutras.*'
          ],
          partes: [
            { t: 'text', v: 'Autorizo al Maquinista ' },
            { t: 'campo', id: 'sujeto', label: 'Del tren / de la maniobra', hint: 'del tren ___, de la maniobra ___' },
            { t: 'text', v: ' a rebasar la señal/pantalla ' },
            { t: 'campo', id: 'clase', label: 'Clase', hint: 'clase' },
            { t: 'text', v: 'número ' },
            { t: 'campo', id: 'num', label: 'Número' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'lugar', label: 'Incluir "de (estación, puesto, bifurcación, etc.)"', v: 'de (estación, puesto, bifurcación, etc.)' },
            { t: 'text', v: ' con ' },
            { t: 'campo', id: 'cond', label: 'Condiciones de circulación', hint: 'condiciones de circulación' }
          ]
        },
        {
          codigo: 'LZB2', nombre: 'Continuar la marcha con condiciones hasta señal/pantalla',
          guia: 'Para la reanudación de la marcha tras el rebase de un punto de parada',
          advertencias: [
            'Se prescribirá "*marcha a la vista*" y/u otras indicaciones hasta la siguiente pantalla o señal que pueda dar parada.',
            'Cuando se recupere la transmisión, se tiene que validar en la siguiente pantalla o señal que pueda dar parada.',
            '*Atención con las velocidades máximas del tramo, LTV y situación de señales y Zonas Neutras.*'
          ],
          partes: [
            { t: 'text', v: 'Autorizo a maquinista de tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' a continuar la marcha con ' },
            { t: 'campo', id: 'cond', label: 'Condiciones de circulación', hint: 'condiciones de circulación' },
            { t: 'text', v: ' hasta la ' },
            { t: 'campo', id: 'senal', label: 'Señal / pantalla', hint: 'señal o pantalla' },
            { t: 'text', v: '.' }
          ]
        },
        {
          codigo: 'LZB3', nombre: 'Continuar al amparo del BSL con Marcha a la Vista',
          guia: 'Para reanudar la marcha tras un fallo de transmisión en bloqueo parcial (Vmeta=0)',
          advertencias: [
            'Cuando se recupere la transmisión, se tiene que validar en la siguiente pantalla o señal que pueda dar parada.',
            '*Atención con las velocidades máximas del tramo, LTV y situación de señales y Zonas Neutras.*'
          ],
          partes: [
            { t: 'text', v: 'Autorizo a maquinista de tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' a continuar la marcha al amparo del BSL con "Marcha a la Vista" hasta la señal ' },
            { t: 'campo', id: 'senal', label: 'Señal', hint: 'siguiente señal de entrada o salida' }
          ]
        },
        {
          codigo: 'LZB4', nombre: 'Desconecte/conecte LZB',
          guia: 'Cuando ordene el Responsable de Circulación por avería del sistema LZB o necesidades de explotación u otras causas.',
          advertencias: [
            'Cuando el testigo de *"TRANS"* o el icono *"S"* se apaguen y no se produzca un fallo de magnitudes, efectuar detención inmediata y comunicar al RC.',
            '*Atención con las velocidades máximas del tramo, LTV y situación de señales y Zonas Neutras.*'
          ],
          partes: [
            { t: 'text', v: 'Maquinista de tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ', desconecte (y vuelva a conectar) el LZB, y reanude la marcha al amparo del BSL con ' },
            { t: 'campo', id: 'cond', label: 'Condiciones de circulación', hint: 'condiciones de circulación' }
          ]
        },
        {
          codigo: 'LZB5', nombre: 'Reanudación tras desconexión, por vía',
          // El guía original (disolución de itinerario) no corresponde a
          // este texto oficial — pendiente de que el usuario confirme el
          // texto correcto de Guía y uso.
          advertencias: [
            '*Atención con las velocidades máximas del tramo, LTV y situación de señales y Zonas Neutras.*'
          ],
          partes: [
            { t: 'text', v: 'Maquinista de tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ', desconecte y vuelva a conectar el LZB, y reanude la marcha al amparo del BSL desde la señal ' },
            { t: 'campo', id: 'senal', label: 'Señal' },
            { t: 'text', v: ' por vía ' },
            { t: 'campo', id: 'via', label: 'Vía', hint: 'I, II' },
            { t: 'text', v: '.' }
          ]
        }
      ]
    },
    {
      cat: 'ABA', catLabel: 'Anormalidad baliza', color: 'rc',
      nombre: 'Anormalidad en baliza de sistema de señalización',
      variantes: [
        {
          codigo: 'ABA', nombre: 'Anormalidad en baliza',
          partes: [
            { t: 'text', v: 'La baliza ' },
            { t: 'campo', id: 'sistema', label: 'Sistema', hint: 'ASFA, ERTMS, EBICAB, etc.' },
            { t: 'text', v: ', ' },
            { t: 'campo', id: 'posicion', label: 'Posición', hint: 'previa, de señal, etc.' },
            { t: 'text', v: ' de la señal ' },
            { t: 'campo', id: 'clase', label: 'Clase', hint: 'clase' },
            { t: 'text', v: ' número ' },
            { t: 'campo', id: 'num', label: 'Número' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'lugar', label: 'Incluir "de (estación, puesto, bifurcación, etc.)"', v: 'de (estación, puesto, bifurcación, etc.)' },
            { t: 'text', v: ', se encuentra ' },
            { t: 'campo', id: 'estado', label: 'Estado', hint: 'desplazada, fuera de servicio, etc.' },
            { t: 'text', v: '.' }
          ]
        }
      ]
    },
    {
      cat: 'ARS', catLabel: 'Rebase señal fija', color: 'rc',
      nombre: 'Autorización de rebase de señal fija fundamental',
      variantes: [
        {
          codigo: 'ARS5', nombre: 'Rebase de señal / zona protegida para maniobras',
          viaBanalizada: true,
          partes: [
            { t: 'text', v: 'Autorizo al Maquinista ' },
            { t: 'campo', id: 'sujeto', label: 'Del tren / de la maniobra', hint: 'del tren ___, de la maniobra' },
            { t: 'text', v: ' a rebasar ' },
            { t: 'opcional', id: 'senal', label: 'Incluir "la señal (clase) número ___"', v: 'la señal (clase: entrada y/o retroceso, interiores y/o salida, etc.) número ___' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'zona', label: 'Incluir "la zona protegida para maniobras lado ___"', v: 'la zona protegida para maniobras lado ___' },
            { t: 'text', v: ' de ' },
            { t: 'campo', id: 'lugar', label: 'Lugar', hint: 'estación, puesto, bifurcación, etc.' },
            { t: 'text', v: ' con ' },
            { t: 'campo', id: 'cond', label: 'Condiciones de circulación', hint: 'condiciones de circulación' },
            { t: 'text', v: '.' }
          ]
        },
        {
          codigo: 'ARS6', nombre: 'Rebase entre dos señales sin exceder 10 km/h',
          viaBanalizada: true,
          partes: [
            { t: 'text', v: 'Autorizo al Maquinista del tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' a rebasar desde la señal ' },
            { t: 'campo', id: 'origenTipo', label: 'Tipo de señal', hint: 'avanzada, de entrada, de salida' },
            { t: 'text', v: ' número ' },
            { t: 'campo', id: 'origenNum', label: 'Número' },
            { t: 'text', v: ' de ' },
            { t: 'campo', id: 'origenEst', label: 'Estación', hint: 'estación' },
            { t: 'text', v: 'hasta la señal de ' },
            { t: 'campo', id: 'destinoTipo', label: 'Tipo de señal', hint: 'entrada, salida' },
            { t: 'text', v: ' número ' },
            { t: 'campo', id: 'destinoNum', label: 'Número' },
            { t: 'text', v: ' de ' },
            { t: 'campo', id: 'destinoEst', label: 'Estación', hint: 'estación' },
            { t: 'text', v: ' inclusive, sin exceder de 10 km/h al paso por las agujas, ' },
            { t: 'opcional', id: 'verificar', label: 'Incluir "después de verificar su posición"', v: 'después de verificar su posición ' },
            { t: 'text', v: 'con ' },
            { t: 'campo', id: 'cond', label: 'Otras condiciones de circulación', hint: 'otras condiciones de circulación' },
            { t: 'text', v: '.' }
          ]
        }
      ]
    },
    {
      cat: 'LTV', catLabel: 'Limitación temporal velocidad', color: 'rc',
      nombre: 'Limitación Temporal de Velocidad',
      variantes: [
        {
          codigo: 'LTV3', nombre: 'Establecida o suprimida (con causa)',
          partes: [
            { t: 'campo', id: 'accion', label: 'Establecida / suprimida', hint: 'Establecida o suprimida' },
            { t: 'text', v: ' limitación temporal de velocidad máxima a ' },
            { t: 'campo', id: 'vel', label: 'Velocidad (km/h)' },
            { t: 'text', v: ' km/h ' },
            { t: 'opcional', id: 'vias', label: 'Incluir "en vía/s ___"', v: 'en vía/s ___' },
            { t: 'text', v: ' desde el km ' },
            { t: 'campo', id: 'kmDesde', label: 'Km desde' },
            { t: 'text', v: ' al ' },
            { t: 'campo', id: 'kmHasta', label: 'Km hasta' },
            { t: 'text', v: ' entre ' },
            { t: 'campo', id: 'entre1', label: 'Estación' },
            { t: 'text', v: ' y ' },
            { t: 'campo', id: 'entre2', label: 'Estación' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'causa', label: 'Incluir "por (trinchera, zona inundable, terraplén)"', v: 'por (trinchera, zona inundable, terraplén)' },
            { t: 'text', v: '. ' },
            { t: 'campo', id: 'senalizada', label: 'Señalizada / sin señalizar', hint: 'Se encuentra señalizada o sin señalizar' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'csv', label: 'Incluir "Supone un CSV"', v: 'Supone un CSV' }
          ]
        }
      ]
    },
    {
      cat: 'MAV', catLabel: 'Marcha a la vista', color: 'rc',
      nombre: 'Marcha a la vista',
      variantes: [
        {
          codigo: 'MAV', nombre: 'Marcha a la vista',
          partes: [
            { t: 'text', v: 'Circulará con marcha a la vista entre ' },
            { t: 'campo', id: 'entre1', label: 'Punto', hint: 'estación, pk, etc.' },
            { t: 'text', v: ' y ' },
            { t: 'campo', id: 'entre2', label: 'Punto', hint: 'estación, pk, etc.' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'velmax', label: 'Incluir "sin exceder de ___ km/h"', v: 'sin exceder de ___ km/h' },
            { t: 'text', v: ' por ' },
            { t: 'campo', id: 'motivo', label: 'Motivo', hint: 'motivo' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'cond', label: 'Incluir "con (condiciones de circulación...)"', v: 'con (condiciones de circulación incluyendo el tipo de reconocimiento a realizar)' },
            { t: 'text', v: '.' }
          ]
        }
      ]
    },
    {
      cat: 'MT', catLabel: 'Marche el tren', color: 'rc',
      nombre: 'Marche el tren',
      variantes: [
        {
          codigo: 'MT1', nombre: 'Marche por vía',
          partes: [
            { t: 'text', v: 'Marche el tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' de vía ' },
            { t: 'campo', id: 'via', label: 'Vía' }
          ]
        },
        {
          codigo: 'MT2', nombre: 'Marche con marcha a la vista hasta señal',
          partes: [
            { t: 'text', v: 'Marche el tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' hasta ' },
            { t: 'campo', id: 'estacion', label: 'Estación', hint: 'estación inmediata' },
            { t: 'text', v: '. con marcha a la vista hasta la señal ' },
            { t: 'campo', id: 'senal', label: 'Señal', hint: 'primera de bloqueo' }
          ]
        }
      ]
    },
    {
      cat: 'PAN', catLabel: 'Parada no prescrita', color: 'rc',
      nombre: 'Parada no prescrita',
      variantes: [
        {
          codigo: 'PAN', nombre: 'Parada no prescrita',
          partes: [
            { t: 'text', v: 'Efectuará parada en ' },
            { t: 'campo', id: 'lugar', label: 'Lugar', hint: 'estación, apeadero, punto kilométrico' },
            { t: 'text', v: ' para ' },
            { t: 'campo', id: 'motivo', label: 'Motivo', hint: 'motivo' },
            { t: 'text', v: '.' }
          ]
        }
      ]
    },
    {
      cat: 'REM', catLabel: 'Reanudación marcha', color: 'rc',
      nombre: 'Reanudación de la marcha',
      variantes: [
        {
          codigo: 'REM', nombre: 'Reanudación de la marcha',
          partes: [
            { t: 'text', v: 'Puede reanudar la marcha a la estación de ' },
            { t: 'campo', id: 'estacion', label: 'Estación', hint: 'estación' },
            { t: 'text', v: 'con ' },
            { t: 'campo', id: 'cond', label: 'Condiciones específicas de circulación', hint: 'condiciones específicas de circulación' },
            { t: 'text', v: '.' }
          ]
        }
      ]
    },
    {
      cat: 'RET', catLabel: 'Retroceso del tren', color: 'rc',
      nombre: 'Retroceso del tren',
      variantes: [
        {
          codigo: 'RET1', nombre: 'Solicitud de retroceso', color: 'maquinista',
          enlace: 'Se responde con RET2 (autoriza el retroceso) o RET3 (si se anula la solicitud).',
          partes: [
            { t: 'text', v: 'Tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' detenido en el km ' },
            { t: 'campo', id: 'km', label: 'Km' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'via', label: 'Incluir "de la vía (I, II, etc.)"', v: 'de la vía (I, II, etc.)' },
            { t: 'text', v: ' entre ' },
            { t: 'campo', id: 'entre1', label: 'Estación' },
            { t: 'text', v: ' y' },
            { t: 'campo', id: 'entre2', label: 'Estación' },
            { t: 'text', v: '. Solicito autorización de retroceso.' }
          ]
        },
        {
          codigo: 'RET2', nombre: 'Autorización de retroceso', color: 'rc',
          enlace: 'Responde a la solicitud de RET1.',
          partes: [
            { t: 'text', v: 'Retroceda el tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' hasta ' },
            { t: 'campo', id: 'estacion', label: 'Estación', hint: 'estación' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'cond', label: 'Incluir "Con (condiciones de circulación)"', v: 'Con (condiciones de circulación)' },
            { t: 'text', v: '.' }
          ]
        },
        {
          codigo: 'RET3', nombre: 'Anulación de solicitud de retroceso', color: 'maquinista',
          enlace: 'Anula la solicitud hecha en RET1 y pide autorización para reanudar la marcha.',
          partes: [
            { t: 'text', v: 'Tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' detenido en el km ' },
            { t: 'campo', id: 'km', label: 'Km' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'via', label: 'Incluir "de la vía (I, II, etc.)"', v: 'de la vía (I, II, etc.)' },
            { t: 'text', v: ' entre' },
            { t: 'campo', id: 'entre1', label: 'Estación' },
            { t: 'text', v: ' y' },
            { t: 'campo', id: 'entre2', label: 'Estación' },
            { t: 'text', v: '. Anulo solicitud de retroceso y solicito autorización para reanudar la marcha.' }
          ]
        },
        {
          codigo: 'RET7', nombre: 'Reanudación de la marcha tras retroceso', color: 'rc',
          enlace: 'Se emite tras autorizarse el retroceso (RET2), para que el tren reanude la marcha.',
          partes: [
            { t: 'text', v: 'Tren ' },
            { t: 'campo', id: 'accion', label: 'Autorizado / ordenado', hint: 'autorizado, ordenado' },
            { t: 'text', v: ' a retroceder a ' },
            { t: 'campo', id: 'lugar', label: 'Lugar' },
            { t: 'text', v: ' puede reanudar la marcha hacia la estación ' },
            { t: 'campo', id: 'estacion', label: 'Estación' },
            { t: 'text', v: ' con ' },
            { t: 'campo', id: 'cond', label: 'Condiciones de circulación', hint: 'condiciones de circulación' }
          ]
        }
      ]
    },
    {
      cat: 'APA', catLabel: 'Tren completo', color: 'maquinista',
      nombre: 'Comunicación de tren completo',
      variantes: [
        {
          codigo: 'APA', nombre: 'Tren completo y apartado',
          partes: [
            { t: 'text', v: 'Tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' llegó completo y apartado en ' },
            { t: 'campo', id: 'lugar', label: 'Lugar' },
            { t: 'text', v: '.' }
          ]
        }
      ]
    },
    {
      cat: 'IVC', catLabel: 'Interrupción vía contigua', color: 'rc',
      nombre: 'Interrupción de vía contigua',
      variantes: [
        {
          codigo: 'IVC1', nombre: 'Solicitud de interrupción', color: 'maquinista',
          enlace: 'Se responde con IVC3 (el RC confirma la interrupción) y, para levantarla, con IVC4 (referencia el nº de este telefonema).',
          partes: [
            { t: 'text', v: 'Maquinista de tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' detenido en el km ' },
            { t: 'campo', id: 'km', label: 'Km', hint: 'situación de la cabeza del tren' },
            { t: 'text', v: '. Solicito interrupción de la circulación por la/s vía/s ' },
            { t: 'campo', id: 'vias', label: 'Vía/s', hint: 'I, II, etc.' },
            { t: 'text', v: ' entre ' },
            { t: 'campo', id: 'entre1', label: 'Estación', hint: 'estación' },
            { t: 'text', v: ' y ' },
            { t: 'campo', id: 'entre2', label: 'Estación', hint: 'estación' },
            { t: 'text', v: ' para reconocer el tren.' }
          ]
        },
        {
          codigo: 'IVC3', nombre: 'Confirmación de interrupción', color: 'rc',
          enlace: 'Confirma la interrupción solicitada en IVC1.',
          partes: [
            { t: 'text', v: 'Interrumpida la circulación por la/s vía/s ' },
            { t: 'campo', id: 'vias', label: 'Vía/s', hint: 'I, II, etc.' },
            { t: 'text', v: ' entre ' },
            { t: 'campo', id: 'entre1', label: 'Estación', hint: 'estación' },
            { t: 'text', v: ' y ' },
            { t: 'campo', id: 'entre2', label: 'Estación', hint: 'estación' },
            { t: 'text', v: ' para reconocer el tren.' }
          ]
        },
        {
          codigo: 'IVC4', nombre: 'Levantamiento de la interrupción', color: 'maquinista',
          enlace: 'Levanta la interrupción solicitada en IVC1, referenciando su número de telefonema.',
          partes: [
            { t: 'text', v: 'Reconocido tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ', queda sin efecto la interrupción de la circulación solicitada mediante mi telefonema n.º ' },
            { t: 'campo', id: 'numTel', label: 'Nº de telefonema' },
            { t: 'text', v: '.' }
          ]
        }
      ]
    },
    {
      cat: 'SOC', catLabel: 'Socorro a tren', color: 'rc',
      nombre: 'Socorro a tren',
      variantes: [
        {
          codigo: 'SOC1', nombre: 'Solicitud de socorro', color: 'maquinista',
          partes: [
            { t: 'text', v: 'Tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' detenido en el km ' },
            { t: 'campo', id: 'km', label: 'Km', hint: 'situación de la cabeza del tren' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'via', label: 'Incluir "de la vía (I, II, etc.)"', v: 'de la vía (I, II, etc.)' },
            { t: 'text', v: ' entre ' },
            { t: 'campo', id: 'entre1', label: 'Estación' },
            { t: 'text', v: ' y ' },
            { t: 'campo', id: 'entre2', label: 'Estación' },
            { t: 'text', v: ' por ' },
            { t: 'campo', id: 'causa', label: 'Causa', hint: 'avería, accidente' },
            { t: 'text', v: ' solicito socorro.' }
          ]
        },
        {
          codigo: 'SOC4', nombre: 'Socorro con condiciones detalladas', color: 'rc',
          partes: [
            { t: 'text', v: 'Socorro a tren' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'segundaParte', label: 'Incluir "a la segunda parte de tren ___"', v: 'a la segunda parte de tren ___' },
            { t: 'text', v: ' detenido en el km ' },
            { t: 'campo', id: 'km', label: 'Km' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'via', label: 'Incluir "de la vía (I, II, etc.)"', v: 'de la vía (I, II, etc.)' },
            { t: 'text', v: ' entre ' },
            { t: 'campo', id: 'entre1', label: 'Estación' },
            { t: 'text', v: ' y ' },
            { t: 'campo', id: 'entre2', label: 'Estación' },
            { t: 'text', v: '. Circulará sin exceder de 40 km/h desde ' },
            { t: 'campo', id: 'estacionAnterior', label: 'Estación anterior', hint: 'estación anterior' },
            { t: 'text', v: ' y además, desde el km ' },
            { t: 'campo', id: 'km3', label: 'Km', hint: '3 km antes del punto donde se encuentra la cabeza o cola del tren detenido' },
            { t: 'text', v: ' con marcha a la vista y con ' },
            { t: 'campo', id: 'cond', label: 'Instrucciones y otras condiciones de circulación', hint: 'instrucciones y otras condiciones de circulación' },
            { t: 'text', v: '.' }
          ]
        },
        {
          codigo: 'SOC5', nombre: 'Socorro con marcha a la vista', color: 'rc',
          partes: [
            { t: 'text', v: 'Socorro a tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' detenido ' },
            { t: 'opcional', id: 'via', label: 'Incluir "en la vía (I, II, etc.)"', v: 'en la vía (I, II, etc.)' },
            { t: 'text', v: ' entre ' },
            { t: 'campo', id: 'entre1', label: 'Estación' },
            { t: 'text', v: ' y ' },
            { t: 'campo', id: 'entre2', label: 'Estación' },
            { t: 'text', v: '. Circulará con marcha a la vista y sin exceder de 40 km/h hasta su localización y con ' },
            { t: 'campo', id: 'cond', label: 'Instrucciones y otras condiciones de circulación', hint: 'instrucciones y otras condiciones de circulación' },
            { t: 'text', v: '.' }
          ]
        },
        {
          codigo: 'SOC6', nombre: 'Anulación de petición de socorro', color: 'maquinista',
          partes: [
            { t: 'text', v: 'Anulo petición de socorro para tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' que hice por telefonema núm. ' },
            { t: 'campo', id: 'numTel', label: 'Nº de telefonema' },
            { t: 'text', v: '. Solicito autorización para reanudar la marcha (o retroceder) a la estación de ' },
            { t: 'campo', id: 'estacion', label: 'Estación' },
            { t: 'text', v: '.' }
          ]
        },
        {
          codigo: 'SOC10', nombre: 'Autorización de reanudación o retroceso', color: 'rc',
          partes: [
            { t: 'text', v: 'Puede ' },
            { t: 'campo', id: 'accion', label: 'Reanudar la marcha o retroceder', hint: 'reanudar la marcha o retroceder' },
            { t: 'text', v: ' a la estación de ' },
            { t: 'campo', id: 'estacion', label: 'Estación' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'cond', label: 'Incluir "Con (condiciones de circulación)"', v: 'Con (condiciones de circulación)' }
          ]
        },
        {
          codigo: 'SOC11', nombre: 'Mantener tren detenido', color: 'rc',
          partes: [
            { t: 'text', v: 'Mantenga tren ' },
            { t: 'campo', id: 'tren', label: 'Nº de tren' },
            { t: 'text', v: ' detenido en el km ' },
            { t: 'campo', id: 'km', label: 'Km' },
            { t: 'text', v: ' por ' },
            { t: 'campo', id: 'causas', label: 'Causas', hint: 'causas' },
            { t: 'text', v: '.' }
          ]
        }
      ]
    },
    {
      cat: 'BTA', catLabel: 'BT anormalidad BA/BLA/BEM', color: 'rc',
      nombre: 'Bloqueo Telefónico en caso de anormalidad del BA, BLA o BEM',
      variantes: [
        {
          codigo: 'BTA10', nombre: 'Circulación con BT por avería de bloqueo',
          // Advertencia sacada literal del PDF (nota oficial adjunta a este
          // telefonema en el documento, no aportada por el usuario).
          advertencias: [
            'A este telefonema se agregarán las estaciones intermedias con Responsable de Circulación que intervengan en el bloqueo, si existen, y las AC cerradas que tengan establecido itinerario de paso por vía desviada e, igualmente, cuando proceda: Limitaciones temporales de velocidad máxima, PN con semibarreras enclavadas sin protección, etc.'
          ],
          partes: [
            { t: 'text', v: 'Circulará con BT entre ' },
            { t: 'campo', id: 'entre1', label: 'Estación' },
            { t: 'text', v: ' y ' },
            { t: 'campo', id: 'entre2', label: 'Estación' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'via', label: 'Incluir "por la vía (I, II, etc.)"', v: 'por la vía (I, II, etc.)' },
            { t: 'text', v: '. No funciona ' },
            { t: 'campo', id: 'sistema', label: 'Sistema', hint: 'BA, BLA, BEM' },
            { t: 'text', v: '. ' },
            { t: 'opcional', id: 'itinerario', label: 'Incluir instrucciones de parada ante agujas', v: 'Irá dispuesto a efectuar parada ante la/s aguja/s del/os km/s___ y continuará la marcha después de verificar que está bien dispuesto el itinerario a seguir' }
          ]
        },
        {
          codigo: 'BTA15', nombre: 'Restablecimiento del bloqueo',
          partes: [
            { t: 'text', v: 'Restablecido el ' },
            { t: 'campo', id: 'sistema', label: 'Sistema', hint: 'BA, BLA, BEM' },
            { t: 'text', v: ' entre ' },
            { t: 'campo', id: 'entre1', label: 'Estación' },
            { t: 'text', v: ' y ' },
            { t: 'campo', id: 'entre2', label: 'Estación' },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'via', label: 'Incluir "por la vía (I, II, etc.)"', v: 'por la vía (I, II, etc.)' },
            { t: 'text', v: '.' }
          ]
        }
      ]
    }
  ];

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  var DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  // Día de la semana (0=Lunes..6=Domingo, mismo criterio que el calendario)
  // a partir de una fecha 'YYYY-MM-DD' — por componentes, evita líos de
  // zona horaria de new Date('YYYY-MM-DD').
  function diaSemanaIdx(fecha) {
    var p = (fecha || '').split('-');
    if (p.length !== 3) return null;
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return (d.getDay() + 6) % 7;
  }

  // ===== Estado =====
  var turnos = [];
  var settings = {};
  var horarios = [];
  var maniobras = [];
  var editId = null;
  var expandedSvc = 0;
  var incidenciaAbierta = {}; // svc index -> bool. Estado de UI, no se persiste.
  // Comprobaciones: svc index -> bool, solo cuando el usuario ha tocado el
  // toggle a mano (si no está la clave, el estado se deriva de si ya hay
  // hora de salida real — ver comprobacionesOpen). Estado de UI, no se
  // persiste.
  var comprobacionesAbierta = {};
  function comprobacionesOpen(si, s) {
    if (comprobacionesAbierta.hasOwnProperty(si)) return comprobacionesAbierta[si];
    return !s.rSalida;
  }
  var calYear, calMonth;
  // Estado de la pestaña Informe — solo en memoria, nunca en localStorage.
  // null → sin elegir modo (dispara modal al entrar en la pestaña).
  // {modo:'elegir-svc'} → mostrando lista de servicios existentes.
  // {modo:'form', origen:'registro'|'cero', s:{...}, inc:{...}} → formulario.
  var informeState = null;
  var statsRange = null;
  // Listado desplegable de Estadísticas (Turnos/Retraso acumulado
  // clicables) — solo en memoria, no se persiste.
  var statsListMode = null;    // null | 'turnos' | 'retrasos'
  var statsListLinea = '';     // '' = todas las líneas
  var statsListOrden = 'desc'; // 'desc' = más reciente primero
  var statsOtrasAbierta = false; // "Otras estadísticas" — plegada por defecto

  // ===== Utilidades =====
  function $(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function ymd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function today() { return ymd(new Date()); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function ymdNice(s) {
    if (!s) return '';
    var p = s.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  // Duración en minutos entre dos horas HH:MM (cruce de medianoche → +24h).
  function durMin(a, b) {
    if (!/^\d{1,2}:\d{2}$/.test(a || '') || !/^\d{1,2}:\d{2}$/.test(b || '')) return null;
    var pa = a.split(':'), pb = b.split(':');
    var m = (+pb[0] * 60 + +pb[1]) - (+pa[0] * 60 + +pa[1]);
    if (m < 0) m += 1440;
    return m;
  }
  function fmtDur(m) {
    if (m == null || m === 0) return '0h 00m';
    return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm';
  }
  // Parser flexible de retraso: '5' (min), '9:25' (HH:MM), '925'/'0925' (HHMM)
  // Orden de detección: HH:MM con dos puntos > 3-4 dígitos (HHMM) > entero suelto.
  function parseRetraso(raw) {
    if (raw == null) return null;
    var s = String(raw).trim().replace(/^\+/, '');
    if (s === '') return null;
    // 1) HH:MM con dos puntos
    var m = s.match(/^(-?)(\d{1,2}):(\d{2})$/);
    if (m) {
      var sig = m[1] === '-' ? -1 : 1;
      return sig * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
    }
    // 2) HHMM (3 o 4 dígitos) interpretado como tiempo
    if (/^\d{3,4}$/.test(s)) {
      var pad = s.length === 3 ? '0' + s : s;
      return parseInt(pad.slice(0, 2), 10) * 60 + parseInt(pad.slice(2), 10);
    }
    // 3) Entero suelto (1-2 dígitos, o negativo)
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    return null;
  }
  function fmtRetraso(min) {
    if (min == null || !isFinite(min)) return '';
    var abs = Math.abs(min);
    var sign = min >= 0 ? '+' : '-';
    if (abs >= 60) return sign + Math.floor(abs / 60) + 'h ' + pad2(abs % 60) + 'm';
    return sign + abs + 'm';
  }
  // True si el servicio aún no ha llegado a destino (hDestino > hora actual).
  function servicioEnCurso(s) {
    if (!s || !s.hDestino) return false;
    var parts = String(s.hDestino).split(':');
    if (parts.length < 2) return false;
    var dest = new Date();
    dest.setHours(+parts[0], +parts[1], 0, 0);
    return new Date() < dest;
  }
  // Suma minutos a una hora 'HH:MM' → 'HH:MM' (con wrap 24h).
  function addMinutos(hora, min) {
    if (!/^\d{1,2}:\d{2}$/.test(hora || '') || !isFinite(min)) return '';
    var p = hora.split(':');
    var t = (+p[0]) * 60 + (+p[1]) + min;
    t = ((t % 1440) + 1440) % 1440;
    return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60);
  }
  // Resta minutos a una hora 'HH:MM' → 'HH:MM' (con wrap 24h).
  function subMinutos(hora, min) {
    if (!/^\d{1,2}:\d{2}$/.test(hora || '') || !isFinite(min)) return '';
    var p = hora.split(':');
    var t = (+p[0]) * 60 + (+p[1]) - min;
    while (t < 0) t += 24 * 60;
    t = t % (24 * 60);
    return pad2(Math.floor(t / 60)) + ':' + pad2(t % 60);
  }
  // Retraso (+) o adelanto (-) en minutos entre una hora programada 'HH:MM'
  // y la hora actual del dispositivo. Camino más corto alrededor de
  // medianoche (nunca da más de 12h en ningún sentido).
  function retrasoDesdeAhora(horaProg) {
    if (!/^\d{1,2}:\d{2}$/.test(horaProg || '')) return null;
    var p = horaProg.split(':');
    var progMin = (+p[0]) * 60 + (+p[1]);
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var diff = nowMin - progMin;
    if (diff > 720) diff -= 1440;
    if (diff < -720) diff += 1440;
    return diff;
  }

  // ===== Almacenamiento =====
  function load(k, def) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; }
    catch (e) { return def; }
  }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    // Único punto por el que pasan TODAS las escrituras de turnos (las
    // debounced de autosave() y las directas) — enganchar aquí basta para
    // que el espejo en archivos cubra cualquier cambio, sin tocar cada
    // llamada a save()/autosave() por separado.
    if (k === K_TURNOS) scheduleTurnoFolderSync();
  }
  var saveTimer = null;
  function autosave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      save(K_TURNOS, turnos);
    }, 350);
  }
  function flashSaved() {
    var f = $('save-flash');
    if (!f) return;
    f.classList.add('show');
    setTimeout(function () { f.classList.remove('show'); }, 1100);
  }

  function loadAll() {
    turnos = load(K_TURNOS, []);
    settings = load(K_SETTINGS, {});
    if (!settings.ramas || !settings.ramas.length) settings.ramas = DEFAULT_RAMAS.slice();
    if (settings.telefono == null) settings.telefono = '';
    if (settings.nombre == null) settings.nombre = '';
    if (settings.apellidos == null) settings.apellidos = '';
    if (settings.idEmpleado == null) settings.idEmpleado = '';
    if (!settings.theme) settings.theme = 'dark';
    if (settings.calView !== 'list') settings.calView = 'grid';
    if (settings.lastBackup == null) settings.lastBackup = '';
    if (settings.autoDownload == null) settings.autoDownload = false;
    // Modo desarrollador: muestra los botones ETCS/LZB en Registro. Oculto
    // por defecto — se activa tocando 7 veces "Versión instalada" en
    // Ajustes (mismo gesto que el modo desarrollador de Android).
    if (settings.telDevMode == null) settings.telDevMode = false;
    // Sincronización con Google Calendar (solo modo desarrollador).
    if (settings.gcalClientId == null) settings.gcalClientId = '';
    if (settings.gcalCalendarId == null) settings.gcalCalendarId = 'primary';
    // Carpeta de turnos en el dispositivo (ver bloque más abajo).
    if (settings.folderSetupSeen == null) settings.folderSetupSeen = false;
    if (settings.folderLinked == null) settings.folderLinked = false;
  }
  function saveSettings() { save(K_SETTINGS, settings); }

  // ===== Carpeta de turnos (espejo en archivos, uno por día) =====
  // Solo funciona si el navegador soporta File System Access
  // (showDirectoryPicker) — en cualquier otro navegador esta sección
  // simplemente no hace nada y la app funciona igual que siempre con
  // localStorage. El handle de la carpeta no es serializable a JSON, así
  // que se guarda en IndexedDB, no en settings/localStorage.
  var folderHandle = null; // vivo solo si hay permiso concedido esta sesión
  var FOLDER_DB = 'rviryo_folder_v1';

  function folderSupported() {
    return !!(window.showDirectoryPicker && window.indexedDB);
  }
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(FOLDER_DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbGetHandle() {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        var g = db.transaction('kv', 'readonly').objectStore('kv').get('folderHandle');
        g.onsuccess = function () { resolve(g.result || null); };
        g.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }
  function idbSetHandle(handle) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('kv', 'readwrite');
        if (handle) tx.objectStore('kv').put(handle, 'folderHandle');
        else tx.objectStore('kv').delete('folderHandle');
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      });
    }).catch(function () {});
  }

  function dayFileName(fecha) { return 'turno-' + fecha + '.json'; }

  // Recalcula turnosOfDay(fecha) y vuelca/borra su archivo — siempre un
  // espejo fiel de "lo que se ve ese día en la app", nunca datos a medias.
  function writeDayFile(fecha) {
    if (!folderHandle || !fecha) return;
    var dia = turnosOfDay(fecha).filter(function (t) { return !isEmptyTurno(t); });
    if (!dia.length) {
      folderHandle.removeEntry(dayFileName(fecha)).catch(function () {});
      return;
    }
    folderHandle.getFileHandle(dayFileName(fecha), { create: true })
      .then(function (fh) { return fh.createWritable(); })
      .then(function (w) {
        return w.write(JSON.stringify({ fecha: fecha, turnos: dia }, null, 2))
          .then(function () { return w.close(); });
      })
      .catch(function () {});
  }
  // Reescribe solo las fechas que toca un turno concreto (caso normal:
  // edición de un campo con el editor abierto). Cubre también la dormida
  // (2 fechas) sin lógica aparte, porque solo mira servicios[].fecha.
  function syncTurnoDates(turno) {
    if (!folderHandle || !turno) return;
    var fechas = {};
    (turno.servicios || []).forEach(function (s) { if (s.fecha) fechas[s.fecha] = true; });
    Object.keys(fechas).forEach(writeDayFile);
  }
  // Resync completo: recalcula todas las fechas con turnos y borra los
  // archivos de días que ya no tienen ninguno. Más caro, se usa solo
  // cuando no hay un turno concreto que mirar (borrar turno, importar
  // copia, vincular la carpeta por primera vez).
  async function syncFolderFull() {
    if (!folderHandle) return;
    var liveFechas = {};
    turnos.forEach(function (t) {
      if (isEmptyTurno(t)) return;
      (t.servicios || []).forEach(function (s) { if (s.fecha) liveFechas[s.fecha] = true; });
    });
    Object.keys(liveFechas).forEach(writeDayFile);
    try {
      for await (var entry of folderHandle.values()) {
        var m = entry.name.match(/^turno-(\d{4}-\d{2}-\d{2})\.json$/);
        if (m && !liveFechas[m[1]]) {
          try { await folderHandle.removeEntry(entry.name); } catch (e) {}
        }
      }
    } catch (e) {}
  }
  // Punto de enganche único, llamado desde save() en cada escritura de
  // turnos. Si hay un turno abierto en el editor, basta con sus fechas
  // (caso normal, barato). Si no (borrar turno, importar copia...), toca
  // recalcular todo porque no sabemos qué cambió sin comparar el array
  // entero.
  function scheduleTurnoFolderSync() {
    if (!folderHandle) return;
    var t = editId != null ? getTurno(editId) : null;
    if (t) syncTurnoDates(t);
    else syncFolderFull();
  }

  // El selector nativo abre ya en Documentos con esa carpeta preseleccionada
  // — el usuario solo tiene que confirmar (un toque), no crear ni buscar
  // nada. La subcarpeta "EnRuta" donde van los turno-*.json la crea el
  // propio código dentro de la carpeta elegida, no el usuario.
  async function linkFolder() {
    if (!folderSupported()) {
      appModal.alert({ title: 'No disponible', message: 'Este navegador no soporta guardar los turnos como archivos en el dispositivo.' });
      return;
    }
    var parent;
    try {
      parent = await window.showDirectoryPicker({ startIn: 'documents' });
    } catch (e) { return; } // el usuario cerró el selector sin elegir
    var perm;
    try { perm = await parent.requestPermission({ mode: 'readwrite' }); }
    catch (e) { perm = 'denied'; }
    if (perm !== 'granted') return;
    var handle;
    try { handle = await parent.getDirectoryHandle('EnRuta', { create: true }); }
    catch (e) { return; }
    folderHandle = handle;
    await idbSetHandle(handle);
    settings.folderLinked = true;
    saveSettings();
    syncFolderFull();
    renderSettings();
    flashSaved();
  }
  async function relinkFolderPermission() {
    var handle = await idbGetHandle();
    if (!handle) return;
    var perm;
    try { perm = await handle.requestPermission({ mode: 'readwrite' }); }
    catch (e) { perm = 'denied'; }
    if (perm !== 'granted') return;
    folderHandle = handle;
    syncFolderFull();
    renderSettings();
    flashSaved();
  }
  function unlinkFolder() {
    folderHandle = null;
    settings.folderLinked = false;
    saveSettings();
    idbSetHandle(null);
    renderSettings();
  }
  // Recuperación manual: relee todos los turno-*.json de la carpeta y
  // sustituye los turnos actuales por lo que haya ahí. No se hace sola —
  // solo si el usuario la pide, para no pisar datos por sorpresa.
  async function reindexFromFolder() {
    if (!folderHandle) return;
    var collected = {};
    try {
      for await (var entry of folderHandle.values()) {
        if (entry.kind !== 'file' || !/^turno-\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) continue;
        try {
          var file = await entry.getFile();
          var data = JSON.parse(await file.text());
          (data.turnos || []).forEach(function (t) { if (t && t.id) collected[t.id] = t; });
        } catch (e) {}
      }
    } catch (e) {}
    var restored = Object.keys(collected).map(function (id) { return collected[id]; }).map(normTurno);
    appModal.confirm({
      title: 'Reindexar desde archivos',
      message: 'Se han encontrado ' + restored.length + ' turnos en la carpeta. Esto sustituirá los turnos actuales de la app por estos. ¿Continuar?',
      buttons: [
        { label: 'Cancelar', value: false, kind: 'neutral' },
        { label: 'Reindexar', value: true, kind: 'danger' }
      ]
    }).then(function (ok) {
      if (!ok) return;
      turnos = restored;
      save(K_TURNOS, turnos);
      renderCalendar();
      renderSettings();
      appModal.alert({ title: 'Reindexado', message: restored.length + ' turnos restaurados desde los archivos.' });
    });
  }
  // Al arrancar: si ya había carpeta vinculada, recupera el handle y
  // comprueba el permiso sin insistir sola si se perdió.
  function initFolderHandle() {
    if (!folderSupported()) return Promise.resolve();
    return idbGetHandle().then(function (handle) {
      if (!handle) return;
      return handle.queryPermission({ mode: 'readwrite' }).then(function (perm) {
        folderHandle = (perm === 'granted') ? handle : null;
      }).catch(function () { folderHandle = null; });
    });
  }
  // Primer aviso, una sola vez (a quien instala de nuevo y a quien ya
  // tenía la app con turnos guardados). Un único toque en el aviso
  // encadena directo con el selector nativo de carpetas.
  function maybeFirstRunFolderPrompt() {
    if (settings.folderSetupSeen) return;
    settings.folderSetupSeen = true;
    saveSettings();
    if (!folderSupported()) return;
    setView('ajustes');
    renderSettings();
    appModal.confirm({
      title: 'Para guardar los turnos en el dispositivo',
      message: 'Para guardar los datos de los servicios se tiene que dar permiso a EnRuta.',
      buttons: [
        { label: 'Ahora no', value: false, kind: 'neutral' },
        { label: 'Permitir', value: true, kind: 'primary' }
      ]
    }).then(function (ok) { if (ok) linkFolder(); });
  }

  function loadHorarios() {
    horarios = (window.RV_HORARIOS || []).slice();
    horarios.sort(function (a, b) {
      return (parseInt(a.servicio, 10) || 0) - (parseInt(b.servicio, 10) || 0);
    });
    maniobras = (window.RV_MANIOBRAS || []).slice();
  }

  // ===== Modelo =====
  function blankServicio(fecha) {
    return {
      fecha: fecha || today(),
      servicioComercial: '', origen: '', destino: '', via: '', rama: '',
      hSalida: '', hDestino: '', rSalida: '', rLlegDestino: '',
      esTraslado: false, maniobraNombre: '',
      horaLTV: '', paradas: [],
      n1: '', viajeros: '', asistencias: '', plazasH: '', pmr: [],
      comprobaciones: COMPROBACIONES.map(function () { return false; }),
      observaciones: '', dibujos: [],
      incidencias: [], telefonemas: []
    };
  }
  // ¿Tiene este servicio al menos un informe de incidencia ya generado?
  function svcConInformeGenerado(s) {
    return !!(s && s.incidencias && s.incidencias.some(function (i) { return i.generado; }));
  }
  // ¿Tiene este turno (cualquiera de sus servicios) algún informe generado?
  function turnoConInformeGenerado(t) {
    return !!(t && t.servicios && t.servicios.some(svcConInformeGenerado));
  }
  function blankIncidencia() {
    return {
      hora: '', linea: '', cabina: '', pk: '', coche: '',
      descripcion: '', medidas: '', trenes: '', generado: false
    };
  }
  function blankParada() {
    return {
      nombre: '', hLleg: '', hora: '', tParada: 0, rLleg: '', rSal: '',
      viajeros: '', asistencias: ''
    };
  }
  function blankTurno(fecha) {
    return {
      id: uid(), estado: 'en_curso', horaLTV: '',
      turnoHorarioActivo: false, toma: '', deje: '', descanso: '',
      servicios: [blankServicio(fecha)]
    };
  }
  function getTurno(id) {
    for (var i = 0; i < turnos.length; i++) if (turnos[i].id === id) return turnos[i];
    return null;
  }
  // Migración defensiva: asegura que un turno tiene la forma esperada.
  function normTurno(t) {
    if (t.horaLTV == null) t.horaLTV = '';
    if (t.turnoHorarioActivo == null) t.turnoHorarioActivo = false;
    if (t.toma == null) t.toma = '';
    if (t.deje == null) t.deje = '';
    if (t.descanso == null) t.descanso = '';
    if (!t.servicios) t.servicios = [];
    t.servicios.forEach(function (s, si) {
      if (s.origen == null) s.origen = '';
      if (s.destino == null) s.destino = '';
      if (s.rSalida == null) s.rSalida = '';
      if (s.rLlegDestino == null) s.rLlegDestino = '';
      if (s.horaLTV == null) s.horaLTV = '';
      // Migración LTV global → servicio 0
      if (si === 0 && !s.horaLTV && t.horaLTV) s.horaLTV = t.horaLTV;
      if (!s.paradas) s.paradas = [];
      if (!s.telefonemas) s.telefonemas = [];
      // Recuperar tParada del Libro de Horarios si está a 0 (turnos guardados
      // antes de que autofillServicio lo mapeara). Sin esto, las paradas
      // intermedias comerciales no muestran H. Llegada.
      var hr = null;
      if (s.servicioComercial && horarios && horarios.length) {
        hr = horarios.find(function (h) {
          return String(h.servicio) === String(s.servicioComercial) &&
                 (!s.origen || h.origen === s.origen) &&
                 (!s.destino || h.destino === s.destino);
        });
      }
      s.paradas.forEach(function (p) {
        if (p.tParada == null) p.tParada = 0;
        if (p.hLleg == null) p.hLleg = '';
        if (p.rLleg == null) p.rLleg = '';
        if (p.rSal == null) p.rSal = '';
        if (p.viajeros == null) p.viajeros = '';
        if (p.asistencias == null) p.asistencias = '';
        if (!Array.isArray(p.pmr)) p.pmr = [];
        // Si tParada=0 y la encontramos en el horario con valor mayor → rellenar.
        if (!p.tParada && hr && p.nombre) {
          var hp = hr.paradas.find(function (x) { return x.nombre === p.nombre; });
          if (hp && hp.tParada > 0) p.tParada = hp.tParada;
        }
      });
      if (!s.dibujos) s.dibujos = [];
      // Migración plazasH (string/numero) → pmr (array)
      if (!Array.isArray(s.pmr)) {
        var n = parseInt(s.plazasH, 10);
        s.pmr = [];
        if (!isNaN(n) && n > 0) {
          for (var k = 0; k < n; k++) s.pmr.push({ baja: '' });
        }
      }
      if (!s.comprobaciones || s.comprobaciones.length !== COMPROBACIONES.length) {
        var old = s.comprobaciones || [];
        s.comprobaciones = COMPROBACIONES.map(function (_, i) { return !!old[i]; });
      }
      // Migración: versión anterior guardaba una sola incidencia en campos
      // planos (s.incHora, s.incLinea...) — se convierte a incidencias[0].
      if (!Array.isArray(s.incidencias)) {
        s.incidencias = [];
        var teniaDatos = s.incHora || s.incLinea || s.incCabina || s.incPk ||
          s.incCoche || s.incDescripcion || s.incMedidas || s.incTrenes;
        if (teniaDatos) {
          s.incidencias.push({
            hora: s.incHora || '', linea: s.incLinea || '', cabina: s.incCabina || '',
            pk: s.incPk || '', coche: s.incCoche || '', descripcion: s.incDescripcion || '',
            medidas: s.incMedidas || '', trenes: s.incTrenes || ''
          });
        }
      }
      delete s.incHora; delete s.incLinea; delete s.incCabina; delete s.incPk;
      delete s.incCoche; delete s.incDescripcion; delete s.incMedidas; delete s.incTrenes;
      s.incidencias.forEach(function (inc) {
        if (inc.hora == null) inc.hora = '';
        if (inc.linea == null) inc.linea = '';
        if (inc.cabina == null) inc.cabina = '';
        if (inc.pk == null) inc.pk = '';
        if (inc.coche == null) inc.coche = '';
        if (inc.descripcion == null) inc.descripcion = '';
        if (inc.medidas == null) inc.medidas = '';
        if (inc.trenes == null) inc.trenes = '';
        if (inc.generado == null) inc.generado = false;
      });
    });
    // LTV ya migrada a servicio[0], queda en t por compat pero ignorada.
    return t;
  }
  function isDormida(t) {
    if (!t || !t.servicios || t.servicios.length < 2) return false;
    var fechas = t.servicios.map(function (s) { return s.fecha; }).filter(Boolean);
    if (fechas.length < 2) return false;
    var seen = {};
    fechas.forEach(function (f) { seen[f] = true; });
    return Object.keys(seen).length > 1;
  }
  function turnosOfDay(d) {
    return turnos.filter(function (t) {
      return t.servicios.some(function (s) { return s.fecha === d; });
    });
  }
  // ¿Turno sin ningún dato introducido? (solo la fecha automática del servicio)
  function isEmptyTurno(t) {
    if (t.horaLTV) return false;
    return t.servicios.every(function (s) {
      if (s.servicioComercial || s.via || s.rama || s.n1 ||
          s.viajeros || s.asistencias || s.plazasH || s.observaciones ||
          s.esTraslado || s.origen || s.destino) return false;
      if (s.paradas.some(function (p) {
        return p.nombre || p.hora || p.rLleg || p.rSal;
      })) return false;
      if (s.comprobaciones.some(function (c) { return c; })) return false;
      if (s.incidencias && s.incidencias.length) return false;
      return true;
    });
  }
  // Al salir del editor, descarta el turno si quedó completamente vacío.
  // Si el turno tiene datos, se PRESERVA editId (y el servicio expandido) para
  // que al volver a Registro reaparezca el mismo servicio, no el primero.
  function discardEmptyEdit() {
    if (currentRec) stopDictado();
    if (editId) {
      var t = getTurno(editId);
      if (!t) {
        editId = null;
      } else if (t.estado !== 'cerrado' && isEmptyTurno(t)) {
        turnos = turnos.filter(function (x) { return x.id !== editId; });
        save(K_TURNOS, turnos);
        editId = null;
      }
      // turno con datos → conservar editId y expandedSvc
    }
  }

  // ===== Navegación / vistas =====
  var lastSetView = '';
  function setView(v) {
    // Si salimos del editor de Registro hacia otra vista RV, descartar
    // turno blank si quedó vacío. Esto cubre TODOS los flujos de salida
    // (botón "volver", cambio de tab, sub-nav), incluso los que no
    // pasan por onTabChange de app.js (click en día del calendario).
    if (lastSetView === 'registro' && v !== 'registro') {
      discardEmptyEdit();
    }
    lastSetView = v;
    ['calendario', 'registro', 'telefonemas', 'informe', 'estadisticas', 'ajustes'].forEach(function (p) {
      var el = $(p + '-pane');
      if (el) el.classList.toggle('active', p === v);
    });
    window.scrollTo(0, 0);
    try { window.dispatchEvent(new CustomEvent('iryo:setView', { detail: { view: v } })); } catch (e) {}
  }

  // ===== Calendario =====
  // Primeras 3 letras de la primera palabra del nombre de estación
  // (p.ej. "MADRID-P.ATOCHA-ALMUDENA GRANDES" → "Mad") — recorrido corto
  // para que quepa en la celda diminuta del calendario.
  function abreviarEstacion(nombre) {
    var palabra = String(nombre || '').split(/[-\s]/)[0];
    return palabra ? palabra.charAt(0).toUpperCase() + palabra.slice(1, 3).toLowerCase() : '';
  }
  // Nombre de estación "bien escrito" para los listados de Estadísticas
  // — "MADRID-P.ATOCHA-ALMUDENA GRANDES" → "Madrid-P.Atocha-Almudena
  // Grandes". Solo se usa ahí, el resto de la app sigue mostrando el
  // nombre tal cual viene de data.js.
  function prettyEstacion(nombre) {
    return String(nombre || '').toLowerCase().replace(/(^|[\s\-.])([a-zà-ÿ])/g,
      function (m, sep, c) { return sep + c.toUpperCase(); });
  }
  // Icono de ordenar (barras decrecientes + flecha) — no hay glifo Unicode
  // decente para esto, así que es un SVG mínimo en línea, sin depender de
  // ninguna librería de iconos. desc=true → flecha abajo (más reciente
  // primero); false → flecha arriba (más antiguo primero).
  function sortIconSvg(desc) {
    var flecha = desc
      ? '<path d="M13 2v10m0 0l-3-3m3 3l3-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
      : '<path d="M13 12V2m0 0l-3 3m3-3l3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
    return '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle">' +
      '<line x1="1" y1="3" x2="9" y2="3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<line x1="1" y1="7" x2="6.5" y2="7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      '<line x1="1" y1="11" x2="4" y2="11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
      flecha + '</svg>';
  }
  function renderSvcBlock(s) {
    var esTraslado = !!s.esTraslado;
    var numTxt = s.servicioComercial || (esTraslado ? (s.maniobraNombre || 'Traslado') : '');
    var num = numTxt ? '<b>' + esc(numTxt) + '</b>' : '';
    var rd = parseInt(String(s.rLlegDestino || '').replace(/^\+/, ''), 10);
    var ret = (!isNaN(rd) && rd > 0) ? ' <span class="ret">+' + rd + 'm</span>' : '';
    var tag = esTraslado ? '<span class="svc-tag">TRASLADO</span>' :
      (num ? '<span class="svc-tag normal">SERVICIO</span>' : '');
    var line1 = tag + num + ret;
    var lineRuta = (!esTraslado && s.origen && s.destino) ?
      esc(abreviarEstacion(s.origen) + ' - ' + abreviarEstacion(s.destino)) : '';
    var lineHora = (s.hSalida && s.hDestino) ? esc(s.hSalida + '→' + s.hDestino) : '';
    if (!num && !lineHora && !esTraslado) return '';
    var out = '<span class="svc-block' + (esTraslado ? ' traslado' : ' normal') + '">';
    if (line1) out += '<span class="svc-head">' + line1 + '</span>';
    if (lineRuta) out += '<span class="svc-route">' + lineRuta + '</span>';
    if (lineHora) out += '<span class="svc-hrs">' + lineHora + '</span>';
    out += '</span>';
    return out;
  }

  function renderCalendar() {
    if (settings.calView === 'list') { renderList(); return; }
    var pane = $('calendario-pane');
    var first = new Date(calYear, calMonth, 1);
    var offset = (first.getDay() + 6) % 7; // lunes primero
    var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    var monthPrefix = calYear + '-' + pad2(calMonth + 1);

    // Pair info para dormidas: vincular los 2 días del mismo turno.
    var pairInfo = {};
    turnos.forEach(function (t) {
      if (!isDormida(t)) return;
      var fechas = t.servicios.map(function (s) { return s.fecha; })
        .filter(Boolean).sort();
      if (fechas.length < 2) return;
      var f1 = fechas[0], f2 = fechas[1];
      var bothInMonth = f1.slice(0, 7) === monthPrefix && f2.slice(0, 7) === monthPrefix;
      var sameRow = false;
      if (bothInMonth) {
        var dn1 = parseInt(f1.slice(8), 10);
        var dn2 = parseInt(f2.slice(8), 10);
        sameRow = (dn2 === dn1 + 1) &&
          (Math.floor((offset + dn1 - 1) / 7) === Math.floor((offset + dn2 - 1) / 7));
      }
      pairInfo[f1] = { role: 'first', other: f2, sameRow: sameRow };
      pairInfo[f2] = { role: 'second', other: f1, sameRow: sameRow };
    });

    var h = '<div class="cal-head">' +
      '<button class="cal-nav" data-action="cal-prev">‹</button>' +
      '<div class="cal-title">' + MESES[calMonth] + ' ' + calYear + '</div>' +
      '<button class="cal-nav" data-action="cal-next">›</button>' +
      '<button class="cal-toggle" data-action="cal-toggle" title="Vista lista">≡</button>' +
      '</div>';
    h += '<div class="cal-grid">';
    DOW.forEach(function (d) { h += '<div class="cal-dow">' + d + '</div>'; });
    for (var i = 0; i < offset; i++) h += '<div class="cal-day empty"></div>';

    for (var dn = 1; dn <= daysInMonth; dn++) {
      var ds = calYear + '-' + pad2(calMonth + 1) + '-' + pad2(dn);
      var info = pairInfo[ds];

      // Si es el segundo día de una dormida y cabe en celda doble, ya se
      // renderizó como parte del 'first' — saltamos.
      if (info && info.role === 'second' && info.sameRow) continue;

      var tod = turnosOfDay(ds);
      // Defensa: ignorar turnos completamente vacíos (puede quedar uno en
      // memoria si discardEmptyEdit no se ejecutó). Sin esto, la celda
      // sale con `has-turno` y badge "En curso", lo que rompe el grid.
      tod = tod.filter(function (t) { return !isEmptyTurno(t); });
      var t0 = tod[0];
      var doble = info && info.role === 'first' && info.sameRow;
      var firstOfDormida = info && info.role === 'first';

      var cls = 'cal-day';
      if (ds === today()) cls += ' today';
      if (info) cls += ' dormida';
      else if (tod.length) cls += ' has-turno';
      if (doble) cls += ' cal-day-double';
      if (info && !info.sameRow) {
        cls += info.role === 'first' ? ' pair-end-right' : ' pair-end-left';
      }

      h += '<div class="' + cls + '" data-action="cal-day" data-day="' + ds + '">';

      if (doble) {
        h += '<span class="dnum">' + dn + ' · ' + (dn + 1) + '</span>';
        h += '<span class="dormida-icon" title="Dormida">🌙</span>';
        if (t0) {
          t0.servicios.forEach(function (s) { h += renderSvcBlock(s); });
          h += '<span class="estado ' + esc(t0.estado) + '">' +
            (t0.estado === 'cerrado' ? 'Cerrado' : 'En curso') + '</span>';
          if (tod.some(turnoConInformeGenerado)) {
            h += '<span class="inc-badge" title="Informe de incidencia generado">📋</span>';
          }
        }
      } else {
        h += '<span class="dnum">' + dn + '</span>';
        if (info && firstOfDormida) {
          h += '<span class="dormida-icon" title="Dormida">🌙</span>';
        }
        if (t0) {
          t0.servicios.forEach(function (s) {
            if (s.fecha !== ds) return;
            h += renderSvcBlock(s);
          });
          h += '<span class="estado ' + esc(t0.estado) + '">' +
            (t0.estado === 'cerrado' ? 'Cerrado' : 'En curso') + '</span>';
          if (tod.some(turnoConInformeGenerado)) {
            h += '<span class="inc-badge" title="Informe de incidencia generado">📋</span>';
          }
        }
      }
      h += '</div>';
    }
    h += '</div>';
    h += '<div class="cal-legend">' +
      '<span><i style="background:var(--warn)"></i> En curso</span>' +
      '<span><i style="background:var(--ok)"></i> Cerrado</span></div>';
    pane.innerHTML = h;
  }

  function renderList() {
    var pane = $('calendario-pane');
    var h = '<div class="cal-head">' +
      '<div class="cal-title" style="text-align:left;flex:1">Todos los turnos</div>' +
      '<button class="cal-toggle" data-action="cal-toggle" title="Vista cuadrícula">▦</button>' +
      '</div>';

    var sorted = turnos.slice().sort(function (a, b) {
      var fa = (a.servicios[0] && a.servicios[0].fecha) || '';
      var fb = (b.servicios[0] && b.servicios[0].fecha) || '';
      return fb.localeCompare(fa);
    });

    if (!sorted.length) {
      h += '<div class="list-empty">Aún no hay turnos registrados.<br>' +
        'Cambia a vista cuadrícula y toca un día para crear el primero.</div>';
      pane.innerHTML = h;
      return;
    }

    h += '<div class="list-grid">';
    sorted.forEach(function (t) {
      var fechas = t.servicios.map(function (s) { return s.fecha ? ymdNice(s.fecha) : '—'; });
      var rng = fechas[0];
      if (fechas.length > 1 && fechas[1] && fechas[1] !== fechas[0]) rng += ' · ' + fechas[1];
      h += '<div class="list-row" data-action="open-turno" data-id="' + t.id + '">';
      h += '<div class="lr-head">' +
        '<div class="lr-date">' + esc(rng) +
        (turnoConInformeGenerado(t) ? '<span class="inc-badge" title="Informe de incidencia generado">📋</span>' : '') +
        '</div>' +
        '<span class="badge ' + t.estado + '">' +
        (t.estado === 'cerrado' ? 'Cerrado' : 'En curso') + '</span>' +
        '<span class="lr-chev">›</span>' +
        '</div>';
      h += '<div class="lr-svc-list">';
      t.servicios.forEach(function (s) {
        var esTraslado = !!s.esTraslado;
        var num = s.servicioComercial || (esTraslado ? (s.maniobraNombre || '—') : '—');
        var hrs = (s.hSalida && s.hDestino) ? (s.hSalida + ' → ' + s.hDestino) : '—';
        var ruta = (s.origen && s.destino) ? ' · ' + s.origen + ' → ' + s.destino : '';
        var rd = parseInt(String(s.rLlegDestino || '').replace(/^\+/, ''), 10);
        var retHtml = (!isNaN(rd) && rd > 0)
          ? ' · <span class="ret">+' + rd + 'm</span>'
          : '';
        var tagHtml = esTraslado ? '<span class="svc-tag">TRASLADO</span> ' : '';
        h += '<div class="lr-svc-line' + (esTraslado ? ' traslado' : ' normal') + '">' +
          tagHtml + '<b>' + (esTraslado ? 'Traslado ' : 'Servicio ') + esc(num) + '</b> · ' + esc(hrs) + esc(ruta) + retHtml +
          '</div>';
      });
      h += '</div>';
      h += '</div>';
    });
    h += '</div>';
    pane.innerHTML = h;
  }

  function openDay(ds) {
    var tod = turnosOfDay(ds);
    if (tod.length === 0) {
      var t = blankTurno(ds);
      turnos.push(t);
      // NO save() aquí — el turno solo se persiste cuando el usuario
      // añade algún dato (autosave lo guardará). Si sale sin tocar,
      // discardEmptyEdit lo descarta de turnos[].
      openEditor(t.id);
    } else if (tod.length === 1) {
      openEditor(tod[0].id);
    } else {
      renderDayChooser(ds, tod);
    }
  }
  function renderDayChooser(ds, tod) {
    editId = null;
    var pane = $('registro-pane');
    var h = '<div class="btn-row" style="margin:0 0 14px">' +
      '<button class="btn ghost" data-action="volver">‹ Calendario</button></div>';
    h += '<h2>Turnos del ' + ymdNice(ds) + '</h2>';
    tod.forEach(function (t) {
      var labs = t.servicios.map(function (s) { return s.servicioComercial || '—'; });
      h += '<div class="card" data-action="open-turno" data-id="' + t.id + '" style="cursor:pointer">' +
        '<div class="card-title">Turno ' + esc(labs.join(' / ')) +
        ' <span class="badge ' + t.estado + '">' +
        (t.estado === 'cerrado' ? 'Cerrado' : 'En curso') + '</span></div></div>';
    });
    h += '<div class="btn-row"><button class="btn primary" data-action="new-turno" ' +
      'data-day="' + ds + '">+ Crear otro turno</button></div>';
    pane.innerHTML = h;
    setView('registro');
  }

  // ===== Editor de turno =====
  function openEditor(id) {
    editId = id;
    expandedSvc = 0;
    incidenciaAbierta = {};
    renderEditor();
    setView('registro');
    // El scroll real del editor está en #registro-pane (.pane{overflow:auto}),
    // no en window. Resetear ambos por defensa.
    var pane = document.getElementById('registro-pane');
    if (pane) pane.scrollTop = 0;
    window.scrollTo(0, 0);
    requestAnimationFrame(function () {
      if (pane) pane.scrollTop = 0;
      window.scrollTo(0, 0);
    });
  }

  // Clave única de un tramo del Libro de Horarios.
  function legKey(servicio, origen, destino) {
    return servicio + '|' + origen + '|' + destino;
  }
  // Nombre corto solo para la etiqueta del <select> (el <select> nativo recorta
  // el texto de las opciones contra el borde de la ventana con nombres largos).
  // origen/destino reales no cambian, solo lo que se ve en el desplegable.
  var SHORT_STATION = {
    'MADRID-P.ATOCHA-ALMUDENA GRANDES': 'MADRID-ATOCHA',
    'MALAGA MARIA ZAMBRANO': 'MALAGA',
    'BARCELONA-SANTS': 'BARCELONA'
  };
  function shortStation(nombre) {
    return SHORT_STATION[nombre] || nombre;
  }
  function horarioOptions(s) {
    var cur = s.servicioComercial ? legKey(s.servicioComercial, s.origen, s.destino) : '';
    var h = '<option value="">— elegir servicio —</option>';
    horarios.forEach(function (hr, i) {
      var key = legKey(hr.servicio, hr.origen, hr.destino);
      var label = hr.servicio + ' · ' + shortStation(hr.origen) + ' → ' + shortStation(hr.destino);
      h += '<option value="' + esc(key) + '" data-idx="' + i + '"' +
        (key === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    // Traslados sin horario oficial — siempre al final, aparte del orden
    // numérico de horarios.
    var curMan = s.esTraslado ? s.maniobraNombre : '';
    maniobras.forEach(function (m, i) {
      h += '<option value="man:' + i + '" data-man="' + i + '"' +
        (m.nombre === curMan ? ' selected' : '') + '>' + esc(m.nombre) + '</option>';
    });
    return h;
  }
  function ramaOptions(sel) {
    var h = '<option value="">—</option>';
    settings.ramas.forEach(function (rm) {
      h += '<option value="' + esc(rm) + '"' + (rm === sel ? ' selected' : '') +
        '>' + esc(rm) + '</option>';
    });
    return h;
  }
  // Hora LTV: solo horas en punto, rango operativo 05:00–23:00.
  function horaLtvOptions(sel) {
    var h = '<option value="">—</option>';
    for (var i = 5; i <= 23; i++) {
      var v = pad2(i) + ':00';
      h += '<option value="' + v + '"' + (v === sel ? ' selected' : '') +
        '>' + v + '</option>';
    }
    return h;
  }
  // Opciones fijas para el informe de incidencia.
  var INC_LINEAS = ['L10', 'L30', 'L40', 'L42', 'L50'];
  var INC_CABINAS = ['DM1', 'DM8'];
  function optionsFromList(list, sel) {
    var h = '<option value="">—</option>';
    list.forEach(function (v) {
      h += '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') +
        '>' + esc(v) + '</option>';
    });
    return h;
  }
  function incCocheOptions(sel) {
    var h = '<option value="">—</option>';
    for (var i = 1; i <= 8; i++) {
      h += '<option value="' + i + '"' + (String(i) === sel ? ' selected' : '') +
        '>' + i + '</option>';
    }
    return h;
  }
  // Tarjeta de una incidencia dentro del bloque "Informe de incidencia".
  // si = índice del servicio, ii = índice de la incidencia dentro de
  // s.incidencias. bind = 'srv.SI.inc.II.campo'.
  function incidenciaCardHtml(s, si, inc, ii) {
    var b = 'srv.' + si + '.inc.' + ii + '.';
    var h = '<div class="incidencia-card">';
    h += '<div class="incidencia-head">' +
      '<b>Incidencia ' + (ii + 1) + '</b>' +
      '<button type="button" class="incidencia-del" data-action="incidencia-borrar" data-svc="' + si +
      '" data-inc="' + ii + '" title="Borrar esta incidencia">✕</button>' +
      '</div>';
    h += '<div class="field-grid">' +
      '<div class="field"><label>Hora</label>' +
      '<input type="time" data-bind="' + b + 'hora" value="' + esc(inc.hora) + '"></div>' +
      '<div class="field"><label>Línea</label>' +
      '<select data-bind="' + b + 'linea">' + optionsFromList(INC_LINEAS, inc.linea) + '</select></div>' +
      '</div>' +
      '<div class="field-grid">' +
      '<div class="field"><label>Cabina conducción</label>' +
      '<select data-bind="' + b + 'cabina">' + optionsFromList(INC_CABINAS, inc.cabina) + '</select></div>' +
      '<div class="field"><label>Coche</label>' +
      '<select data-bind="' + b + 'coche">' + incCocheOptions(inc.coche) + '</select></div>' +
      '</div>' +
      '<div class="field"><label>PK / estación</label>' +
      '<input type="text" data-bind="' + b + 'pk" value="' + esc(inc.pk) + '"></div>' +
      '<div class="field"><label>Descripción de la incidencia</label>' +
      '<div class="hint" style="margin:-2px 0 4px">Se autorrellena con Observaciones durante el trayecto — editable</div>' +
      '<textarea data-bind="' + b + 'descripcion">' +
      esc(inc.descripcion || s.observaciones) + '</textarea></div>' +
      '<div class="field"><label>Medidas adoptadas</label>' +
      '<textarea data-bind="' + b + 'medidas">' + esc(inc.medidas) + '</textarea></div>' +
      '<div class="field"><label>Trenes afectados</label>' +
      '<input type="text" data-bind="' + b + 'trenes" value="' + esc(inc.trenes) + '"></div>';
    h += '<div class="btn-row" style="margin:10px 0 0; justify-content:flex-end">' +
      '<button type="button" class="btn primary" data-action="incidencia-generar" data-svc="' + si +
      '" data-inc="' + ii + '">Generar informe de incidencia</button></div>';
    h += '</div>';
    return h;
  }

  // ===== Pestaña Informe (aditiva, no toca el flujo de incidencias de
  // Registro) — genera el mismo PDF oficial vía generarInformeIncidenciaPDF,
  // reutilizada tal cual, desde un registro existente o desde cero. =====
  function blankInformeS() {
    return { fecha: today(), servicioComercial: '', rama: '', hSalida: '', hDestino: '', rSalida: '', rLlegDestino: '' };
  }
  function abrirModoInforme() {
    appModal.confirm({
      title: 'Nuevo informe',
      message: '¿Partir de un registro ya creado o empezar en blanco?',
      buttons: [
        { label: 'Desde un registro', value: 'registro', kind: 'primary' },
        { label: 'Desde cero', value: 'cero', kind: 'neutral' }
      ],
      backdropClose: true,
      dismissValue: null
    }).then(function (modo) {
      if (modo === 'registro') informeState = { modo: 'elegir-svc' };
      else if (modo === 'cero') informeState = { modo: 'form', origen: 'cero', s: blankInformeS(), inc: blankIncidencia() };
      else return; // cerrado sin elegir: se queda el botón para reintentar
      renderInforme();
    });
  }
  function applyInformeBind(bind, value) {
    if (!informeState || informeState.modo !== 'form') return;
    var p = bind.split('.'); // ['inf', 's'|'inc', campo]
    (p[1] === 's' ? informeState.s : informeState.inc)[p[2]] = value;
  }
  function renderInformeLista(pane) {
    var h = '<div class="btn-row" style="margin:0 0 14px">' +
      '<button class="btn ghost" data-action="informe-cambiar-modo">‹ Elegir modo</button></div>';
    h += '<h2>Elige un servicio</h2>';
    var sorted = turnos.slice().sort(function (a, b) {
      var fa = (a.servicios[0] && a.servicios[0].fecha) || '';
      var fb = (b.servicios[0] && b.servicios[0].fecha) || '';
      return fb.localeCompare(fa);
    });
    if (!sorted.length) {
      h += '<div class="list-empty">Aún no hay turnos registrados.</div>';
      pane.innerHTML = h;
      return;
    }
    h += '<div class="list-grid">';
    sorted.forEach(function (t) {
      var fechas = t.servicios.map(function (s) { return s.fecha ? ymdNice(s.fecha) : '—'; });
      var rng = fechas[0];
      if (fechas.length > 1 && fechas[1] && fechas[1] !== fechas[0]) rng += ' · ' + fechas[1];
      h += '<div class="list-row">';
      h += '<div class="lr-head"><div class="lr-date">' + esc(rng) + '</div>' +
        '<span class="badge ' + t.estado + '">' +
        (t.estado === 'cerrado' ? 'Cerrado' : 'En curso') + '</span></div>';
      if (t.servicios.length > 1) {
        h += '<div class="hint" style="margin:2px 0 6px">Este turno tiene ' + t.servicios.length +
          ' servicios — elige uno:</div>';
      }
      h += '<div class="svc-pick-list">';
      t.servicios.forEach(function (s, si) {
        var esTraslado = !!s.esTraslado;
        var num = s.servicioComercial || (esTraslado ? (s.maniobraNombre || '—') : '—');
        var hrs = (s.hSalida && s.hDestino) ? (s.hSalida + ' → ' + s.hDestino) : '—';
        h += '<button type="button" class="svc-pick-btn" data-action="informe-pick-svc" ' +
          'data-tid="' + t.id + '" data-si="' + si + '">' +
          '<span><b>' + (esTraslado ? 'Traslado ' : 'Servicio ') + esc(num) + '</b> · ' + esc(hrs) + '</span>' +
          '<span class="lr-chev">›</span></button>';
      });
      h += '</div></div>';
    });
    h += '</div>';
    pane.innerHTML = h;
  }
  function renderInformeForm(pane) {
    var st = informeState, s = st.s, inc = st.inc;
    var h = '<div class="btn-row" style="margin:0 0 14px">' +
      '<button class="btn ghost" data-action="informe-cambiar-modo">‹ Cambiar de modo</button></div>';
    h += '<h2>' + (st.origen === 'registro' ? 'Informe desde un registro' : 'Informe desde cero') + '</h2>';
    h += '<div class="card">';
    h += '<div class="field-grid">' +
      '<div class="field"><label>Fecha</label><input type="date" data-bind="inf.s.fecha" value="' + esc(s.fecha) + '"></div>' +
      '<div class="field"><label>Servicio</label><input type="text" data-bind="inf.s.servicioComercial" value="' + esc(s.servicioComercial) + '"></div>' +
      '</div>';
    h += '<div class="field-grid">' +
      '<div class="field"><label>Unidad de tren</label><select data-bind="inf.s.rama">' + ramaOptions(s.rama) + '</select></div>' +
      '</div>';
    h += '<div class="field-grid">' +
      '<div class="field"><label>Hora salida prevista</label><input type="text" data-bind="inf.s.hSalida" value="' + esc(s.hSalida) + '" placeholder="9:57"></div>' +
      '<div class="field"><label>Hora llegada prevista</label><input type="text" data-bind="inf.s.hDestino" value="' + esc(s.hDestino) + '" placeholder="13:21"></div>' +
      '</div>';
    h += '<div class="field-grid">' +
      '<div class="field"><label>Retraso salida</label><input type="text" data-bind="inf.s.rSalida" value="' + esc(s.rSalida) + '" placeholder="+5"></div>' +
      '<div class="field"><label>Retraso llegada</label><input type="text" data-bind="inf.s.rLlegDestino" value="' + esc(s.rLlegDestino) + '" placeholder="+5"></div>' +
      '</div>';
    h += '</div>'; // fin card datos del servicio

    h += '<div class="incidencia-block">';
    h += '<h3>Incidencia</h3>';
    h += '<div class="field-grid">' +
      '<div class="field"><label>Hora</label><input type="time" data-bind="inf.inc.hora" value="' + esc(inc.hora) + '"></div>' +
      '<div class="field"><label>Línea</label><select data-bind="inf.inc.linea">' + optionsFromList(INC_LINEAS, inc.linea) + '</select></div>' +
      '</div>';
    h += '<div class="field-grid">' +
      '<div class="field"><label>Cabina conducción</label><select data-bind="inf.inc.cabina">' + optionsFromList(INC_CABINAS, inc.cabina) + '</select></div>' +
      '<div class="field"><label>Coche</label><select data-bind="inf.inc.coche">' + incCocheOptions(inc.coche) + '</select></div>' +
      '</div>';
    h += '<div class="field"><label>PK / estación</label><input type="text" data-bind="inf.inc.pk" value="' + esc(inc.pk) + '"></div>';
    h += '<div class="field"><label>Descripción de la incidencia</label>' +
      '<textarea data-bind="inf.inc.descripcion">' + esc(inc.descripcion) + '</textarea></div>';
    h += '<div class="field"><label>Medidas adoptadas</label>' +
      '<textarea data-bind="inf.inc.medidas">' + esc(inc.medidas) + '</textarea></div>';
    h += '<div class="field"><label>Trenes afectados</label>' +
      '<input type="text" data-bind="inf.inc.trenes" value="' + esc(inc.trenes) + '"></div>';
    h += '</div>'; // fin incidencia-block

    h += '<div class="btn-row" style="margin:14px 0 0;justify-content:flex-end">' +
      '<button class="btn primary" data-action="informe-generar">Generar informe de incidencia</button></div>';
    pane.innerHTML = h;
  }
  function renderInforme() {
    var pane = $('informe-pane');
    if (!pane) return;
    if (!informeState) {
      pane.innerHTML = '<div class="card" style="text-align:center;padding:32px 20px">' +
        '<h2 style="margin-bottom:6px">Informe de incidencia</h2>' +
        '<div class="hint" style="margin-bottom:18px">Genera el informe oficial partiendo de un registro o desde cero.</div>' +
        '<div class="btn-row" style="justify-content:center">' +
        '<button class="btn primary" data-action="informe-elegir-modo">Elegir modo de informe</button></div></div>';
      abrirModoInforme();
      return;
    }
    if (informeState.modo === 'elegir-svc') { renderInformeLista(pane); return; }
    renderInformeForm(pane);
  }

  // Estado del editor inline de retraso (sólo uno activo a la vez).
  var activeRetBind = null;
  // Contador del gesto "modo desarrollador" en Ajustes (7 toques en
  // "Versión instalada", con reinicio si pasan >2s entre toques).
  var versionTapCount = 0;
  var versionTapTimer = null;

  // ownerIdx: -1 = origen; 0..n-1 = paradas[i]. Devuelve solo paradas
  // posteriores (no se puede ir hacia atrás en la marcha).
  function pmrOptionsFor(s, ownerIdx, selected) {
    var opts = ['<option value="">— elegir parada —</option>'];
    var add = function (n) {
      if (!n) return;
      opts.push('<option value="' + esc(n) + '"' +
        (n === selected ? ' selected' : '') + '>' + esc(n) + '</option>');
    };
    var startIdx = ownerIdx + 1;
    for (var i = startIdx; i < s.paradas.length; i++) add(s.paradas[i].nombre);
    add(s.destino);
    // Opción final para cuando el pasajero se baja en un punto no listado
    // (no es ninguna parada real del servicio) — se guarda tal cual en
    // p.baja, igual que cualquier otro nombre de parada.
    opts.push('<option value="OTRA"' +
      (selected === 'OTRA' ? ' selected' : '') +
      '>OTRA</option>');
    return opts.join('');
  }

  function retInlineHtml(bind, val) {
    if (!bind) return '';
    if (activeRetBind === bind) {
      return '<input class="ret-input" type="text" inputmode="text" ' +
        'placeholder="min o HH:MM" value="' + esc(val || '') + '" ' +
        'data-ret-bind="' + esc(bind) + '" autofocus>';
    }
    var min = parseRetraso(val);
    if (min != null && isFinite(min) && min !== 0) {
      var cls = 'ret-val' + (min < 0 ? ' early' : '');
      return '<button class="' + cls + '" data-action="ret-edit" ' +
        'data-ret-bind="' + esc(bind) + '">' + fmtRetraso(min) + ' ✎</button>';
    }
    return '<button class="ret-add" data-action="ret-edit" ' +
      'data-ret-bind="' + esc(bind) + '">+ Retraso</button>';
  }
  // Botón junto al campo de retraso manual: calcula retraso/adelanto
  // comparando la hora programada con la hora actual del dispositivo.
  function retNowBtnHtml(bind, hora) {
    if (!bind || !hora) return '';
    return '<button class="ret-now" type="button" data-action="ret-now" ' +
      'data-ret-bind="' + esc(bind) + '" data-ret-hora="' + esc(hora) + '" ' +
      'title="Marcar retraso/adelanto según la hora actual">⏱</button>';
  }
  // Igual que retNowBtnHtml pero para traslados sin horario oficial — no
  // hay hora programada contra la que calcular retraso, así que el botón
  // escribe la hora actual directamente en el campo de hora.
  function horaNowBtnHtml(bind) {
    if (!bind) return '';
    return '<button class="ret-now" type="button" data-action="hora-now" ' +
      'data-hora-bind="' + esc(bind) + '" title="Marcar hora actual">⏱</button>';
  }

  function stationCard(tipo, si, cfg) {
    var badgeTxt = tipo === 'origin' ? 'ORIGEN' :
      tipo === 'destination' ? 'DESTINO' : 'PARADA';
    var h = '<div class="station-card ' + tipo + '">';
    h += '<div class="st-head">' +
      '<span class="st-badge ' + tipo + '">' + badgeTxt + '</span>';
    if (cfg.parIdx != null && cfg.editable) {
      h += '<input type="text" class="st-name-input" placeholder="Estación" ' +
        'data-bind="srv.' + si + '.par.' + cfg.parIdx + '.nombre" ' +
        'value="' + esc(cfg.nombre || '') + '">';
    } else {
      h += '<span class="st-name">' + esc(cfg.nombre || '—');
      if (cfg.pmrBaja) h += ' <span class="pmr-warn" title="PMR baja aquí">♿</span>';
      h += '</span>';
    }
    // Mini "+" inserta una parada NUEVA antes de la actual.
    if (cfg.parIdx != null) {
      h += '<button class="st-add" data-action="add-parada-before" ' +
        'data-svc="' + si + '" data-par="' + cfg.parIdx + '" ' +
        'title="Añadir parada antes">+</button>';
      h += '<button class="st-del" data-action="del-parada" ' +
        'data-svc="' + si + '" data-par="' + cfg.parIdx + '" ' +
        'title="Quitar parada">🗑</button>';
    } else if (tipo === 'destination') {
      // El destino tiene un mini "+" para añadir parada al final.
      h += '<button class="st-add" data-action="add-parada-end" ' +
        'data-svc="' + si + '" title="Añadir parada al final">+</button>';
    }
    h += '</div>';
    h += '<div class="st-body">';
    h += '<div class="st-times">';
    if (cfg.horaLlegada || cfg.editLlegada) {
      var retLlegMin = parseRetraso(cfg.valRetLleg);
      var horaRealLleg = (cfg.horaLlegada && retLlegMin) ? addMinutos(cfg.horaLlegada, retLlegMin) : '';
      h += '<div class="st-row"><span class="st-lbl">H. Llegada</span>' +
        '<div class="st-time-col">';
      if (cfg.editLlegada) {
        h += '<input type="time" data-bind="' + cfg.bindHoraLlegada + '" value="' +
          esc(cfg.horaLlegada || '') + '">';
      } else {
        h += '<span class="st-h">' + esc(cfg.horaLlegada) + '</span>';
      }
      if (horaRealLleg) h += '<span class="st-real' + (retLlegMin < 0 ? ' early' : '') + '">' + horaRealLleg + '</span>';
      h += '</div>' + (cfg.esTraslado ?
        horaNowBtnHtml(cfg.bindHoraLlegada) :
        retInlineHtml(cfg.bindRetLleg, cfg.valRetLleg) + retNowBtnHtml(cfg.bindRetLleg, cfg.horaLlegada)
      ) + '</div>';
    }
    if (cfg.horaSalida || cfg.editSalida) {
      var retSalMin = parseRetraso(cfg.valRetSal);
      var horaRealSal = (cfg.horaSalida && retSalMin) ? addMinutos(cfg.horaSalida, retSalMin) : '';
      h += '<div class="st-row"><span class="st-lbl">H. Salida</span>' +
        '<div class="st-time-col">';
      if (cfg.editSalida) {
        h += '<input type="time" data-bind="' + cfg.bindHoraSalida + '" value="' +
          esc(cfg.horaSalida || '') + '">';
      } else {
        h += '<span class="st-h">' + esc(cfg.horaSalida) + '</span>';
      }
      if (horaRealSal) h += '<span class="st-real' + (retSalMin < 0 ? ' early' : '') + '">' + horaRealSal + '</span>';
      h += '</div>' + (cfg.esTraslado ?
        horaNowBtnHtml(cfg.bindHoraSalida) :
        retInlineHtml(cfg.bindRetSal, cfg.valRetSal) + retNowBtnHtml(cfg.bindRetSal, cfg.horaSalida)
      ) + '</div>';
    }
    h += '</div>';
    if (cfg.pax) h += '<div class="st-pax">' + cfg.pax + '</div>';
    h += '</div></div>';
    return h;
  }

  // Lista PMR para una estación. ownerIdx = -1 (origen) o índice de parada.
  // bindPrefix = 'srv.X' para origen, 'srv.X.par.Y' para parada intermedia.
  function pmrListHtml(s, ownerIdx, pmrArr, si, bindPrefix) {
    var parAttr = ownerIdx >= 0 ? (' data-par="' + ownerIdx + '"') : '';
    var h = '<div class="pmr-block"><label>PMR (plazas H)</label>';
    (pmrArr || []).forEach(function (p, i) {
      h += '<div class="pmr-item">' +
        '<select data-bind="' + bindPrefix + '.pmr.' + i + '.baja">' +
        pmrOptionsFor(s, ownerIdx, p.baja) + '</select>' +
        '<button class="pmr-del" data-action="del-pmr" data-svc="' + si +
        '"' + parAttr + ' data-pmr="' + i + '" title="Quitar PMR">×</button>' +
        '</div>';
    });
    h += '<button class="btn ghost" data-action="add-pmr" data-svc="' + si +
      '"' + parAttr +
      ' style="font-size:12px;padding:5px 10px;min-height:32px">+ Añadir PMR</button>';
    h += '</div>';
    return h;
  }

  function paxBlockOrigen(s, si) {
    var h = '<div class="pax-block">';
    h += '<div class="pax-row"><label>Viajeros</label>' +
      '<input type="number" inputmode="numeric" data-bind="srv.' + si +
      '.viajeros" value="' + esc(s.viajeros) + '"></div>';
    h += '<div class="pax-row"><label>Asistencias</label>' +
      '<input type="number" inputmode="numeric" data-bind="srv.' + si +
      '.asistencias" value="' + esc(s.asistencias) + '"></div>';
    h += pmrListHtml(s, -1, s.pmr, si, 'srv.' + si);
    h += '</div>';
    return h;
  }

  function paxBlockParada(s, p, si, pi) {
    var h = '<div class="pax-block">';
    h += '<div class="pax-row"><label>Viajeros</label>' +
      '<input type="number" inputmode="numeric" data-bind="srv.' + si +
      '.par.' + pi + '.viajeros" value="' + esc(p.viajeros) + '"></div>';
    h += '<div class="pax-row"><label>Asistencias</label>' +
      '<input type="number" inputmode="numeric" data-bind="srv.' + si +
      '.par.' + pi + '.asistencias" value="' + esc(p.asistencias) + '"></div>';
    h += pmrListHtml(s, pi, p.pmr, si, 'srv.' + si + '.par.' + pi);
    h += '</div>';
    return h;
  }

  function stationsBlock(s, si) {
    var h = '<div class="stations">';
    var esTraslado = !!s.esTraslado;
    // Origen
    h += stationCard('origin', si, {
      nombre: s.origen || '(origen)',
      horaSalida: s.hSalida,
      horaLlegada: '',
      editSalida: esTraslado,
      bindHoraSalida: 'srv.' + si + '.hSalida',
      esTraslado: esTraslado,
      bindRetSal: 'srv.' + si + '.rSalida',
      valRetSal: s.rSalida,
      pax: esTraslado ? '' : paxBlockOrigen(s, si)
    });
    // Paradas intermedias
    s.paradas.forEach(function (p, pi) {
      var nuevaSinDatos = !p.nombre && !p.hora;
      var hasPmrInt = (s.pmr || []).some(function (pr) {
        return pr.baja && p.nombre && normName(pr.baja) === normName(p.nombre);
      });
      var hLlegParada = p.hLleg || (p.tParada > 0 ? subMinutos(p.hora, p.tParada) : '');
      h += stationCard('intermediate', si, {
        nombre: p.nombre,
        parIdx: pi,
        editable: nuevaSinDatos,
        pmrBaja: hasPmrInt,
        horaLlegada: hLlegParada,
        horaSalida: p.hora,
        editLlegada: esTraslado,
        bindHoraLlegada: 'srv.' + si + '.par.' + pi + '.hLleg',
        editSalida: esTraslado || !p.hora,
        bindHoraSalida: 'srv.' + si + '.par.' + pi + '.hora',
        esTraslado: esTraslado,
        bindRetLleg: 'srv.' + si + '.par.' + pi + '.rLleg',
        valRetLleg: p.rLleg,
        bindRetSal: 'srv.' + si + '.par.' + pi + '.rSal',
        valRetSal: p.rSal,
        pax: esTraslado ? '' : paxBlockParada(s, p, si, pi)
      });
    });
    // Destino (con mini "+" para añadir parada al final)
    var hasPmrDest = (s.pmr || []).some(function (pr) {
      return pr.baja && s.destino && normName(pr.baja) === normName(s.destino);
    });
    h += stationCard('destination', si, {
      nombre: s.destino || '(destino)',
      pmrBaja: hasPmrDest,
      horaLlegada: s.hDestino,
      horaSalida: '',
      editLlegada: esTraslado,
      bindHoraLlegada: 'srv.' + si + '.hDestino',
      esTraslado: esTraslado,
      bindRetLleg: 'srv.' + si + '.rLlegDestino',
      valRetLleg: s.rLlegDestino,
      pax: ''
    });
    h += '</div>';
    return h;
  }

  function servicioInner(t, si) {
    var s = t.servicios[si];
    var dos = t.servicios.length > 1;
    var h = '';
    var titulo = s.servicioComercial ? esc(s.servicioComercial) : String(si + 1);
    var prefijo = s.esTraslado ? 'Traslado ' : 'Servicio ';

    // Cabecera card-title con LTV inline a la derecha
    h += '<div class="svc-card-title">';
    if (dos) {
      h += '<button type="button" class="title-toggle" ' +
        'data-action="svc-toggle" data-svc="' + si + '">' +
        prefijo + '<span id="svc-titulo-' + si + '">' + titulo + '</span><span class="chev">▴</span></button>';
    } else {
      h += '<div class="title-static">' + prefijo + '<span id="svc-titulo-' + si + '">' + titulo + '</span></div>';
    }
    if (svcConInformeGenerado(s)) {
      h += '<span class="inc-badge" title="Informe de incidencia generado">📋</span>';
    }
    h += '<div class="ltv-inline">' +
      '<label class="turno-horario-check" title="Horario de turno (toma / deje / descanso)">' +
      '<span>Turno</span><input type="checkbox" data-action="turno-horario-toggle"' +
      (t.turnoHorarioActivo ? ' checked' : '') + '></label>' +
      '<label>Hora LTV</label>' +
      '<select data-bind="srv.' + si + '.horaLTV">' +
      horaLtvOptions(s.horaLTV) + '</select>' +
      '</div>';
    h += '</div>';

    // Horario de turno (toma/deje/descanso) — opcional, dato de todo el
    // turno (no del servicio), igual en las dos cards si es dormida.
    if (t.turnoHorarioActivo) {
      h += '<div class="field-grid" style="grid-template-columns:repeat(3,1fr)">' +
        '<div class="field"><label>Toma</label><input type="time" data-bind="toma" value="' + esc(t.toma) + '"></div>' +
        '<div class="field"><label>Deje</label><input type="time" data-bind="deje" value="' + esc(t.deje) + '"></div>' +
        '<div class="field"><label>Descanso</label><input type="text" data-bind="descanso" value="' + esc(t.descanso) + '" placeholder="min"></div>' +
        '</div>';
    }

    // Fecha + Servicio Comercial [+ Nº de traslado, seguido a la derecha
    // del desplegable, en la misma fila — no en una fila aparte].
    h += '<div class="field-grid" style="grid-template-columns:' +
      (s.esTraslado ? '130px 1fr 110px' : '130px 1fr') + '">' +
      '<div class="field"><label>Fecha</label>' +
      '<input type="date" data-bind="srv.' + si + '.fecha" value="' + esc(s.fecha) + '"></div>' +
      '<div class="field"><label>Servicio Comercial</label>';
    if (horarios.length) {
      h += '<select data-bind="srv.' + si + '.servicioComercial" data-svc="' + si +
        '" class="srv-sel">' + horarioOptions(s) + '</select>';
    } else {
      h += '<input type="text" data-bind="srv.' + si + '.servicioComercial" value="' +
        esc(s.servicioComercial) + '" placeholder="Nº de servicio">';
    }
    h += '</div>';
    if (s.esTraslado) {
      h += '<div class="field"><label>Nº</label>' +
        '<input type="text" inputmode="numeric" class="svc-man-num" data-bind="srv.' + si + '.servicioComercial" value="' +
        esc(s.servicioComercial) + '" placeholder="Número"></div>';
    }
    h += '</div>';
    if (s.origen || s.destino) {
      h += '<div class="hint" style="margin:-6px 0 11px">' +
        esc(s.origen) + ' → ' + esc(s.destino) + '</div>';
    }

    // Vía + Rama
    h += '<div class="field-grid">' +
      '<div class="field"><label>Vía</label>' +
      '<input type="text" data-bind="srv.' + si + '.via" value="' + esc(s.via) + '"></div>' +
      '<div class="field"><label>Rama</label>' +
      '<select data-bind="srv.' + si + '.rama">' + ramaOptions(s.rama) + '</select></div>' +
      '</div>';

    // N1 — no aplica en traslados (sin conductor/N1 asignado como tal).
    h += '<div class="field"><label class="red">N1</label>' +
      '<input type="text" data-bind="srv.' + si + '.n1" value="' +
      esc(s.n1) + '" placeholder="Nombre"' + (s.esTraslado ? ' disabled' : '') + '></div>';

    // Estaciones (card por estación)
    h += stationsBlock(s, si);

    // Comprobaciones — plegable (abierto por defecto, se pliega solo en
    // cuanto hay hora de salida real; el toggle manual manda siempre que
    // se haya tocado). Estilo plano, mismo patrón que el título del
    // servicio (title-toggle + chev), sin tarjeta ni color propio.
    var chkAbierto = comprobacionesOpen(si, s);
    h += '<button type="button" class="section-toggle" data-action="comprobaciones-toggle" ' +
      'data-svc="' + si + '">Comprobaciones<span class="chev">' + (chkAbierto ? '▴' : '▾') + '</span></button>';
    if (chkAbierto) {
      h += '<div class="checks">';
      COMPROBACIONES.forEach(function (c, ci) {
        h += '<label class="check-item">' +
          '<input type="checkbox" data-bind="srv.' + si + '.chk.' + ci + '"' +
          (s.comprobaciones[ci] ? ' checked' : '') + '>' +
          '<span>' + esc(c) + '</span></label>';
      });
      h += '</div>';
    }

    // Observaciones a ancho completo; telefonemas ya recibidos en este
    // servicio justo debajo, también a ancho completo.
    h += '<div class="field" style="margin-top:12px">' +
      '<label style="color:#a371f7">Observaciones durante el trayecto</label>' +
      '<div class="obs-atajos">' +
      OBS_ATAJOS.map(function (a) {
        return '<button type="button" class="btn ghost" data-action="obs-atajo" ' +
          'data-svc="' + si + '" data-atajo="' + a.id + '">' + esc(a.label) + '</button>';
      }).join('') +
      '</div>' +
      '<div class="obs-wrapper" data-svc="' + si + '">' +
      '<textarea data-bind="srv.' + si + '.observaciones">' + esc(s.observaciones) + '</textarea>' +
      '</div></div>';
    if (s.telefonemas && s.telefonemas.length) {
      h += '<div class="tel-list">';
      s.telefonemas.forEach(function (tel, ti) {
        var punto = (tel.campos && tel.campos.punto) ? tel.campos.punto : '';
        h += '<div class="tel-chip color-' + esc(tel.color || 'rc') + '" data-action="telefonema-abrir" data-svc="' + si + '" data-tel="' + ti + '">' +
          '<div class="tel-chip-head"><b>' + esc(tel.codigo) + '</b><span>' + esc(tel.hora || '') + '</span></div>' +
          (tel.numTel || punto ? '<div class="tel-chip-sub">' +
            (tel.numTel ? 'nº ' + esc(tel.numTel) : '') +
            (tel.numTel && punto ? ' · ' : '') + esc(punto) +
            '</div>' : '') +
          (tel.cumplimentado || tel.transferido ?
            '<div class="tel-chip-flags">' +
            '<span class="tel-flag on">✓ ' + (tel.cumplimentado ? 'Cumplimentado' : 'Transferido') + '</span>' +
            '</div>' : '') +
          '</div>';
      });
      h += '</div>';
    }
    // Registro solo ofrece ETC/LZB para rellenar — el resto de grupos
    // (ABA, ARS, IVC, RET, SOC...) son de solo consulta en la pestaña
    // Telefonemas, no se rellenan desde aquí. Ocultos salvo telDevMode
    // (Ajustes → toca 7 veces "Versión instalada").
    var CATS_REGISTRO = settings.telDevMode ?
      TELEFONEMAS.filter(function (c) { return c.cat === 'ETC' || c.cat === 'LZB'; }) : [];
    if (CATS_REGISTRO.length) {
      h += '<div class="tel-cats">';
      CATS_REGISTRO.forEach(function (c) {
        h += '<button class="btn ghost" data-action="telefonema-cat" data-svc="' + si +
          '" data-cat="' + esc(c.cat) + '">' + esc(c.catLabel) + '</button>';
      });
      h += '</div>';
    }
    h += '<div class="obs-actions">' +
      '<button class="btn ghost" data-action="dictar" data-svc="' + si + '">🎤 Dictar</button>' +
      '<button type="button" class="btn ghost" data-action="incidencia" data-svc="' + si +
      '" style="margin-left:auto">📋 Informe de incidencia ' +
      (incidenciaAbierta[si] ? '▴' : '▾') + '</button>' +
      '</div>';

    // Informe de incidencia — oculto hasta que se pulsa el botón inferior
    // "Informe de incidencia". Puede haber varias incidencias en el mismo
    // servicio, cada una con sus propios campos y su propio PDF.
    if (incidenciaAbierta[si]) {
      h += '<div class="incidencia-block">';
      h += '<h3>📋 Informe de incidencia</h3>';
      if (!s.incidencias.length) {
        h += '<div class="hint" style="margin:-4px 0 11px">Sin incidencias todavía en este servicio.</div>';
      }
      s.incidencias.forEach(function (inc, ii) {
        h += incidenciaCardHtml(s, si, inc, ii);
      });
      h += '<div class="btn-row" style="margin:10px 0 0">' +
        '<button type="button" class="btn ghost" data-action="incidencia-add" data-svc="' + si +
        '">+ Añadir otra incidencia</button></div>';
      h += '</div>';
    }

    h += (dos ? '<button class="btn ghost" data-action="del-servicio" data-svc="' + si +
      '" style="margin-top:14px;color:var(--bad);border-color:var(--bad)">🗑 Quitar este servicio</button>' : '');
    h += '</div>';

    return h;
  }

  function renderEditor() {
    var t = getTurno(editId);
    if (!t) { renderCalendar(); setView('calendario'); return; }
    normTurno(t);
    var pane = $('registro-pane');
    var cerrado = t.estado === 'cerrado';
    var h = '';

    h += '<div class="btn-row" style="margin:0 0 12px">' +
      '<button class="btn ghost" data-action="volver">‹ Calendario</button>' +
      '<span class="badge ' + t.estado + '" style="align-self:center">' +
      (cerrado ? 'Cerrado' : 'En curso') + '</span>';
    h += '<span class="tel-cabecera">' +
      (settings.telefono ? '📞 ' + esc(settings.telefono) : '') + '</span>';
    if (t.servicios.length < 2) {
      h += '<button class="btn" data-action="add-servicio">' +
        '+ Añadir 2º servicio</button>';
    }
    h += '</div>';

    // Servicios — acordeón: solo expandedSvc abierto.
    if (expandedSvc >= t.servicios.length) expandedSvc = 0;
    h += '<div class="servicios">';
    t.servicios.forEach(function (s, si) {
      if (si === expandedSvc) {
        h += '<div class="card servicio-card" id="svc-card-' + si + '">' +
          servicioInner(t, si) + '</div>';
      } else {
        var num = s.servicioComercial ? esc(s.servicioComercial) : String(si + 1);
        var ruta = (s.origen || s.destino)
          ? esc(s.origen) + ' → ' + esc(s.destino)
          : '<span style="color:var(--fg-dim);font-weight:400">sin datos</span>';
        h += '<button type="button" class="svc-collapsed" data-action="svc-toggle" data-svc="' + si + '">' +
          '<span class="svc-c-num">Servicio ' + num + '</span>' +
          '<span class="svc-c-ruta">' + ruta + '</span>' +
          (svcConInformeGenerado(s) ? '<span class="inc-badge" title="Informe de incidencia generado">📋</span>' : '') +
          '<span class="chev">▾</span>' +
          '</button>';
      }
    });
    h += '</div>';

    // Acciones
    h += '<div class="btn-row" style="margin-top:18px">';
    if (cerrado) {
      h += '<button class="btn" data-action="reabrir">Reabrir turno</button>';
    } else {
      h += '<button class="btn primary" data-action="cerrar">Cerrar turno</button>';
    }
    h += '<button class="btn danger" data-action="borrar">Borrar turno</button>';
    h += '</div>';

    pane.innerHTML = h;
  }

  function refreshServicioCard(si) {
    var t = getTurno(editId);
    var card = $('svc-card-' + si);
    if (t && card) card.innerHTML = servicioInner(t, si);
  }

  function applyBind(bind, value) {
    var t = getTurno(editId);
    if (!t) return;
    var p = bind.split('.');
    if (p[0] === 'srv') {
      var s = t.servicios[+p[1]];
      if (!s) return;
      if (p[2] === 'par') {
        var par = s.paradas[+p[3]];
        if (par) {
          if (p[4] === 'pmr') {
            if (!Array.isArray(par.pmr)) par.pmr = [];
            var pm0 = par.pmr[+p[5]];
            if (pm0) pm0[p[6]] = value;
          } else {
            par[p[4]] = value;
          }
        }
      } else if (p[2] === 'chk') {
        s.comprobaciones[+p[3]] = value;
      } else if (p[2] === 'pmr') {
        var pm = s.pmr[+p[3]];
        if (pm) pm[p[4]] = value;
      } else if (p[2] === 'inc') {
        var inc = s.incidencias[+p[3]];
        if (inc) inc[p[4]] = value;
      } else {
        s[p[2]] = value;
      }
    } else {
      t[p[0]] = value;
    }
    autosave();
    // Si cambió pmr.baja, refrescar la card del servicio para mostrar/quitar ⚠
    var pmrM = bind.match(/^srv\.(\d+)\..*pmr\.\d+\.baja$/);
    if (pmrM) refreshServicioCard(+pmrM[1]);
  }

  // Un retraso editado a mano en RV queda "congelado": el cross-feed de HT
  // (app.js applyDelaysToSvc) ya no lo vuelve a machacar con el valor en vivo.
  var RET_FROZEN_FIELD = { rSalida: '_rSalidaFrozen', rLlegDestino: '_rLlegDestinoFrozen',
    rLleg: '_rLlegFrozen', rSal: '_rSalFrozen' };
  function markRetFrozen(bind) {
    var t = getTurno(editId);
    if (!t) return;
    var p = bind.split('.');
    if (p[0] !== 'srv') return;
    var s = t.servicios[+p[1]];
    if (!s) return;
    var target = s, field;
    if (p[2] === 'par') {
      target = s.paradas[+p[3]];
      field = p[4];
    } else {
      field = p[2];
    }
    var frozenField = RET_FROZEN_FIELD[field];
    if (target && frozenField) target[frozenField] = true;
  }

  // ===== Dictado por voz (Web Speech API) =====
  var currentRec = null;
  var currentRecSvc = null;
  // Intención del usuario: Android ignora continuous y corta por silencio a los
  // pocos segundos (dispara onend). Mientras wantDictado siga true, reiniciamos
  // el reconocimiento para que el dictado sea continuo hasta pulsar Detener.
  var wantDictado = false;
  function startDictado(si) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      appModal.alert({ title: 'Dictado no disponible', message: 'Tu navegador no soporta dictado por voz. Usa el teclado de escritura a mano de la tablet.' });
      return;
    }
    var t = getTurno(editId);
    if (!t) return;
    var s = t.servicios[si];
    if (!s) return;
    var rec = new SR();
    rec.lang = 'es-ES';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = function (e) {
      var txt = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) txt += e.results[i][0].transcript + ' ';
      }
      txt = txt.trim();
      if (txt) {
        s.observaciones = (s.observaciones ? s.observaciones + ' ' : '') + txt;
        autosave();
        var ta = document.querySelector('[data-bind="srv.' + si + '.observaciones"]');
        if (ta) ta.value = s.observaciones;
      }
    };
    rec.onerror = function (e) {
      // Silencio o aborto: no avisar ni parar — onend reiniciará si seguimos.
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantDictado = false; stopDictado();
        appModal.alert({ title: 'Micrófono bloqueado', message: 'Hay que permitir el micrófono para dictar.' });
      } else {
        wantDictado = false; stopDictado();
        appModal.alert({ title: 'Error de dictado', message: 'Error de dictado: ' + e.error });
      }
    };
    rec.onend = function () {
      if (currentRec !== rec) return;
      // Android corta por silencio: reiniciar mientras el usuario siga queriendo.
      if (wantDictado) {
        try { rec.start(); return; }
        catch (err) {
          try { currentRec = null; startDictado(si); return; } catch (e2) {}
        }
      }
      currentRec = null; currentRecSvc = null;
      updateDictarBtn();
    };
    try {
      rec.start();
      currentRec = rec;
      currentRecSvc = si;
      wantDictado = true;
      updateDictarBtn();
    } catch (err) {
      // start() puede tirar InvalidStateError si ya hay sesión activa
    }
  }
  function stopDictado() {
    wantDictado = false;
    var wasSvc = currentRecSvc;
    if (currentRec) {
      try { currentRec.stop(); } catch (e) {}
      currentRec = null; currentRecSvc = null;
    }
    updateDictarBtn();
    // Al terminar de dictar, recuperar cualquier repintado que se saltara
    // (refreshEditor se saltaba mientras currentRec estaba activo).
    if (wasSvc != null && editId != null) refreshServicioCard(wasSvc);
  }
  function updateDictarBtn() {
    document.querySelectorAll('[data-action="dictar"]').forEach(function (b) {
      var si = +b.getAttribute('data-svc');
      if (si === currentRecSvc) {
        b.classList.add('rec');
        b.classList.remove('ghost');
        b.textContent = '🛑 Detener';
      } else {
        b.classList.remove('rec');
        b.classList.add('ghost');
        b.textContent = '🎤 Dictar';
      }
    });
  }

  // ===== Telefonemas =====
  // Categoría → elegir variante (código) → se crea un registro persistido en
  // s.telefonemas[] (sobrevive al cerrar y se puede reabrir/completar más
  // tarde — recibir el telefonema y cumplimentarlo no siempre es el mismo
  // instante). Observaciones solo recibe una línea corta de referencia.
  function buscarVarianteTelefonema(cat, codigo) {
    var categoria = TELEFONEMAS.find(function (c) { return c.cat === cat; });
    var variante = categoria && categoria.variantes.find(function (v) { return v.codigo === codigo; });
    return variante ? { categoria: categoria, variante: variante } : null;
  }
  function blankTelefonema(categoria, variante, s0, nombreCompleto, horaActual) {
    var campos = {}, opcionales = {};
    variante.partes.forEach(function (p) {
      if (p.t === 'campo') campos[p.id] = (p.id === 'tren' && s0.servicioComercial) ? s0.servicioComercial : '';
      else if (p.t === 'opcional') opcionales[p.id] = false;
    });
    return {
      cat: categoria.cat, codigo: variante.codigo, color: variante.color || categoria.color || 'rc',
      fecha: s0.fecha, numTel: '', hora: horaActual, de: '', a: s0.servicioComercial || '',
      campos: campos, opcionales: opcionales,
      info: '', emisor: '', firma: nombreCompleto,
      cumplimentado: false, transferido: false, matricula: '', firmaEntrante: ''
    };
  }
  // Línea de Observaciones para un telefonema guardado: acrónimo, hora, el
  // texto completo (huecos vacíos como "___") y si se ha transferido.
  function composeObsLineTelefonema(tel, variante) {
    var texto = variante.partes.map(function (p) {
      if (p.t === 'text') return p.v;
      if (p.t === 'campo') return tel.campos[p.id] || '___';
      if (p.t === 'opcional') return tel.opcionales[p.id] ? p.v : '';
      return '';
    }).join('');
    var linea = tel.codigo + ' · ' + (tel.hora || '') + ' — ' + texto;
    if (tel.transferido) linea += ' · Transferido';
    return linea;
  }
  // ===== Atajos de Observaciones =====
  // Compone la línea final uniendo las partes fijas con los valores
  // tecleados/elegidos — mismo patrón que composeObsLineTelefonema, hueco
  // vacío se marca con '___' en vez de quedarse en blanco sin más.
  function componerTextoAtajo(atajo, valores) {
    return atajo.partes.map(function (p) {
      if (p.t === 'text') return p.v;
      // Tramo condicional: si el campo se deja vacío, no añade nada (ni
      // el prefijo fijo ni '___') — a diferencia de un 'campo' normal.
      if (p.t === 'campoCondicional') return valores[p.id] ? p.prefijo + valores[p.id] : '';
      return valores[p.id] || '___';
    }).join('');
  }
  function abrirObsAtajo(atajoId, si) {
    var atajo = OBS_ATAJOS.find(function (a) { return a.id === atajoId; });
    if (!atajo) return;
    appModal.custom({
      className: 'narrow',
      backdropClose: true,
      dismissValue: null,
      render: function (box, resolveWith) {
        box.innerHTML = '';
        var ttl = document.createElement('div'); ttl.className = 'modal-title';
        ttl.textContent = atajo.label;
        box.appendChild(ttl);

        // La frase completa en una sola línea corrida, con los huecos como
        // input/select insertados dentro del propio texto — así se ve el
        // contexto de lo que se está rellenando, no solo el nombre del campo.
        var frase = document.createElement('div'); frase.className = 'atajo-frase';
        var inputs = {};
        atajo.partes.forEach(function (p) {
          if (p.t === 'text') {
            frase.appendChild(document.createTextNode(p.v));
            return;
          }
          var el;
          if (p.options) {
            el = document.createElement('select'); el.className = 'atajo-inline-select';
            p.options.forEach(function (opt) {
              var o = document.createElement('option'); o.value = opt; o.textContent = opt;
              el.appendChild(o);
            });
          } else {
            el = document.createElement('input'); el.type = 'text'; el.className = 'atajo-inline-input';
            el.placeholder = p.label;
            autosizeCh(el, Math.max(6, p.label.length));
          }
          el.title = p.label;
          frase.appendChild(el);
          inputs[p.id] = el;
        });
        box.appendChild(frase);

        var acts = document.createElement('div'); acts.className = 'modal-actions';
        var btnCancel = document.createElement('button'); btnCancel.type = 'button';
        btnCancel.className = 'modal-btn neutral'; btnCancel.textContent = 'Cancelar';
        btnCancel.addEventListener('click', function () { resolveWith(null); });
        acts.appendChild(btnCancel);
        var btnOk = document.createElement('button'); btnOk.type = 'button';
        btnOk.className = 'modal-btn primary'; btnOk.textContent = 'Insertar';
        btnOk.addEventListener('click', function () {
          var valores = {};
          Object.keys(inputs).forEach(function (id) { valores[id] = (inputs[id].value || '').trim(); });
          resolveWith(valores);
        });
        acts.appendChild(btnOk);
        box.appendChild(acts);
      }
    }).then(function (valores) {
      if (!valores) return;
      var t = getTurno(editId);
      var s = t && t.servicios[si];
      if (!s) return;
      var linea = componerTextoAtajo(atajo, valores);
      // Viñeta delante — se nota como "punto aparte" generado por un
      // atajo, distinto de lo escrito a mano o dictado.
      s.observaciones = (s.observaciones ? s.observaciones + '\n' : '') + '• ' + linea;
      autosave();
      var ta = document.querySelector('[data-bind="srv.' + si + '.observaciones"]');
      if (ta) ta.value = s.observaciones;
    });
  }

  function abrirTelefonemaCategoria(cat, si) {
    var categoria = TELEFONEMAS.find(function (c) { return c.cat === cat; });
    if (!categoria) return;
    // Ventana propia (no appModal.confirm) para poder mostrar dos líneas por
    // botón — código + a qué telefonema corresponde — y un color de fondo
    // discreto (franja, no relleno sólido) en vez de botones muy verdes.
    appModal.custom({
      className: 'narrow',
      backdropClose: true,
      dismissValue: null,
      render: function (box, resolveWith) {
        box.innerHTML = '';
        var ttl = document.createElement('div'); ttl.className = 'modal-title';
        ttl.style.textAlign = 'center';
        ttl.textContent = categoria.catLabel;
        box.appendChild(ttl);

        var list = document.createElement('div'); list.className = 'tel-picker';
        categoria.variantes.forEach(function (v) {
          var b = document.createElement('button'); b.type = 'button';
          b.className = 'tel-picker-btn color-' + (v.color || categoria.color || 'rc');
          var code = document.createElement('div'); code.className = 'tel-picker-code'; code.textContent = v.codigo;
          var name = document.createElement('div'); name.className = 'tel-picker-name'; name.textContent = v.nombre || '';
          b.appendChild(code); b.appendChild(name);
          b.addEventListener('click', function () { resolveWith(v.codigo); });
          list.appendChild(b);
        });
        box.appendChild(list);

        var acts = document.createElement('div'); acts.className = 'modal-actions';
        var btnCancel = document.createElement('button'); btnCancel.type = 'button';
        btnCancel.className = 'modal-btn neutral'; btnCancel.textContent = 'Cancelar';
        btnCancel.addEventListener('click', function () { resolveWith(null); });
        acts.appendChild(btnCancel);
        box.appendChild(acts);
      }
    }).then(function (codigo) {
      if (!codigo) return;
      var variante = categoria.variantes.find(function (v) { return v.codigo === codigo; });
      if (!variante) return;
      var t = getTurno(editId);
      var s = t && t.servicios[si];
      if (!s) return;
      var nombreCompleto = ((settings.nombre || '') + ' ' + (settings.apellidos || '')).trim();
      var now = new Date();
      var horaActual = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
      var tel = blankTelefonema(categoria, variante, s, nombreCompleto, horaActual);
      s.telefonemas.push(tel);
      var ti = s.telefonemas.length - 1;
      autosave();
      refreshServicioCard(si);
      abrirTelefonemaVentana(si, ti, true);
    });
  }

  // Crece en altura con el contenido (Información Complementaria) — nunca
  // oculta texto largo.
  function autosizeTextareaH(ta) {
    function resize() { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
    ta.addEventListener('input', resize);
    setTimeout(resize, 0);
  }
  // Ensancha un input en línea con lo que se escribe — como si fuera texto
  // normal, no un campo de formulario con ancho fijo.
  function autosizeCh(el, minCh) {
    function resize() { el.style.width = Math.max(minCh || 4, el.value.length + 1) + 'ch'; }
    el.addEventListener('input', resize);
    resize();
  }
  // Interpreta *palabra* como negrita y añade el resultado a un contenedor
  // — usado en los textos de Guía y uso / Advertencias de los telefonemas.
  function appendConNegritas(container, texto) {
    String(texto || '').split(/\*(.+?)\*/).forEach(function (parte, i) {
      if (!parte) return;
      if (i % 2 === 1) {
        var b = document.createElement('b'); b.textContent = parte;
        container.appendChild(b);
      } else {
        container.appendChild(document.createTextNode(parte));
      }
    });
  }

  // Réplica exacta del formulario "ANEXO I - Formato de uso de telefonemas"
  // (página 37 del Libro de Telefonemas, LNM-ILSA_AP2): misma disposición de
  // celdas y mismos textos literales. La única libertad es que "TEXTO
  // TELEFONEMA:" se rellena con la frase de la variante con sus huecos en
  // línea, en vez de dejarse en blanco para escritura manual. Edita
  // s.telefonemas[ti] en el sitio — reabrible tantas veces como haga falta.
  function abrirTelefonemaVentana(si, ti, esNuevo) {
    var t0 = getTurno(editId);
    var s0 = t0 && t0.servicios[si];
    var tel = s0 && s0.telefonemas[ti];
    if (!tel) return;
    var found = buscarVarianteTelefonema(tel.cat, tel.codigo);
    if (!found) return;
    var categoria = found.categoria, variante = found.variante;
    var fechaNice = tel.fecha ? ymdNice(tel.fecha) : '';
    var dirty = false;
    var guardado = false;

    appModal.custom({
      // backdropClose queda en false a propósito: el cierre por clic fuera lo
      // gestiona onOverlayClick() más abajo, para poder preguntar antes si
      // hay cambios sin guardar (app-modal.js no soporta un guard aquí).
      className: 'wide',
      backdropClose: false,
      dismissValue: null,
      render: function (box, resolveWith) {
        box.innerHTML = '';
        box.style.position = 'relative';

        var ttl = document.createElement('div'); ttl.className = 'modal-title';
        ttl.style.textAlign = 'center';
        ttl.textContent = variante.codigo + (variante.nombre ? ' - ' + variante.nombre : '');
        box.appendChild(ttl);

        // Enlace con otros telefonemas (ej. RET1/RET2/RET3, IVC1/IVC3/IVC4)
        // — va antes que la Guía, es lo primero que necesita saber el
        // maquinista: que este telefonema no es autónomo.
        if (variante.enlace) {
          var enlace = document.createElement('div'); enlace.className = 'tel-enlace';
          var enlaceB = document.createElement('b'); enlaceB.textContent = '🔗 Enlazado: ';
          enlace.appendChild(enlaceB);
          enlace.appendChild(document.createTextNode(variante.enlace));
          box.appendChild(enlace);
        }

        if (variante.guia) {
          var guia = document.createElement('div'); guia.className = 'tel-guia';
          var guiaB = document.createElement('b'); guiaB.textContent = 'Guía y uso: ';
          guia.appendChild(guiaB);
          appendConNegritas(guia, variante.guia);
          box.appendChild(guia);
        }

        var anexo = document.createElement('div'); anexo.className = 'tel-anexo';
        box.appendChild(anexo);

        var body = document.createElement('div'); body.className = 'tel-anexo-body';

        // ---- fila-celda helpers ----
        // cell(): "ETIQUETA:" fija + input/valor. flex define el reparto
        // horizontal cuando va emparejada con otra celda en la misma fila.
        function cell(labelTxt, opts) {
          opts = opts || {};
          var c = document.createElement('div'); c.className = 'tel-anexo-cell';
          if (opts.flex) c.style.flex = opts.flex;
          var b = document.createElement('b'); b.textContent = labelTxt;
          c.appendChild(b);
          var el;
          if (opts.display) {
            el = document.createElement('span'); el.className = 'tel-anexo-fixed';
            el.textContent = opts.value || '';
          } else {
            el = document.createElement('input'); el.type = 'text';
            if (opts.value) el.value = opts.value;
            if (opts.placeholder) el.placeholder = opts.placeholder;
            if (opts.numeric) {
              el.inputMode = 'numeric'; el.pattern = '[0-9]*';
              el.addEventListener('input', function () {
                var digits = el.value.replace(/[^0-9]/g, '');
                if (digits !== el.value) el.value = digits;
              });
            }
            el.addEventListener('input', function () { dirty = true; });
          }
          c.appendChild(el);
          return { el: c, input: el };
        }
        function row(cells) {
          var r = document.createElement('div'); r.className = 'tel-anexo-row';
          cells.forEach(function (c) { r.appendChild(c.el); });
          body.appendChild(r);
          return r;
        }
        function fullRow(headerTxt, colorClass) {
          var r = document.createElement('div'); r.className = 'tel-anexo-row tel-anexo-full' + (colorClass ? ' ' + colorClass : '');
          var h = document.createElement('div'); h.className = 'tel-anexo-header'; h.textContent = headerTxt;
          r.appendChild(h);
          body.appendChild(r);
          var content = document.createElement('div'); content.className = 'tel-anexo-content';
          var r2 = document.createElement('div'); r2.className = 'tel-anexo-row tel-anexo-full' + (colorClass ? ' ' + colorClass : '');
          r2.appendChild(content);
          body.appendChild(r2);
          content.headerEl = h;
          return content;
        }

        // Fila 1: CODIGO TELEFONEMA: / FECHA:  (valores fijos, no editables)
        var cCodigo = cell('CODIGO TELEFONEMA:', { display: true, value: variante.codigo, flex: '0 0 58%' });
        var cFecha = cell('FECHA:', { display: true, value: fechaNice, flex: '1' });
        row([cCodigo, cFecha]);

        // Fila 2: Nº TELEFONEMA: / HORA:
        var cNumTel = cell('Nº TELEFONEMA:', { value: tel.numTel, flex: '0 0 58%', numeric: true });
        var cHora = cell('HORA:', { value: tel.hora, flex: '1' });
        row([cNumTel, cHora]);

        // Fila 3: De: (emisor) / a: (receptor)
        var deWrap = document.createElement('div'); deWrap.className = 'tel-anexo-cell tel-anexo-deacell';
        deWrap.style.flex = '0 0 58%';
        var deLine = document.createElement('div'); deLine.className = 'tel-anexo-deline';
        var deB = document.createElement('b'); deB.textContent = 'De:';
        var deInp = document.createElement('input'); deInp.type = 'text'; deInp.value = tel.de || '';
        deInp.addEventListener('input', function () { dirty = true; });
        deLine.appendChild(deB); deLine.appendChild(deInp);
        var deCap = document.createElement('div'); deCap.className = 'tel-anexo-cap'; deCap.textContent = '(emisor)';
        deWrap.appendChild(deLine); deWrap.appendChild(deCap);

        var aWrap = document.createElement('div'); aWrap.className = 'tel-anexo-cell tel-anexo-deacell';
        aWrap.style.flex = '1';
        var aLine = document.createElement('div'); aLine.className = 'tel-anexo-deline';
        var aB = document.createElement('b'); aB.textContent = 'a:';
        var aInp = document.createElement('input'); aInp.type = 'text'; aInp.value = tel.a || '';
        aInp.addEventListener('input', function () { dirty = true; });
        aLine.appendChild(aB); aLine.appendChild(aInp);
        var aCap = document.createElement('div'); aCap.className = 'tel-anexo-cap'; aCap.textContent = '(receptor)';
        aWrap.appendChild(aLine); aWrap.appendChild(aCap);
        row([{ el: deWrap }, { el: aWrap }]);

        // TEXTO TELEFONEMA: — la frase con sus huecos en línea, como texto
        // normal que se ensancha con lo que se escribe (no un campo de
        // formulario aparte). Única sección con la franja de color RC/Mtro.
        var textoContent = fullRow('TEXTO TELEFONEMA:', 'tel-color-' + tel.color);
        var sentence = document.createElement('div'); sentence.className = 'tel-sentence';
        var campoInputs = {};
        variante.partes.forEach(function (p) {
          if (p.t === 'text') {
            sentence.appendChild(document.createTextNode(p.v));
          } else if (p.t === 'campo') {
            var inp = document.createElement('input'); inp.type = 'text';
            inp.placeholder = p.hint || p.label;
            inp.value = tel.campos[p.id] || '';
            // Ancho mínimo = la pista completa, para que se vea entera en
            // vez de recortada mientras el campo está vacío.
            autosizeCh(inp, (p.hint || p.label || '').length || 6);
            inp.addEventListener('input', function () { dirty = true; });
            campoInputs[p.id] = inp;
            sentence.appendChild(inp);
          } else if (p.t === 'opcional') {
            var olbl = document.createElement('label'); olbl.className = 'tel-opt';
            var ocb = document.createElement('input'); ocb.type = 'checkbox';
            ocb.checked = !!tel.opcionales[p.id];
            ocb.addEventListener('change', function () { dirty = true; });
            olbl.appendChild(ocb);
            olbl.appendChild(document.createTextNode(p.label));
            campoInputs[p.id] = ocb;
            sentence.appendChild(olbl);
          }
        });
        textoContent.appendChild(sentence);

        // Vía doble banalizada — solo en variantes que lo requieren (ETC1).
        // En el encabezado "TEXTO TELEFONEMA:", a la derecha, discreto. El
        // texto elegido se añade/quita del campo "Condiciones de
        // circulación" como un sufijo controlado (lastSuffix), para no
        // pisar lo que el maquinista haya escrito a mano ahí.
        if (variante.viaBanalizada && campoInputs.cond) {
          var viaBox = document.createElement('div'); viaBox.className = 'tel-via-ban';
          var viaCb = document.createElement('input'); viaCb.type = 'checkbox';
          viaCb.checked = !!tel.viaBanalizada;
          var viaLbl = document.createElement('label');
          viaLbl.appendChild(viaCb);
          viaLbl.appendChild(document.createTextNode(' Vía doble banalizada'));
          var viaSel = document.createElement('select');
          ['I', 'II'].forEach(function (v) {
            var o = document.createElement('option'); o.value = v; o.textContent = 'Vía ' + v;
            viaSel.appendChild(o);
          });
          viaSel.value = tel.via || 'I';
          viaSel.disabled = !viaCb.checked;
          viaBox.appendChild(viaLbl); viaBox.appendChild(viaSel);
          textoContent.headerEl.appendChild(viaBox);

          var lastSuffix = '';
          function sufijoVia(via) { return ', circulando por vía ' + via; }
          function aplicarVia() {
            var condInp = campoInputs.cond;
            var val = condInp.value;
            if (lastSuffix && val.slice(val.length - lastSuffix.length) === lastSuffix) {
              val = val.slice(0, val.length - lastSuffix.length);
            }
            lastSuffix = viaCb.checked ? sufijoVia(viaSel.value) : '';
            condInp.value = val + lastSuffix;
            condInp.dispatchEvent(new Event('input'));
          }
          if (viaCb.checked) { lastSuffix = sufijoVia(viaSel.value); }
          viaCb.addEventListener('change', function () {
            dirty = true; viaSel.disabled = !viaCb.checked; aplicarVia();
          });
          viaSel.addEventListener('change', function () { dirty = true; aplicarVia(); });
        }

        // Información Complementaria:
        var infoContent = fullRow('Información Complementaria:');
        var fInfo = document.createElement('textarea'); fInfo.rows = 1; fInfo.value = tel.info || '';
        autosizeTextareaH(fInfo);
        fInfo.addEventListener('input', function () { dirty = true; });
        infoContent.appendChild(fInfo);

        // EMISOR: / Cumplimentado:
        var cEmisor = cell('EMISOR:', { value: tel.emisor, flex: '0 0 78%' });
        var checkCump = document.createElement('div'); checkCump.className = 'tel-anexo-cell tel-anexo-check';
        checkCump.style.flex = '1';
        var bCump = document.createElement('b'); bCump.textContent = 'Cumplimentado:';
        var cbCump = document.createElement('input'); cbCump.type = 'checkbox'; cbCump.checked = !!tel.cumplimentado;
        checkCump.appendChild(bCump); checkCump.appendChild(cbCump);
        row([cEmisor, { el: checkCump }]);

        // FIRMA: / Transferido:
        var cFirma = cell('FIRMA:', { value: tel.firma, flex: '0 0 78%' });
        var checkTrans = document.createElement('div'); checkTrans.className = 'tel-anexo-cell tel-anexo-check';
        checkTrans.style.flex = '1';
        var bTrans = document.createElement('b'); bTrans.textContent = 'Transferido:';
        var cbTrans = document.createElement('input'); cbTrans.type = 'checkbox'; cbTrans.checked = !!tel.transferido;
        checkTrans.appendChild(bTrans); checkTrans.appendChild(cbTrans);
        row([cFirma, { el: checkTrans }]);

        // Cumplimentado y Transferido son excluyentes: solo puede ser uno u
        // otro, nunca los dos a la vez. Si el telefonema es de antes de esta
        // regla y quedó guardado con los dos a true, se normaliza al abrir
        // (gana Cumplimentado, por ser el estado más "definitivo").
        if (cbCump.checked && cbTrans.checked) cbTrans.checked = false;
        cbCump.addEventListener('change', function () {
          dirty = true;
          if (cbCump.checked) { cbTrans.checked = false; actualizarRelevo(); }
        });
        cbTrans.addEventListener('change', function () {
          dirty = true;
          if (cbTrans.checked) cbCump.checked = false;
          actualizarRelevo();
        });

        // "Resguardo en caso de relevo" — solo si se marca Transferido.
        // Caja aparte (no filas de la tabla), con el mismo estilo que tenía
        // antes: recuadro redondeado debajo del telefonema.
        var relevo = document.createElement('div'); relevo.className = 'tel-anexo-relevo';
        var relevoTitle = document.createElement('span'); relevoTitle.className = 'tel-anexo-relevo-title';
        relevoTitle.textContent = 'Resguardo en caso de relevo:';
        relevo.appendChild(relevoTitle);
        var relevoFields = document.createElement('div'); relevoFields.className = 'tel-anexo-relevo-fields';
        relevo.appendChild(relevoFields);

        function relevoField(labelTxt, value) {
          var lbl = document.createElement('label');
          var span = document.createElement('span'); span.textContent = labelTxt;
          var inp = document.createElement('input'); inp.type = 'text'; inp.value = value || '';
          inp.addEventListener('input', function () { dirty = true; });
          lbl.appendChild(span); lbl.appendChild(inp);
          relevoFields.appendChild(lbl);
          return { input: inp };
        }
        var cNumTelevo = relevoField('Nº Telefonema:', tel.numTel);
        var cTrenRelevo = relevoField('Tren:', tel.campos.tren);
        var cFechaRelevo = relevoField('Fecha:', fechaNice);
        var cMatricula = relevoField('Transferido a (nº matrícula):', tel.matricula);
        var cFirmaEntrante = relevoField('Firma de maquinista entrante:', tel.firmaEntrante);

        anexo.appendChild(body);
        box.appendChild(relevo);

        function actualizarRelevo() {
          relevo.classList.toggle('open', cbTrans.checked);
          if (cbTrans.checked) {
            if (!cNumTelevo.input.value) cNumTelevo.input.value = cNumTel.input.value;
            if (!cTrenRelevo.input.value) cTrenRelevo.input.value = (campoInputs.tren && campoInputs.tren.value) || '';
            if (!cFechaRelevo.input.value) cFechaRelevo.input.value = fechaNice;
          }
        }
        actualizarRelevo();

        // Clic fuera de la ventana: si no hay nada escrito, cierra directo.
        // Si hay cambios sin guardar, NO cierra sola — solo sacude la
        // ventana para indicar que hay que usar la "X" (que sí tiene su
        // confirmación de dos pasos). window.confirm() no es fiable en este
        // entorno (se queda colgado sin mostrar nada) y appModal solo
        // soporta un modal a la vez, así que no se puede anidar otro aquí —
        // de ahí el patrón "pulsa otra vez para confirmar" en vez de un
        // diálogo. El listener se retira al cerrar — si no, se acumularía
        // uno nuevo cada vez que se reabre este mismo telefonema.
        var overlayEl = box.parentNode;
        function onOverlayClick(e) {
          if (e.target !== overlayEl) return;
          if (!dirty) { descartarSiVacio(); cleanup(); resolveWith(null); return; }
          box.classList.remove('tel-shake'); void box.offsetWidth; box.classList.add('tel-shake');
        }
        overlayEl.addEventListener('click', onOverlayClick);
        function cleanup() { overlayEl.removeEventListener('click', onOverlayClick); }

        // Si el telefonema se acaba de crear (recién elegida la variante) y
        // se cierra sin pulsar Guardar, no debe quedar el botón vacío en el
        // Registro — se borra el registro en blanco igual que si nunca se
        // hubiera abierto.
        function descartarSiVacio() {
          if (!esNuevo || guardado) return;
          var t = getTurno(editId);
          var s = t && t.servicios[si];
          if (s) s.telefonemas.splice(ti, 1);
          autosave();
          refreshServicioCard(si);
        }

        function guardar() {
          variante.partes.forEach(function (p) {
            if (p.t === 'campo') tel.campos[p.id] = (campoInputs[p.id].value || '').trim();
            else if (p.t === 'opcional') tel.opcionales[p.id] = campoInputs[p.id].checked;
          });
          tel.numTel = cNumTel.input.value.trim(); tel.hora = cHora.input.value.trim();
          tel.de = deInp.value.trim(); tel.a = aInp.value.trim();
          tel.info = fInfo.value.trim();
          tel.emisor = cEmisor.input.value.trim(); tel.firma = cFirma.input.value.trim();
          tel.cumplimentado = cbCump.checked; tel.transferido = cbTrans.checked;
          tel.matricula = cMatricula.input.value.trim(); tel.firmaEntrante = cFirmaEntrante.input.value.trim();
          if (variante.viaBanalizada && campoInputs.cond) { tel.viaBanalizada = viaCb.checked; tel.via = viaSel.value; }

          // Observaciones: una línea con el acrónimo, hora, el texto del
          // telefonema y si se ha transferido — se actualiza en el sitio
          // en vez de acumular una línea nueva cada vez que se guarda.
          if (s0) {
            var linea = composeObsLineTelefonema(tel, variante);
            var lines = s0.observaciones ? s0.observaciones.split('\n') : [];
            if (tel.obsLineIdx != null && lines[tel.obsLineIdx] !== undefined &&
                lines[tel.obsLineIdx].indexOf(tel.codigo + ' · ') === 0) {
              lines[tel.obsLineIdx] = linea;
            } else {
              lines.push(linea);
              tel.obsLineIdx = lines.length - 1;
            }
            s0.observaciones = lines.join('\n');
            var ta = document.querySelector('[data-bind="srv.' + si + '.observaciones"]');
            if (ta) ta.value = s0.observaciones;
          }

          guardado = true;
          autosave();
          refreshServicioCard(si);
          cleanup();
          resolveWith(true);
        }

        // Confirmación de dos pasos (pulsa otra vez) en vez de un diálogo
        // nativo/anidado — mismo motivo que arriba.
        function confirmToggle(armFn, disarmFn) {
          var armed = false, timer = null;
          return function () {
            if (armed) { armed = false; clearTimeout(timer); disarmFn(); return true; }
            armed = true;
            armFn();
            timer = setTimeout(function () { armed = false; disarmFn(); }, 3000);
            return false;
          };
        }

        var btnX = document.createElement('button'); btnX.type = 'button';
        btnX.className = 'tel-modal-close'; btnX.textContent = '✕';
        btnX.setAttribute('aria-label', 'Cerrar');
        var confirmCerrar = confirmToggle(
          function () { btnX.classList.add('confirm'); btnX.title = 'Pulsa otra vez para salir sin guardar'; },
          function () { btnX.classList.remove('confirm'); btnX.title = 'Cerrar'; }
        );
        btnX.addEventListener('click', function () {
          if (dirty && !confirmCerrar()) return;
          descartarSiVacio();
          cleanup();
          resolveWith(null);
        });
        box.appendChild(btnX);

        var btnDel = document.createElement('button'); btnDel.type = 'button';
        btnDel.className = 'modal-btn danger'; btnDel.textContent = 'Borrar';
        var confirmBorrar = confirmToggle(
          function () { btnDel.textContent = 'Pulsa otra vez para borrar'; },
          function () { btnDel.textContent = 'Borrar'; }
        );
        btnDel.addEventListener('click', function () {
          if (!confirmBorrar()) return;
          var t = getTurno(editId);
          var s = t && t.servicios[si];
          if (s) s.telefonemas.splice(ti, 1);
          autosave();
          refreshServicioCard(si);
          cleanup();
          resolveWith(null);
        });

        var btnOk = document.createElement('button'); btnOk.type = 'button';
        btnOk.className = 'modal-btn primary'; btnOk.textContent = 'Guardar';
        btnOk.addEventListener('click', guardar);

        // Advertencias — recuadro amarillo justo debajo del telefonema
        // (y del resguardo de relevo si está visible), encima de los botones.
        if (variante.advertencias && variante.advertencias.length) {
          var adv = document.createElement('div'); adv.className = 'tel-advertencias';
          var advB = document.createElement('b'); advB.textContent = 'Advertencias:';
          adv.appendChild(advB);
          var advList = document.createElement('ul');
          variante.advertencias.forEach(function (a) {
            var li = document.createElement('li');
            appendConNegritas(li, a);
            advList.appendChild(li);
          });
          adv.appendChild(advList);
          box.appendChild(adv);
        }

        var acts = document.createElement('div'); acts.className = 'modal-actions tel-anexo-actions';
        acts.appendChild(btnDel); acts.appendChild(btnOk);
        box.appendChild(acts);
      }
    });
  }

  // Autocompletado del tramo elegido en el Libro de Horarios.
  function autofillServicio(si, horarioIdx) {
    var t = getTurno(editId);
    if (!t) return;
    var s = t.servicios[si];
    var hr = horarios[horarioIdx];
    if (!hr) return;
    s.servicioComercial = hr.servicio;
    s.origen = hr.origen || '';
    s.destino = hr.destino || '';
    s.hSalida = hr.hSalida || '';
    s.hDestino = hr.hDestino || '';
    s.esTraslado = false; s.maniobraNombre = '';
    s.paradas = (hr.paradas || []).map(function (p) {
      var tP = typeof p.tParada === 'number' ? p.tParada : 0;
      return {
        nombre: p.nombre,
        hLleg: tP > 0 ? subMinutos(p.hora, tP) : (p.hLleg || ''),
        hora: p.hora,
        tParada: tP,
        rLleg: '', rSal: '',
        viajeros: '', asistencias: ''
      };
    });
    autosave();
    refreshServicioCard(si);
    // Solo sincronizar con Horario si el servicio editado es de HOY. Editar
    // registros de otra fecha no debe marcar una marcha activa en HT.
    if (s.fecha === today()) {
      window.dispatchEvent(new CustomEvent('iryo:registroServiceChanged',
        { detail: { num: hr.servicio } }));
    }
  }

  // Traslado sin horario oficial (RV_MANIOBRAS): autocompleta estaciones
  // pero deja las horas en blanco — se rellenan a mano (botón ⏱ = hora
  // actual) y el nº de servicio en la casilla que aparece encima del
  // desplegable.
  function autofillManiobra(si, manIdx) {
    var t = getTurno(editId);
    if (!t) return;
    var s = t.servicios[si];
    var m = maniobras[manIdx];
    if (!m) return;
    s.servicioComercial = '';
    s.esTraslado = true;
    s.maniobraNombre = m.nombre;
    s.origen = m.origen || '';
    s.destino = m.destino || '';
    s.hSalida = ''; s.hDestino = '';
    s.paradas = (m.paradas || []).map(function (p) {
      return {
        nombre: p.nombre, hLleg: '', hora: '', tParada: 0,
        rLleg: '', rSal: '', viajeros: '', asistencias: ''
      };
    });
    autosave();
    refreshServicioCard(si);
  }

  // ===== Estadísticas =====
  function renderStats() {
    var pane = $('estadisticas-pane');
    if (!statsRange) {
      var n = new Date();
      statsRange = {
        desde: ymd(new Date(n.getFullYear(), n.getMonth(), 1)),
        hasta: today()
      };
    }
    var inRange = function (d) {
      return d && d >= statsRange.desde && d <= statsRange.hasta;
    };
    var nTurnos = 0, nServicios = 0, totalMin = 0, totalRetrasoMin = 0;
    var serviciosRango = []; // todos los servicios del rango, para el listado desplegable
    var porDia = [0, 0, 0, 0, 0, 0, 0]; // servicios por día de la semana, Lunes..Domingo
    var nDormidas = 0;
    var porManiobra = {}; // maniobraNombre -> nº de traslados
    var mayorRetraso = null; // { fecha, num, destino, min }
    var addRet = function (v) {
      var n = parseRetraso(v);
      if (n != null && n > 0) totalRetrasoMin += n;
    };
    turnos.forEach(function (t) {
      var hit = t.servicios.some(function (s) { return inRange(s.fecha); });
      if (!hit) return;
      nTurnos++;
      if (isDormida(t)) nDormidas++;
      t.servicios.forEach(function (s) {
        if (!inRange(s.fecha)) return;
        nServicios++;
        serviciosRango.push(s);
        var d = durMin(s.hSalida, s.hDestino);
        if (d != null) totalMin += d;
        addRet(s.rSalida);
        addRet(s.rLlegDestino);
        (s.paradas || []).forEach(function (p) {
          addRet(p.rLleg);
          addRet(p.rSal);
        });
        var di = diaSemanaIdx(s.fecha);
        if (di != null) porDia[di]++;
        if (s.esTraslado && s.maniobraNombre) {
          porManiobra[s.maniobraNombre] = (porManiobra[s.maniobraNombre] || 0) + 1;
        }
        var mLleg = parseRetraso(s.rLlegDestino);
        if (mLleg != null && mLleg > 0 && (!mayorRetraso || mLleg > mayorRetraso.min)) {
          mayorRetraso = { fecha: s.fecha, num: s.servicioComercial || s.maniobraNombre || '—',
            destino: s.destino || '—', min: mLleg };
        }
      });
    });

    var h = '<h2>Estadísticas</h2>';
    h += '<div class="card"><div class="field-grid">' +
      '<div class="field"><label>Desde</label>' +
      '<input type="date" id="st-desde" value="' + statsRange.desde + '"></div>' +
      '<div class="field"><label>Hasta</label>' +
      '<input type="date" id="st-hasta" value="' + statsRange.hasta + '"></div>' +
      '</div></div>';
    h += '<div class="stat-grid">' +
      '<div class="stat-box" data-action="stats-open" data-modo="turnos"><div class="num">' + nTurnos + '</div>' +
      '<div class="lbl">Turnos</div></div>' +
      '<div class="stat-box"><div class="num">' + nServicios + '</div>' +
      '<div class="lbl">Servicios</div></div>' +
      '<div class="stat-box"><div class="num">' + fmtDur(totalMin) + '</div>' +
      '<div class="lbl">Horas de servicio</div></div>' +
      '<div class="stat-box" data-action="stats-open" data-modo="retrasos"><div class="num">' + fmtDur(totalRetrasoMin) + '</div>' +
      '<div class="lbl">Retraso acumulado</div></div>' +
      '</div>';

    h += '<div class="card">';
    h += '<button type="button" class="section-toggle" data-action="stats-otras-toggle">Otras estadísticas' +
      '<span class="chev">' + (statsOtrasAbierta ? '▴' : '▾') + '</span></button>';
    if (statsOtrasAbierta) {
      h += '<div class="stat-sub"><b>Servicios por día de la semana</b><div class="stat-list">';
      DIAS_SEMANA.forEach(function (nombre, i) {
        h += '<div class="stat-row"><span>' + nombre + '</span><span>' + porDia[i] + '</span></div>';
      });
      h += '</div></div>';

      h += '<div class="stat-sub"><b>Dormidas</b>' +
        '<div class="hint">' + nDormidas + ' de ' + nTurnos + ' turnos en este rango.</div></div>';

      h += '<div class="stat-sub"><b>Traslados por maniobra</b>';
      var maniobras = Object.keys(porManiobra).sort(function (a, b) { return porManiobra[b] - porManiobra[a]; });
      if (!maniobras.length) {
        h += '<div class="hint">Sin traslados en este rango.</div>';
      } else {
        h += '<div class="stat-list">';
        maniobras.forEach(function (nombre) {
          h += '<div class="stat-row"><span>' + esc(nombre) + '</span><span>' + porManiobra[nombre] + '</span></div>';
        });
        h += '</div>';
      }
      h += '</div>';

      h += '<div class="stat-sub"><b>Mayor retraso del periodo</b>';
      if (!mayorRetraso) {
        h += '<div class="hint">Sin retrasos en este rango.</div>';
      } else {
        h += '<div class="stat-row"><span>' + esc(ymdNice(mayorRetraso.fecha)) + ' · <b>' +
          esc(mayorRetraso.num) + '</b> · ' + esc(prettyEstacion(mayorRetraso.destino)) +
          '</span><span class="ret">+' + mayorRetraso.min + 'm</span></div>';
      }
      h += '</div>';
    }
    h += '</div>'; // fin card Otras estadísticas

    if (statsListMode) {
      var lista = statsListMode === 'retrasos'
        ? serviciosRango.filter(function (s) { var m = parseRetraso(s.rLlegDestino); return m != null && m >= 5; })
        : serviciosRango.slice();
      if (statsListLinea) {
        lista = lista.filter(function (s) { return lineaDeServicio(s) === statsListLinea; });
      }
      lista.sort(function (a, b) {
        return statsListOrden === 'asc' ? (a.fecha || '').localeCompare(b.fecha || '') :
          (b.fecha || '').localeCompare(a.fecha || '');
      });
      h += '<div class="card">' +
        '<div class="card-title" style="display:flex;align-items:center;gap:8px">' +
        '<span style="flex:1">' + (statsListMode === 'retrasos' ? 'Servicios con retraso a destino' : 'Todos los servicios') + '</span>' +
        '<button type="button" class="btn ghost" data-action="stats-list-orden" title="' +
        (statsListOrden === 'desc' ? 'Más reciente primero' : 'Más antiguo primero') +
        '" style="padding:4px 9px;min-height:28px;line-height:0">' + sortIconSvg(statsListOrden === 'desc') + '</button>' +
        '<button class="btn ghost" data-action="stats-list-close" style="padding:4px 10px;min-height:28px">✕</button>' +
        '</div>';
      if (statsListMode === 'retrasos') {
        h += '<div class="hint" style="margin:-4px 0 8px">Solo se listan los servicios con 5 min o más de retraso a destino.</div>';
      }
      h += '<div class="stat-linea-row">' +
        '<label for="st-list-linea">Línea</label>' +
        '<select id="st-list-linea">' +
        '<option value="">— todas —</option>' +
        ['L10', 'L30', 'L40', 'L42', 'L50'].map(function (l) {
          return '<option value="' + l + '"' + (statsListLinea === l ? ' selected' : '') + '>' + l + '</option>';
        }).join('') +
        '</select></div>';
      if (!lista.length) {
        h += '<div class="hint">Sin servicios que cumplan el filtro en este rango.</div>';
      } else {
        h += '<div class="stat-list">';
        lista.forEach(function (s) {
          var num = s.servicioComercial || s.maniobraNombre || '—';
          var hrs = (s.hSalida && s.hDestino) ? (s.hSalida + ' → ' + s.hDestino) : '—';
          var ruta = (s.origen && s.destino) ? (prettyEstacion(s.origen) + ' → ' + prettyEstacion(s.destino)) : '—';
          var min = parseRetraso(s.rLlegDestino);
          var retHtml = (min != null && min > 0) ? '<span class="ret">+' + min + 'm</span>' : '';
          h += '<div class="stat-row"><span>' + esc(ymdNice(s.fecha)) + ' · <b>' + esc(num) + '</b> · ' +
            esc(ruta) + ' · ' + esc(hrs) + '</span>' + retHtml + '</div>';
        });
        h += '</div>';
      }
      h += '</div>';
    }

    pane.innerHTML = h;

    $('st-desde').addEventListener('change', function (e) {
      statsRange.desde = e.target.value; renderStats();
    });
    $('st-hasta').addEventListener('change', function (e) {
      statsRange.hasta = e.target.value; renderStats();
    });
    var selListLinea = $('st-list-linea');
    if (selListLinea) selListLinea.addEventListener('change', function (e) {
      statsListLinea = e.target.value; renderStats();
    });
  }

  // ===== Ajustes =====
  function renderSettings() {
    var pane = $('ajustes-pane');
    var h = '<h2>Ajustes</h2>';

    // 2. Teléfono de referencia + datos personales (informe de incidencia)
    h += '<div class="card"><div class="card-title">Teléfono de referencia y datos personales</div>' +
      '<div class="field"><label>Teléfono de referencia</label>' +
      '<input type="text" id="set-tel" value="' + esc(settings.telefono) +
      '" placeholder="Ej. 651 450 000"></div>' +
      '<div class="field-grid">' +
      '<div class="field"><label>Nombre</label>' +
      '<input type="text" id="set-nombre" value="' + esc(settings.nombre) + '"></div>' +
      '<div class="field"><label>Apellidos</label>' +
      '<input type="text" id="set-apellidos" value="' + esc(settings.apellidos) + '"></div>' +
      '</div>' +
      '<div class="field"><label>ID de empleado</label>' +
      '<input type="text" id="set-id-empleado" value="' + esc(settings.idEmpleado) + '"></div>' +
      '<div class="btn-row" style="margin:0"><button class="btn primary" data-action="save-datos-personales">Guardar datos</button></div></div>';

    // 3. Ramas
    h += '<div class="card"><div class="card-title">Ramas</div>' +
      '<div class="field"><label>Una rama por línea (desplegable del editor)</label>' +
      '<textarea id="set-ramas" style="min-height:120px">' +
      esc(settings.ramas.join('\n')) + '</textarea></div>' +
      '<div class="btn-row" style="margin:0"><button class="btn primary" data-action="save-ramas">Guardar ramas</button></div></div>';

    // 6. Exportar a PDF (multi-select)
    var sortedT = turnos.slice().sort(function (a, b) {
      var fa = (a.servicios[0] && a.servicios[0].fecha) || '';
      var fb = (b.servicios[0] && b.servicios[0].fecha) || '';
      return fb.localeCompare(fa);
    });
    h += '<div class="card"><div class="card-title">Exportar a PDF</div>';
    if (!sortedT.length) {
      h += '<div class="hint">Aún no hay turnos para exportar.</div>';
    } else {
      h += '<div class="hint" style="margin-bottom:8px">Marca los turnos que quieras exportar:</div>' +
        '<div class="pdf-list">';
      sortedT.forEach(function (t) {
        var f = (t.servicios[0] && t.servicios[0].fecha) ? ymdNice(t.servicios[0].fecha) : 'sin fecha';
        var nums = t.servicios.map(function (s) { return s.servicioComercial || '—'; }).join(' / ');
        var est = t.estado === 'cerrado' ? 'cerrado' : 'en curso';
        h += '<label class="pdf-row">' +
          '<input type="checkbox" data-pdfi="' + esc(t.id) + '">' +
          '<span class="pdf-row-text">' + esc(f) + ' · <b>' + esc(nums) + '</b> · ' + est + '</span>' +
          '</label>';
      });
      h += '</div>' +
        '<div class="btn-row" style="margin-top:10px">' +
        '<button class="btn" data-action="pdf-mark-all">Marcar todos</button>' +
        '<button class="btn ghost" data-action="pdf-mark-none">Desmarcar</button>' +
        '<button class="btn primary" data-action="pdf-export" style="margin-left:auto">Exportar seleccionados</button>' +
        '</div>';
    }
    h += '</div>';

    // 7. Copia de seguridad
    h += '<div class="card"><div class="card-title">Copia de seguridad</div>' +
      '<div class="hint">' + turnos.length + ' turnos guardados.</div>' +
      '<div class="btn-row"><button class="btn primary" data-action="export-backup">Exportar copia</button>' +
      '<button class="btn" data-action="import-backup">Importar copia</button></div>' +
      '<input type="file" id="file-backup" accept=".json,application/json" style="display:none">' +
      '</div>';

    // 7b. Carpeta de turnos (espejo automático en archivos, uno por día)
    h += '<div class="card"><div class="card-title">Carpeta de turnos (archivos)</div>';
    if (!folderSupported()) {
      h += '<div class="hint">Este navegador no soporta guardar los turnos como archivos en el dispositivo.</div>';
    } else if (settings.folderLinked && folderHandle) {
      h += '<div class="hint">Vinculada — cada turno se guarda solo, como archivo, en cuanto cambia algo.</div>' +
        '<div class="btn-row"><button class="btn" data-action="folder-reindex">Reindexar desde archivos</button>' +
        '<button class="btn ghost" data-action="folder-unlink">Desvincular</button></div>';
    } else if (settings.folderLinked) {
      h += '<div class="hint" style="color:var(--warn)">Se perdió el permiso de acceso a la carpeta vinculada.</div>' +
        '<div class="btn-row"><button class="btn primary" data-action="folder-relink">Reconceder acceso</button></div>';
    } else {
      h += '<div class="hint">Sin vincular — los turnos solo están guardados en la app.</div>' +
        '<div class="btn-row"><button class="btn primary" data-action="folder-link">Vincular carpeta</button></div>';
    }
    h += '</div>';

    // 8. Aplicación
    h += '<div class="card"><div class="card-title">Aplicación</div>' +
      '<div class="hint" data-action="app-version-tap" style="cursor:default; user-select:none">' +
      'Versión instalada: <b>' + esc(APP_VERSION) + '</b>' +
      (settings.telDevMode ? ' · <span style="color:var(--ok)">modo desarrollador activo</span>' : '') +
      '</div>' +
      '<div class="btn-row" style="margin-top:8px">' +
      '<button class="btn primary" data-action="check-update">Comprobar actualizaciones</button>' +
      '<button class="btn" data-action="export-backup">Exportar copia ahora</button>' +
      '</div>' +
      '<div class="hint" style="margin-top:6px">Si hay versión nueva en el servidor, la app se recarga sola.</div>' +
      '</div>';

    // 9. Borrar todo
    h += '<div class="card"><div class="card-title">Borrar todo</div>' +
      '<div class="btn-row" style="margin:0"><button class="btn danger" data-action="wipe">Borrar todos los datos</button></div></div>';

    h += '<div class="hint" style="text-align:center;margin-top:8px">Datos guardados solo en esta tablet</div>';
    pane.innerHTML = h;
  }

  function applyTheme() {
    document.body.classList.toggle('light', settings.theme === 'light');
  }

  // ===== Exportación PDF =====
  function pintarTurnoEnDoc(doc, t) {
    var W = 210, M = 14;
    var state = { y: 16 };
    function line(txt, opt) {
      opt = opt || {};
      doc.setFont('helvetica', opt.bold ? 'bold' : 'normal');
      doc.setFontSize(opt.size || 10);
      if (opt.color) doc.setTextColor.apply(doc, opt.color);
      else doc.setTextColor(20, 20, 20);
      var lines = doc.splitTextToSize(txt, opt.w || (W - 2 * M));
      doc.text(lines, opt.x || M, state.y);
      state.y += (opt.size || 10) * 0.45 * lines.length + (opt.gap || 1.5);
    }
    function rule() { doc.setDrawColor(200); doc.line(M, state.y, W - M, state.y); state.y += 3; }
    function checkPage() { if (state.y > 272) { doc.addPage(); state.y = 16; } }

    line('RV Iryo — Registro de Viajes', { bold: true, size: 15, color: [232, 32, 28] });
    line('Estado: ' + (t.estado === 'cerrado' ? 'Cerrado' : 'En curso'), { size: 9, color: [120, 120, 120] });
    rule();
    line('Teléfono: ' + (settings.telefono || '—'), { size: 10, gap: 3 });

    t.servicios.forEach(function (s, si) {
      checkPage();
      rule();
      line('SERVICIO ' + (si + 1) + '  ·  ' + ymdNice(s.fecha) +
        (s.horaLTV ? '  ·  LTV ' + s.horaLTV : ''),
        { bold: true, size: 12, color: [232, 32, 28] });
      line('Servicio Comercial: ' + (s.servicioComercial || '—') +
        (s.origen ? '  (' + s.origen + ' → ' + s.destino + ')' : ''), { size: 10 });
      line('Vía: ' + (s.via || '—') + '     Rama: ' + (s.rama || '—'), { size: 10 });
      line('N1: ' + (s.n1 || '—'), { size: 10 });

      // Origen
      checkPage();
      line('Origen ' + (s.origen || '—') + '   Sal: ' + (s.hSalida || '—') +
        (s.rSalida ? '  [ret. ' + s.rSalida + ' min]' : ''),
        { bold: true, size: 10, color: [21, 128, 61] });
      if (s.viajeros || s.asistencias || (s.pmr && s.pmr.length)) {
        line('  Viajeros ' + (s.viajeros || '0') +
             '  Asist ' + (s.asistencias || '0') +
             '  PMR ' + ((s.pmr && s.pmr.length) || '0'),
          { size: 8, x: M + 3, gap: 1, color: [110, 110, 110] });
      }
      if (s.pmr && s.pmr.length) {
        s.pmr.forEach(function (pm, idx) {
          line('  PMR ' + (idx + 1) + ' baja en: ' + (pm.baja || '—'),
            { size: 8, x: M + 3, gap: 1, color: [110, 110, 110] });
        });
      }

      // Paradas intermedias
      (s.paradas || []).forEach(function (p) {
        checkPage();
        var hSal = p.hora || '—';
        var hLleg = (p.tParada > 0 && p.hora) ? subMinutos(p.hora, p.tParada) : '—';
        line('Parada ' + (p.nombre || '?') +
          '   Lleg: ' + hLleg + (p.rLleg ? ' [ret. ' + p.rLleg + ' min]' : '') +
          '   Sal: ' + hSal + (p.rSal ? ' [ret. ' + p.rSal + ' min]' : ''),
          { bold: true, size: 10 });
        if (p.viajeros || p.asistencias) {
          line('  Viajeros ' + (p.viajeros || '0') +
               '  Asist ' + (p.asistencias || '0'),
            { size: 8, x: M + 3, gap: 1, color: [110, 110, 110] });
        }
      });

      // Destino
      checkPage();
      line('Destino ' + (s.destino || '—') + '   Lleg: ' + (s.hDestino || '—') +
        (s.rLlegDestino ? '  [ret. ' + s.rLlegDestino + ' min]' : ''),
        { bold: true, size: 10, color: [185, 28, 28] });

      checkPage();
      line('Comprobaciones:', { bold: true, size: 10 });
      COMPROBACIONES.forEach(function (c, ci) {
        checkPage();
        line((s.comprobaciones[ci] ? '[X] ' : '[  ] ') + c, { size: 9, x: M + 3, gap: 1 });
      });
      state.y += 1.5;
      checkPage();
      line('Observaciones durante el trayecto:', { bold: true, size: 10 });
      line(s.observaciones || '—', { size: 9, gap: 3 });
    });
  }

  function exportPDF(t) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      appModal.alert({ title: 'PDF no disponible', message: 'No se pudo cargar el generador de PDF. Revisa la conexión.' });
      return;
    }
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    pintarTurnoEnDoc(doc, t);
    doc.save('turno-' + (t.servicios[0] ? t.servicios[0].fecha : 'sin-fecha') + '.pdf');
    flashSaved();
  }

  function exportPDFAll() { exportPDFMany(turnos.map(function (t) { return t.id; })); }

  function exportPDFMany(ids) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      appModal.alert({ title: 'PDF no disponible', message: 'No se pudo cargar el generador de PDF. Revisa la conexión.' });
      return;
    }
    var selected = ids.map(getTurno).filter(Boolean);
    if (!selected.length) { appModal.alert({ title: 'Sin selección', message: 'No hay turnos para exportar.' }); return; }
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    selected.sort(function (a, b) {
      var fa = (a.servicios[0] && a.servicios[0].fecha) || '';
      var fb = (b.servicios[0] && b.servicios[0].fecha) || '';
      return fa.localeCompare(fb);
    });
    selected.forEach(function (t, i) {
      if (i > 0) doc.addPage();
      pintarTurnoEnDoc(doc, t);
    });
    var name = selected.length === 1
      ? 'turno-' + (selected[0].servicios[0] ? selected[0].servicios[0].fecha : 'sin-fecha') + '.pdf'
      : 'rviryo-' + selected.length + 'turnos-' + today() + '.pdf';
    doc.save(name);
    flashSaved();
  }

  // Carga una imagen del propio repo (icon-192.png, informe-logo.png, ...)
  // como dataURL para incrustarla en un PDF. Si falla (sin conexión y sin
  // cache), el llamante sigue sin la imagen.
  function loadImageDataUrl(path) {
    return fetch(path).then(function (r) { return r.blob(); })
      .then(function (blob) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }).catch(function () { return null; });
  }
  // Carga una fuente TTF del propio repo como base64 puro (sin prefijo
  // data:) para registrarla en jsPDF con addFileToVFS/addFont.
  function loadFontBase64(path) {
    return fetch(path).then(function (r) { return r.arrayBuffer(); })
      .then(function (buf) {
        var bytes = new Uint8Array(buf), bin = '';
        for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
      }).catch(function () { return null; });
  }

  var MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  // ===== Informe de incidencia (PDF calcado al formato oficial de la empresa) =====
  // Coordenadas en puntos (unit:'pt'), extraídas 1:1 del PDF/Word originales
  // de la empresa (INFORME_DE_SERVICIO_PERSONAL_OPERATIVO): mismas cabeceras
  // de sección, mismas columnas, mismos tamaños de caja, mismos colores.
  function generarInformeIncidenciaPDF(t, s, inc, descripcionEfectiva, idx, totalIncidencias) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      appModal.alert({ title: 'PDF no disponible', message: 'No se pudo cargar el generador de PDF. Revisa la conexión.' });
      return Promise.resolve();
    }
    return Promise.all([
      loadImageDataUrl('informe-logo.png'), loadImageDataUrl('informe-decorativo.jpg'),
      loadFontBase64('carlito-regular.ttf'), loadFontBase64('carlito-bold.ttf')
    ]).then(function (res) {
        var logo = res[0], deco = res[1], carlitoReg = res[2], carlitoBold = res[3];
        var doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
        var FUENTE = 'helvetica'; // fallback si la carga de Carlito falla
        if (carlitoReg && carlitoBold) {
          doc.addFileToVFS('Carlito-Regular.ttf', carlitoReg);
          doc.addFont('Carlito-Regular.ttf', 'Carlito', 'normal');
          doc.addFileToVFS('Carlito-Bold.ttf', carlitoBold);
          doc.addFont('Carlito-Bold.ttf', 'Carlito', 'bold');
          FUENTE = 'Carlito';
        }
        var CX0 = 62.0, CX1 = 531.6, CW = CX1 - CX0;
        var GRIS = [217, 217, 217], BORDE = [127, 127, 127], ROJO = [192, 0, 0], NEGRO = [0, 0, 0];
        var RH = 12.3, RH2 = RH * 2;
        var y = 34.0;
        var PAGE_BOTTOM = 780; // deja hueco para el pie de página fijo (línea roja + texto)
        var MARGIN_CONT = 40; // margen superior en páginas de continuación
        doc.setLineWidth(0.4); // grosor real de los bordes del documento original (medido a 0.5pt nominal ≈ se ve más grueso; 0.4 calca el trazo real)

        function pieDePagina() {
          doc.setDrawColor.apply(doc, ROJO); doc.setLineWidth(0.75);
          doc.line(55.2, 792.4, 534.2, 792.4);
          doc.setLineWidth(0.4);
          doc.setFont(FUENTE, 'normal'); doc.setFontSize(7);
          doc.setTextColor.apply(doc, NEGRO);
          doc.text('Informe de Servicio de Personal Operativo', 297.7, 803, { align: 'center' });
        }
        // Salta de página si lo que viene (altura neededH) no cabe ya en la
        // página actual — así el PDF nunca corta ni solapa contenido contra
        // el margen inferior, se reparte en tantas hojas como haga falta.
        function checkPage(neededH) {
          if (y + neededH > PAGE_BOTTOM) {
            pieDePagina();
            doc.addPage();
            y = MARGIN_CONT;
          }
        }

        function cell(x0, w, h, text, opts) {
          opts = opts || {};
          doc.setDrawColor.apply(doc, opts.border || BORDE);
          if (opts.fill) { doc.setFillColor.apply(doc, opts.fill); doc.rect(x0, y, w, h, 'FD'); }
          else { doc.rect(x0, y, w, h); }
          if (text == null) return;
          doc.setFont(FUENTE, opts.bold ? 'bold' : 'normal');
          var size = opts.size || 10;
          doc.setFontSize(size);
          doc.setTextColor.apply(doc, opts.color || NEGRO);
          var lines = opts.wrap ? doc.splitTextToSize(String(text), w - 8) : [String(text)];
          var lh = size * 1.15;
          var ty = y + (h - lines.length * lh) / 2 + size * 0.85;
          var tx = opts.align === 'center' ? x0 + w / 2 : x0 + 5;
          lines.forEach(function (ln, i) {
            doc.text(ln, tx, ty + i * lh, opts.align === 'center' ? { align: 'center' } : undefined);
          });
        }
        function sectionHeader(titulo, border, subtitulo) {
          checkPage(RH * 2); // cabecera de sección + hueco mínimo para la primera fila
          cell(CX0, CW, RH, titulo, { fill: GRIS, bold: true, size: 10, border: border || BORDE });
          if (subtitulo) {
            doc.setFont(FUENTE, 'bold'); doc.setFontSize(10);
            var wBold = doc.getTextWidth(titulo);
            doc.setFont(FUENTE, 'normal');
            doc.text(subtitulo, CX0 + 5 + wBold, y + RH / 2 + 3.5);
          }
          y += RH;
        }
        // pares: [{lw, vw, label, value}] — columnas explícitas en pt. La
        // altura pasada es la del original (RH o RH2 = 2×RH); si alguna
        // etiqueta necesita más líneas de las previstas, la fila crece en
        // múltiplos exactos de RH (nunca añade relleno de más en el caso
        // normal, nunca se solapa con la siguiente en el caso raro).
        function row(h, pares) {
          var maxLines = 1;
          pares.forEach(function (p) {
            var ll = doc.splitTextToSize(String(p.label || ''), p.lw - 8).length;
            var vl = doc.splitTextToSize(String(p.value || '—'), p.vw - 8).length;
            maxLines = Math.max(maxLines, ll, vl);
          });
          var realH = Math.max(h, maxLines * RH);
          checkPage(realH);
          var x = CX0;
          pares.forEach(function (p) {
            cell(x, p.lw, realH, p.label, { size: 10, wrap: true });
            // El valor rellenado va en negrita — más peso que la etiqueta fija,
            // para que se distinga a golpe de vista lo autorrellenado/escrito.
            cell(x + p.lw, p.vw, realH, p.value, { size: 10, wrap: true, bold: true });
            x += p.lw + p.vw;
          });
          y += realH;
        }
        // Caja de texto libre (Descripción/Medidas/Trenes). Se adapta al
        // contenido: si el texto necesita más alto que el tamaño original
        // del documento, la caja crece; si ni así cabe en lo que queda de
        // página, salta de página; y si el texto es tan largo que no cabe
        // ni en una página entera, se reparte en varias hojas (nunca se
        // corta a media línea ni se solapa con lo siguiente).
        function bigBox(h, texto, border) {
          var lineH = 12;
          doc.setFont(FUENTE, 'normal'); doc.setFontSize(10);
          var lines = doc.splitTextToSize(String(texto || ''), CW - 10);
          var needed = Math.max(h, lines.length * lineH + 10);
          var maxEnPaginaLibre = PAGE_BOTTOM - MARGIN_CONT;

          if (needed > maxEnPaginaLibre) {
            // No cabe entero ni en una página en blanco: repartir por trozos.
            var idxL = 0;
            while (idxL < lines.length) {
              checkPage(lineH + 10);
              var disponible = PAGE_BOTTOM - y;
              var maxLineasAqui = Math.max(1, Math.floor((disponible - 10) / lineH));
              var chunk = lines.slice(idxL, idxL + maxLineasAqui);
              var chunkH = chunk.length * lineH + 10;
              cell(CX0, CW, chunkH, null, { border: border || BORDE });
              doc.setFont(FUENTE, 'normal'); doc.setFontSize(10);
              doc.setTextColor.apply(doc, NEGRO);
              doc.text(chunk, CX0 + 5, y + 14);
              y += chunkH;
              idxL += chunk.length;
            }
            return;
          }

          checkPage(needed);
          cell(CX0, CW, needed, null, { border: border || BORDE });
          doc.setFont(FUENTE, 'normal'); doc.setFontSize(10);
          doc.setTextColor.apply(doc, NEGRO);
          doc.text(lines, CX0 + 5, y + 14);
          y += needed;
        }
        // Cabecera de sección + su caja de texto libre, como una sola
        // unidad: si la caja cabe entera en una página en blanco, se
        // reserva sitio para AMBAS antes de dibujar la cabecera — así el
        // título nunca se queda huérfano al final de una página con la
        // caja empezando sola en la siguiente.
        function seccionConCaja(titulo, border, subtitulo, hOriginal, texto) {
          doc.setFont(FUENTE, 'normal'); doc.setFontSize(10);
          var lines = doc.splitTextToSize(String(texto || ''), CW - 10);
          var neededBox = Math.max(hOriginal, lines.length * 12 + 10);
          var maxEnPaginaLibre = PAGE_BOTTOM - MARGIN_CONT;
          checkPage(neededBox <= maxEnPaginaLibre ? (RH + neededBox) : (RH * 2));
          sectionHeader(titulo, border, subtitulo);
          bigBox(hOriginal, texto, border);
        }

        // ===== Cabecera (logo | título | imagen decorativa) =====
        // hx y las cajas de imagen están tomadas 1:1 (en pt) del PDF oficial.
        // La columna del logo está fusionada verticalmente en el original
        // (una sola celda alta, sin línea de "Código/Fecha" cruzándola) —
        // por eso se dibuja como UNA celda de altura completa, igual que
        // title/decorativa se dibujan como DOS celdas apiladas. Todas las
        // celdas usan cell(), el mismo método (y por tanto el mismo grosor
        // y color de borde) que el resto del documento.
        var hx = [CX0, 177.0, 406.8, CX1];
        var HMAIN = 56.6, HSUB = 10.3, HFULL = HMAIN + HSUB;
        // Igual que en el original (imagen con behindDoc=1): las imágenes se
        // pintan PRIMERO y los bordes de celda se dibujan ENCIMA, así la
        // imagen decorativa (que se sale un poco de su columna, igual que en
        // el PDF oficial) nunca tapa la rejilla — queda detrás.
        if (logo) {
          try { doc.addImage(logo, 'PNG', 69.27, y + 1.4, 104.57, 64.45); } catch (e) {}
        }
        if (deco) {
          try { doc.addImage(deco, 'JPEG', 400.92, y + 2.6, 136.45, 51.2); } catch (e) {}
        }
        cell(hx[0], hx[1] - hx[0], HFULL, null);              // logo (celda fusionada)
        cell(hx[1], hx[2] - hx[1], HMAIN, null);               // título
        cell(hx[2], hx[3] - hx[2], HMAIN, null);               // imagen decorativa
        // Título centrado en su celda con la misma fórmula de centrado que
        // usa cell() para el resto del documento (no valores fijos a ojo).
        (function () {
          doc.setFont(FUENTE, 'bold'); doc.setFontSize(18);
          doc.setTextColor.apply(doc, NEGRO);
          var lineas = ['Informe de Servicio de', 'Personal Operativo'];
          var lh = 18 * 1.15;
          var ty = y + (HMAIN - lineas.length * lh) / 2 + 18 * 0.85;
          lineas.forEach(function (ln, i) {
            doc.text(ln, (hx[1] + hx[2]) / 2, ty + i * lh, { align: 'center' });
          });
        })();
        y += HMAIN;
        cell(hx[1], hx[2] - hx[1], HSUB, 'Código: ', { size: 8, align: 'center' });
        cell(hx[2], hx[3] - hx[2], HSUB, 'Fecha: 24/05/2024', { size: 8, align: 'center' });
        y += HSUB + 19.8;

        // A partir de aquí (todas las tablas salvo la cabecera) el borde
        // real del original pesa más que el de la cabecera.
        doc.setLineWidth(0.7);

        // ===== PERSONAL QUE INFORMA =====
        sectionHeader('PERSONAL QUE INFORMA');
        var nombreCompleto = ((settings.nombre || '') + ' ' + (settings.apellidos || '')).trim();
        row(RH, [
          { lw: 101.0, vw: 275.8, label: 'Nombre y apellidos:', value: nombreCompleto },
          { lw: 22.1, vw: 70.6, label: 'ID:', value: settings.idEmpleado }
        ]);
        row(RH, [{ lw: 101.0, vw: CW - 101.0, label: 'Puesto:', value: 'Maquinista' }]);
        y += 13.0;

        // ===== INFORMACIÓN SOBRE EL SERVICIO =====
        sectionHeader('INFORMACIÓN SOBRE EL SERVICIO');
        var SC = { lw: 93.8, vw: 141.8 };
        row(RH, [
          { lw: SC.lw, vw: SC.vw, label: 'Fecha:', value: ymdNice(s.fecha) },
          { lw: 92.2, vw: 141.1, label: 'Hora:', value: inc.hora }
        ]);
        row(RH, [
          { lw: SC.lw, vw: SC.vw, label: 'Servicio:', value: s.servicioComercial },
          { lw: 92.2, vw: 141.1, label: 'Unidad de tren:', value: s.rama }
        ]);
        row(RH, [
          { lw: SC.lw, vw: SC.vw, label: 'Línea:', value: inc.linea },
          { lw: 92.2, vw: 141.1, label: 'Cabina conducción:', value: inc.cabina }
        ]);
        row(RH, [
          { lw: SC.lw, vw: SC.vw, label: 'PK / estación:', value: inc.pk },
          { lw: 92.2, vw: 141.1, label: 'Coche:', value: inc.coche }
        ]);
        y += 12.7;

        // ===== INFORMACIÓN HORARIA =====
        sectionHeader('INFORMACIÓN HORARIA');
        var retSalMin = parseRetraso(s.rSalida);
        var retLlegMin = parseRetraso(s.rLlegDestino);
        var hSalidaReal = s.hSalida ? addMinutos(s.hSalida, retSalMin || 0) : '';
        var hLlegadaReal = s.hDestino ? addMinutos(s.hDestino, retLlegMin || 0) : '';
        row(RH2, [
          { lw: SC.lw, vw: SC.vw, label: 'Hora de salida prevista:', value: s.hSalida },
          { lw: 92.2, vw: 141.1, label: 'Hora de llegada prevista:', value: s.hDestino }
        ]);
        row(RH2, [
          { lw: SC.lw, vw: SC.vw, label: 'Hora de salida Real:', value: hSalidaReal },
          { lw: 92.2, vw: 141.1, label: 'Hora de llegada Real:', value: hLlegadaReal }
        ]);
        row(RH, [{ lw: SC.lw, vw: CW - SC.lw, label: 'Retraso:', value: retLlegMin ? fmtRetraso(retLlegMin) : '' }]);
        y += 13.1;

        // ===== Descripción (caja roja, tamaño fijo del original) =====
        seccionConCaja('DESCRIPCCIÓN DE LA INCIDENCIA', ROJO, ' (de forma detallada y precisa)', 165.2, descripcionEfectiva);
        y += 13.2;

        // ===== Medidas adoptadas =====
        seccionConCaja('MEDIDAS ADOPTADAS', null, null, 102.2, inc.medidas);
        y += 13.0;

        // ===== Trenes afectados =====
        seccionConCaja('TRENES AFECTADOS', null, null, 39.7, inc.trenes);

        // ===== Pie de firma =====
        checkPage(20);
        y += 12.1;
        doc.setFont(FUENTE, 'normal'); doc.setFontSize(10);
        doc.setTextColor.apply(doc, NEGRO);
        var hoy = today().split('-');
        var mes = MESES_ES[(+hoy[1] || 1) - 1] || '';
        doc.text('A fecha ' + (+hoy[2]) + ' de ' + mes + ' de ' + hoy[0] + '.', CX1, y, { align: 'right' });

        // ===== Pie de página (última hoja; las anteriores ya lo dibujaron
        // en checkPage() al saltar de página) =====
        pieDePagina();

        var fp = (s.fecha || '').split('-');
        var fechaTag = fp.length === 3 ? (fp[2] + '_' + fp[1] + '_' + fp[0].slice(2)) : '';
        var nombreArchivo = 'INFORME_DE_SERVICIO_PERSONAL_OPERATIVO' +
          (s.servicioComercial ? '_' + s.servicioComercial : '') +
          (fechaTag ? '_' + fechaTag : '') +
          (totalIncidencias > 1 ? '_INC' + (idx + 1) : '') + '.pdf';
        doc.save(nombreArchivo);
      }).catch(function (err) {
        appModal.alert({ title: 'Error al generar el PDF', message: String((err && err.message) || err) });
      });
  }

  // ===== Respaldo =====
  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function exportBackup() {
    var data = { app: 'rviryo', version: 1, fecha: new Date().toISOString(),
      turnos: turnos, settings: settings };
    var jsonBlob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    downloadBlob(jsonBlob, 'rviryo-copia-' + today() + '.json');

    var html = buildBackupHtml(turnos, settings);
    var htmlBlob = new Blob([html], { type: 'text/html' });
    downloadBlob(htmlBlob, 'rviryo-resumen-' + today() + '.html');

    settings.lastBackup = today();
    saveSettings();
    flashSaved();
  }
  function buildBackupHtml(turnos, settings) {
    var sorted = turnos.slice().sort(function (a, b) {
      var fa = (a.servicios[0] && a.servicios[0].fecha) || '';
      var fb = (b.servicios[0] && b.servicios[0].fecha) || '';
      return fb.localeCompare(fa);
    });
    var totalServ = 0;
    sorted.forEach(function (t) { totalServ += t.servicios.length; });

    var css = 'body{font-family:system-ui,sans-serif;background:#f6f8fa;color:#0d1117;margin:0;padding:20px;max-width:980px;margin-left:auto;margin-right:auto}' +
      'h1{color:#e8201c;margin:0 0 4px}' +
      '.sub{color:#666;font-size:13px;margin-bottom:24px}' +
      '.totals{display:flex;gap:16px;margin-bottom:24px}' +
      '.totals .tt{background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px 14px;font-size:13px}' +
      '.totals .tt b{font-size:22px;color:#e8201c;display:block;font-weight:700}' +
      '.turno{background:#fff;border:1px solid #ccc;border-radius:10px;padding:14px;margin-bottom:14px}' +
      '.turno-head{display:flex;align-items:center;gap:10px;margin-bottom:6px;font-weight:600;font-size:15px;flex-wrap:wrap}' +
      '.estado{font-size:11px;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:.3px}' +
      '.estado.cerrado{background:#dcfce7;color:#15803d}' +
      '.estado.en_curso{background:#fef3c7;color:#9a3412}' +
      '.meta{margin-left:auto;color:#666;font-size:13px;font-weight:400}' +
      '.servicio{border-top:1px solid #eee;padding-top:10px;margin-top:10px}' +
      '.servicio h3{margin:0 0 8px;font-size:15px;color:#e8201c}' +
      '.fr{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;margin-bottom:8px}' +
      '.fr span{min-width:120px}' +
      '.fr b{display:block;color:#888;font-size:10px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:1px}' +
      'table{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0}' +
      'table th,table td{padding:5px 8px;border:1px solid #ddd;text-align:left}' +
      'table th{background:#f0f3f6;font-weight:600;font-size:11px;text-transform:uppercase}' +
      '.chk{display:flex;flex-wrap:wrap;gap:6px;font-size:11px;margin:8px 0}' +
      '.chk span{padding:3px 8px;border-radius:4px}' +
      '.chk .ok{background:#dcfce7;color:#15803d}' +
      '.chk .no{background:#f0f3f6;color:#888}' +
      '.obs{font-size:13px;line-height:1.5;background:#f9fafb;padding:10px;border-radius:6px;white-space:pre-wrap;margin-top:8px;border-left:3px solid #a371f7}' +
      '@media print{body{background:#fff}.turno{break-inside:avoid}}';

    var body = '<h1>RV Iryo — Registro de viajes</h1>' +
      '<div class="sub">Generado el ' + new Date().toLocaleString('es-ES') + '</div>' +
      '<div class="totals">' +
      '<div class="tt"><b>' + sorted.length + '</b>Turnos</div>' +
      '<div class="tt"><b>' + totalServ + '</b>Servicios</div>' +
      '</div>';

    sorted.forEach(function (t) {
      var fechas = (t.servicios.map(function (s) { return s.fecha ? ymdNice(s.fecha) : ''; }).filter(Boolean)).join(' · ');
      body += '<div class="turno"><div class="turno-head">' +
        '<span>' + esc(fechas || '(sin fecha)') + '</span>' +
        '<span class="estado ' + esc(t.estado) + '">' + (t.estado === 'cerrado' ? 'Cerrado' : 'En curso') + '</span>' +
        '<span class="meta">' +
        (settings.telefono ? 'Tel ' + esc(settings.telefono) : '') + '</span>' +
        '</div>';

      t.servicios.forEach(function (s, si) {
        var pmrCount = (s.pmr && s.pmr.length) || 0;
        var pmrDestinos = (s.pmr || []).map(function (p) { return p.baja || '—'; }).join(', ');
        body += '<div class="servicio">' +
          '<h3>Servicio ' + esc(s.servicioComercial || (si + 1)) +
          (s.origen ? ' — ' + esc(s.origen) + ' → ' + esc(s.destino) : '') +
          (s.horaLTV ? ' <span style="color:#888;font-size:13px;font-weight:400">· LTV ' + esc(s.horaLTV) + '</span>' : '') +
          '</h3>' +
          '<div class="fr">' +
          '<span><b>Fecha</b>' + esc(s.fecha ? ymdNice(s.fecha) : '—') + '</span>' +
          '<span><b>Vía</b>' + esc(s.via || '—') + '</span>' +
          '<span><b>Rama</b>' + esc(s.rama || '—') + '</span>' +
          '<span><b>H. Salida</b>' + esc(s.hSalida || '—') +
          (s.rSalida ? ' <span style="color:#9a3412">(+' + esc(s.rSalida) + 'm)</span>' : '') + '</span>' +
          '<span><b>H. Destino</b>' + esc(s.hDestino || '—') +
          (s.rLlegDestino ? ' <span style="color:#9a3412">(+' + esc(s.rLlegDestino) + 'm)</span>' : '') + '</span>' +
          '<span><b>N1</b>' + esc(s.n1 || '—') + '</span>' +
          '<span><b>Viajeros</b>' + esc(s.viajeros || '0') + '</span>' +
          '<span><b>Asistencias</b>' + esc(s.asistencias || '0') + '</span>' +
          '<span><b>PMR</b>' + pmrCount +
          (pmrCount ? ' <span style="color:#666;font-size:11px">(' + esc(pmrDestinos) + ')</span>' : '') + '</span>' +
          '</div>';

        if (s.paradas && s.paradas.length) {
          body += '<table><thead><tr>' +
            '<th>Parada</th><th>H. Lleg</th><th>Ret. lleg</th><th>H. Sal</th><th>Ret. sal</th>' +
            '<th>Viajeros</th><th>Asist.</th>' +
            '</tr></thead><tbody>';
          s.paradas.forEach(function (p) {
            var hLleg = (p.tParada > 0 && p.hora) ? subMinutos(p.hora, p.tParada) : '—';
            body += '<tr>' +
              '<td>' + esc(p.nombre || '—') + '</td>' +
              '<td>' + esc(hLleg) + '</td>' +
              '<td>' + esc(p.rLleg || '—') + '</td>' +
              '<td>' + esc(p.hora || '—') + '</td>' +
              '<td>' + esc(p.rSal || '—') + '</td>' +
              '<td>' + esc(p.viajeros || '0') + '</td>' +
              '<td>' + esc(p.asistencias || '0') + '</td>' +
              '</tr>';
          });
          body += '</tbody></table>';
        }

        body += '<div class="chk">';
        COMPROBACIONES.forEach(function (lab, ci) {
          var ok = s.comprobaciones && s.comprobaciones[ci];
          body += '<span class="' + (ok ? 'ok' : 'no') + '">' +
            (ok ? '✓ ' : '☐ ') + esc(lab) + '</span>';
        });
        body += '</div>';

        if (s.observaciones) {
          body += '<div class="obs"><b>Observaciones:</b> ' + esc(s.observaciones) + '</div>';
        }
        body += '</div>';
      });

      body += '</div>';
    });

    return '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>RV Iryo — Resumen ' + today() + '</title>' +
      '<style>' + css + '</style></head>' +
      '<body>' + body + '</body></html>';
  }
  function importBackup(file) {
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result);
        if (d.app !== 'rviryo' || !Array.isArray(d.turnos)) {
          appModal.alert({ title: 'Archivo no válido', message: 'El archivo no es una copia válida de RV Iryo.' });
          return;
        }
        appModal.confirm({
          title: 'Restaurar copia',
          message: 'Esto sustituirá los ' + turnos.length + ' turnos actuales por los ' + d.turnos.length + ' de la copia. ¿Continuar?',
          buttons: [
            { label: 'Cancelar', value: false, kind: 'neutral' },
            { label: 'Restaurar', value: true, kind: 'danger' }
          ]
        }).then(function (ok) {
          if (!ok) return;
          turnos = d.turnos.map(normTurno);
          if (d.settings) {
            settings = d.settings;
            if (!settings.ramas || !settings.ramas.length) settings.ramas = DEFAULT_RAMAS.slice();
            if (!settings.theme) settings.theme = 'dark';
          }
          save(K_TURNOS, turnos);
          saveSettings();
          applyTheme();
          appModal.alert({ title: 'Copia restaurada', message: 'Copia importada: ' + turnos.length + ' turnos.' });
          renderSettings();
        });
      } catch (e) {
        appModal.alert({ title: 'Error al leer', message: 'No se pudo leer el archivo.' });
      }
    };
    rd.readAsText(file);
  }
  // ===== Eventos delegados =====
  function onInput(e) {
    var el = e.target;
    var bind = el.getAttribute && el.getAttribute('data-bind');
    if (!bind) return;
    if (bind.indexOf('inf.') === 0) { applyInformeBind(bind, el.type === 'checkbox' ? el.checked : el.value); return; }
    if (el.type === 'checkbox') applyBind(bind, el.checked);
    else applyBind(bind, el.value);
    // Cabecera "Servicio N" en vivo mientras se teclea el nº manual de un
    // traslado — sin re-render completo, para no perder el foco/cursor.
    var mNum = bind.match(/^srv\.(\d+)\.servicioComercial$/);
    if (mNum) {
      var titEl = $('svc-titulo-' + mNum[1]);
      if (titEl) titEl.textContent = el.value || String(+mNum[1] + 1);
    }
  }
  function onChange(e) {
    var el = e.target;
    if (el.classList && el.classList.contains('srv-sel')) {
      var si = +el.getAttribute('data-svc');
      var opt = el.selectedOptions && el.selectedOptions[0];
      var t = getTurno(editId);
      var s = t ? t.servicios[si] : null;
      // Aviso si hay servicio activo y aún en trayecto (evita cambios involuntarios).
      function doAutofillSrv() {
        if (opt && opt.getAttribute('data-idx') != null) {
          autofillServicio(si, +opt.getAttribute('data-idx'));
        } else if (opt && opt.getAttribute('data-man') != null) {
          autofillManiobra(si, +opt.getAttribute('data-man'));
        } else if (t && s) {
          s.servicioComercial = ''; s.origen = ''; s.destino = '';
          s.esTraslado = false; s.maniobraNombre = '';
          autosave();
          refreshServicioCard(si);
        }
      }
      if (s && s.servicioComercial && servicioEnCurso(s)) {
        var nuevoNum = '';
        if (opt && opt.getAttribute('data-idx') != null) {
          var hr = horarios[+opt.getAttribute('data-idx')];
          nuevoNum = hr ? hr.servicio : '';
        }
        if (nuevoNum !== s.servicioComercial) {
          appModal.confirm({
            title: 'Cambiar servicio activo',
            message: 'Hay un servicio activo (' + s.servicioComercial + '). ¿Reemplazar por ' + (nuevoNum || '(ninguno)') + '?',
            buttons: [
              { label: 'Cancelar', value: false, kind: 'neutral' },
              { label: 'Reemplazar', value: true, kind: 'danger' }
            ]
          }).then(function (ok) {
            if (!ok) { refreshServicioCard(si); return; }
            doAutofillSrv();
          });
          return;
        }
      }
      doAutofillSrv();
      return;
    }
    onInput(e);
  }

  function onClick(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var act = el.getAttribute('data-action');
    var t = getTurno(editId);

    if (act === 'cal-prev') {
      calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
      renderCalendar(); return;
    }
    if (act === 'cal-next') {
      calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
      renderCalendar(); return;
    }
    if (act === 'cal-toggle') {
      settings.calView = settings.calView === 'list' ? 'grid' : 'list';
      saveSettings(); renderCalendar(); return;
    }
    if (act === 'cal-day') { openDay(el.getAttribute('data-day')); return; }
    if (act === 'open-turno') { openEditor(el.getAttribute('data-id')); return; }
    if (act === 'new-turno') {
      var nt = blankTurno(el.getAttribute('data-day'));
      turnos.push(nt); save(K_TURNOS, turnos); openEditor(nt.id); return;
    }
    if (act === 'volver') { discardEmptyEdit(); renderCalendar(); setView('calendario'); return; }

    if (act === 'informe-elegir-modo') { abrirModoInforme(); return; }
    if (act === 'informe-cambiar-modo') { informeState = null; renderInforme(); return; }
    if (act === 'informe-pick-svc') {
      var tidInf = el.getAttribute('data-tid');
      var siInf = +el.getAttribute('data-si');
      var tInf = getTurno(tidInf);
      var sInf = tInf && tInf.servicios[siInf];
      if (!sInf) return;
      informeState = {
        modo: 'form', origen: 'registro',
        s: {
          fecha: sInf.fecha, servicioComercial: sInf.servicioComercial || sInf.maniobraNombre || '',
          rama: sInf.rama, hSalida: sInf.hSalida, hDestino: sInf.hDestino,
          rSalida: sInf.rSalida, rLlegDestino: sInf.rLlegDestino
        },
        inc: blankIncidencia()
      };
      renderInforme();
      return;
    }
    if (act === 'informe-generar') {
      if (!informeState || informeState.modo !== 'form') return;
      var descInf = (informeState.inc.descripcion || '').trim();
      if (!descInf) {
        appModal.alert({ title: 'Falta la descripción', message: 'Rellena la Descripción de la incidencia antes de generar el informe.' });
        return;
      }
      generarInformeIncidenciaPDF(null, informeState.s, informeState.inc, descInf, 0, 1).then(flashSaved);
      return;
    }

    if (act === 'stats-otras-toggle') {
      statsOtrasAbierta = !statsOtrasAbierta;
      renderStats();
      return;
    }
    if (act === 'stats-open') {
      var modo = el.getAttribute('data-modo');
      var abriendo = statsListMode !== modo;
      statsListMode = abriendo ? modo : null;
      // Al abrir, siempre "todas las líneas" primero — el filtro se
      // aplica a mano después, no se arrastra de la vez anterior.
      if (abriendo) statsListLinea = '';
      renderStats();
      return;
    }
    if (act === 'stats-list-close') { statsListMode = null; renderStats(); return; }
    if (act === 'stats-list-orden') {
      statsListOrden = statsListOrden === 'desc' ? 'asc' : 'desc';
      renderStats();
      return;
    }

    if (act === 'add-servicio' && t) {
      // Fecha del 2º servicio = el día real de hoy (igual que al crear un registro
      // nuevo). Así una dormida creada al día siguiente sale con la fecha correcta
      // y un 2º servicio del mismo día mantiene ese día.
      t.servicios.push(blankServicio(today()));
      expandedSvc = t.servicios.length - 1;
      autosave(); renderEditor(); return;
    }
    if (act === 'svc-toggle') {
      var nv = +el.getAttribute('data-svc');
      expandedSvc = (expandedSvc === nv) ? -1 : nv;
      renderEditor(); return;
    }
    if (act === 'del-servicio' && t) {
      var dsi = +el.getAttribute('data-svc');
      appModal.confirm({
        title: 'Quitar servicio',
        message: '¿Quitar este servicio del turno? No se puede deshacer.',
        buttons: [
          { label: 'Cancelar', value: false, kind: 'neutral' },
          { label: 'Quitar', value: true, kind: 'danger' }
        ]
      }).then(function (ok) {
        if (!ok) return;
        t.servicios.splice(dsi, 1);
        if (expandedSvc >= t.servicios.length) expandedSvc = t.servicios.length - 1;
        autosave(); renderEditor();
      });
      return;
    }
    if (act === 'add-parada-end' && t) {
      var asi = +el.getAttribute('data-svc');
      t.servicios[asi].paradas.push(blankParada());
      autosave(); renderEditor(); return;
    }
    if (act === 'add-parada-before' && t) {
      var bsi = +el.getAttribute('data-svc');
      var bi = +el.getAttribute('data-par');
      t.servicios[bsi].paradas.splice(bi, 0, blankParada());
      autosave(); renderEditor(); return;
    }
    if (act === 'del-parada' && t) {
      var dpsi = +el.getAttribute('data-svc');
      var dppi = +el.getAttribute('data-par');
      appModal.confirm({
        title: 'Quitar parada',
        message: '¿Quitar esta parada?',
        buttons: [
          { label: 'Cancelar', value: false, kind: 'neutral' },
          { label: 'Quitar', value: true, kind: 'danger' }
        ]
      }).then(function (ok) {
        if (!ok) return;
        t.servicios[dpsi].paradas.splice(dppi, 1);
        autosave(); renderEditor();
      });
      return;
    }
    if (act === 'add-pmr' && t) {
      var psi = +el.getAttribute('data-svc');
      var parAttr = el.getAttribute('data-par');
      if (parAttr != null) {
        var pari = +parAttr;
        var par = t.servicios[psi].paradas[pari];
        if (!Array.isArray(par.pmr)) par.pmr = [];
        par.pmr.push({ baja: '' });
      } else {
        t.servicios[psi].pmr = t.servicios[psi].pmr || [];
        t.servicios[psi].pmr.push({ baja: '' });
      }
      autosave(); renderEditor(); return;
    }
    if (act === 'del-pmr' && t) {
      var psi2 = +el.getAttribute('data-svc');
      var parAttr2 = el.getAttribute('data-par');
      var pmrI = +el.getAttribute('data-pmr');
      if (parAttr2 != null) {
        t.servicios[psi2].paradas[+parAttr2].pmr.splice(pmrI, 1);
      } else {
        t.servicios[psi2].pmr.splice(pmrI, 1);
      }
      autosave(); renderEditor(); return;
    }
    if (act === 'ret-edit') {
      activeRetBind = el.getAttribute('data-ret-bind');
      renderEditor();
      setTimeout(function () {
        var inp = document.querySelector('.ret-input');
        if (inp) { inp.focus(); inp.select(); }
      }, 0);
      return;
    }
    if (act === 'ret-now') {
      var bindNow = el.getAttribute('data-ret-bind');
      var diff = retrasoDesdeAhora(el.getAttribute('data-ret-hora'));
      if (diff == null) return;
      applyBind(bindNow, String(diff));
      markRetFrozen(bindNow);
      activeRetBind = null;
      renderEditor();
      return;
    }
    if (act === 'hora-now') {
      var bindHora = el.getAttribute('data-hora-bind');
      var now = new Date();
      applyBind(bindHora, pad2(now.getHours()) + ':' + pad2(now.getMinutes()));
      renderEditor();
      return;
    }
    if (act === 'app-version-tap') {
      versionTapCount++;
      clearTimeout(versionTapTimer);
      versionTapTimer = setTimeout(function () { versionTapCount = 0; }, 2000);
      if (versionTapCount >= 7) {
        versionTapCount = 0;
        clearTimeout(versionTapTimer);
        settings.telDevMode = !settings.telDevMode;
        saveSettings();
        renderSettings();
        appModal.alert({
          title: settings.telDevMode ? 'Modo desarrollador activado' : 'Modo desarrollador desactivado',
          message: settings.telDevMode ?
            'Los botones ETCS/LZB vuelven a estar visibles en Registro.' :
            'Los botones ETCS/LZB quedan ocultos en Registro.'
        });
      }
      return;
    }
    if (act === 'dictar') {
      var dictSi = +el.getAttribute('data-svc');
      if (currentRec && currentRecSvc === dictSi) stopDictado();
      else { if (currentRec) stopDictado(); startDictado(dictSi); }
      return;
    }
    if (act === 'telefonema-cat') {
      abrirTelefonemaCategoria(el.getAttribute('data-cat'), +el.getAttribute('data-svc'));
      return;
    }
    if (act === 'obs-atajo') {
      abrirObsAtajo(el.getAttribute('data-atajo'), +el.getAttribute('data-svc'));
      return;
    }
    if (act === 'telefonema-abrir') {
      abrirTelefonemaVentana(+el.getAttribute('data-svc'), +el.getAttribute('data-tel'));
      return;
    }
    if (act === 'cerrar' && t) {
      t.estado = 'cerrado';
      save(K_TURNOS, turnos);
      renderEditor();
      flashSaved();
      // Avisar a Horario para que deje el servicio en "—" (turno terminado).
      try { window.dispatchEvent(new CustomEvent('iryo:turnoCerrado')); } catch (e) {}
      return;
    }
    if (act === 'reabrir' && t) {
      t.estado = 'en_curso';
      save(K_TURNOS, turnos);
      renderEditor();
      flashSaved();
      return;
    }
    if (act === 'pdf-export') {
      var ids = [];
      document.querySelectorAll('[data-pdfi]').forEach(function (cb) {
        if (cb.checked) ids.push(cb.getAttribute('data-pdfi'));
      });
      if (!ids.length) {
        appModal.alert({ title: 'Sin selección', message: 'Selecciona al menos un turno para exportar.' });
        return;
      }
      exportPDFMany(ids);
      return;
    }
    if (act === 'pdf-mark-all') {
      document.querySelectorAll('[data-pdfi]').forEach(function (cb) { cb.checked = true; });
      return;
    }
    if (act === 'pdf-mark-none') {
      document.querySelectorAll('[data-pdfi]').forEach(function (cb) { cb.checked = false; });
      return;
    }
    if (act === 'borrar' && t) {
      appModal.confirm({
        title: 'Borrar turno',
        message: '¿Borrar este turno por completo? No se puede deshacer.',
        buttons: [
          { label: 'Cancelar', value: false, kind: 'neutral' },
          { label: 'Borrar', value: true, kind: 'danger' }
        ]
      }).then(function (ok) {
        if (!ok) return;
        turnos = turnos.filter(function (x) { return x.id !== t.id; });
        save(K_TURNOS, turnos);
        editId = null;
        renderCalendar(); setView('calendario');
      });
      return;
    }
    if (act === 'comprobaciones-toggle' && t) {
      var siChk = +el.getAttribute('data-svc');
      var svcChk = t.servicios[siChk];
      if (!svcChk) return;
      comprobacionesAbierta[siChk] = !comprobacionesOpen(siChk, svcChk);
      refreshServicioCard(siChk);
      return;
    }
    if (act === 'turno-horario-toggle' && t) {
      t.turnoHorarioActivo = !t.turnoHorarioActivo;
      autosave();
      renderEditor(); // repinta las dos cards si es dormida (mismos datos)
      return;
    }
    if (act === 'incidencia' && t) {
      var siToggle = +el.getAttribute('data-svc');
      var svcToggle = t.servicios[siToggle];
      if (!svcToggle) return;
      incidenciaAbierta[siToggle] = !incidenciaAbierta[siToggle];
      // Al abrir por primera vez sin incidencias, empieza con una en blanco
      // para no obligar a pulsar "+ Añadir otra incidencia" a la primera.
      if (incidenciaAbierta[siToggle] && !svcToggle.incidencias.length) {
        svcToggle.incidencias.push(blankIncidencia());
        autosave();
      }
      renderEditor();
      return;
    }
    if (act === 'incidencia-add') {
      var siAdd = +el.getAttribute('data-svc');
      var sAdd = t && t.servicios[siAdd];
      if (!sAdd) return;
      sAdd.incidencias.push(blankIncidencia());
      autosave(); renderEditor();
      return;
    }
    if (act === 'incidencia-generar') {
      var siGen = +el.getAttribute('data-svc');
      var iiGen = +el.getAttribute('data-inc');
      var sGen = t && t.servicios[siGen];
      var incGen = sGen && sGen.incidencias[iiGen];
      if (!incGen) return;
      var descripcionEfectiva = (incGen.descripcion.trim() || sGen.observaciones.trim());
      if (!descripcionEfectiva) {
        appModal.alert({
          title: 'Falta la descripción',
          message: 'Rellena la Descripción de la incidencia (o las Observaciones durante el trayecto) antes de generar el informe.'
        });
        return;
      }
      generarInformeIncidenciaPDF(t, sGen, incGen, descripcionEfectiva, iiGen, sGen.incidencias.length)
        .then(function () {
          incGen.generado = true;
          autosave(); renderEditor(); renderCalendar();
        });
      return;
    }
    if (act === 'incidencia-borrar') {
      var siDel = +el.getAttribute('data-svc');
      var iiDel = +el.getAttribute('data-inc');
      var sDel = t && t.servicios[siDel];
      if (!sDel || !sDel.incidencias[iiDel]) return;
      appModal.confirm({
        title: 'Borrar incidencia',
        message: '¿Borrar esta incidencia? Observaciones durante el trayecto no se toca.',
        buttons: [
          { label: 'Cancelar', value: false, kind: 'neutral' },
          { label: 'Borrar', value: true, kind: 'danger' }
        ]
      }).then(function (ok) {
        if (!ok) return;
        sDel.incidencias.splice(iiDel, 1);
        autosave(); renderEditor();
      });
      return;
    }

    // Ajustes
    if (act === 'check-update') {
      if (!('serviceWorker' in navigator)) {
        appModal.alert({ title: 'No compatible', message: 'Tu navegador no soporta actualizaciones automáticas.' });
        return;
      }
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (!reg) {
          appModal.alert({ title: 'Sin Service Worker', message: 'Aún no hay Service Worker. Recarga la página primero.' });
          return;
        }
        // Si YA hay un SW esperando antes de llamar a update() → nueva versión
        // ya descargada en una comprobación previa. Avisar y no decir "Al día".
        if (reg.waiting) {
          appModal.alert({ title: 'Nueva versión disponible', message: 'Se está aplicando — la app se recargará sola en unos segundos.' });
          return;
        }
        var decided = false;
        function detectNewWorker() {
          var nw = reg.installing;
          if (!nw) return false;
          nw.addEventListener('statechange', function () {
            if (decided) return;
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              decided = true;
              appModal.alert({ title: 'Nueva versión disponible', message: 'Se está aplicando — la app se recargará sola en unos segundos.' });
            }
          });
          return true;
        }
        reg.update().then(function () {
          // Si update() arrancó una instalación, esperamos al statechange.
          // Si no, también escuchamos por si llega después (carrera).
          detectNewWorker();
          var onFound = function () { detectNewWorker(); };
          reg.addEventListener('updatefound', onFound);
          // Ventana de espera: si en 5 s no aparece SW nuevo → realmente al día.
          setTimeout(function () {
            reg.removeEventListener('updatefound', onFound);
            if (decided) return;
            decided = true;
            appModal.alert({ title: 'Al día', message: 'Ya tienes la última versión.' });
          }, 5000);
        }).catch(function () {
          if (decided) return;
          decided = true;
          appModal.alert({ title: 'Sin conexión', message: 'No se pudo comprobar la actualización. ¿Tienes conexión?' });
        });
      });
      return;
    }
    if (act === 'theme-toggle') {
      settings.theme = (settings.theme === 'light') ? 'dark' : 'light';
      saveSettings(); applyTheme(); return;
    }
    if (act === 'save-datos-personales') {
      settings.telefono = $('set-tel').value.trim();
      settings.nombre = $('set-nombre').value.trim();
      settings.apellidos = $('set-apellidos').value.trim();
      settings.idEmpleado = $('set-id-empleado').value.trim();
      saveSettings(); flashSaved(); return;
    }
    if (act === 'save-ramas') {
      var arr = $('set-ramas').value.split('\n').map(function (x) { return x.trim(); })
        .filter(Boolean);
      settings.ramas = arr.length ? arr : DEFAULT_RAMAS.slice();
      saveSettings(); flashSaved(); renderSettings(); return;
    }
    if (act === 'export-backup') { exportBackup(); return; }
    if (act === 'import-backup') { $('file-backup').click(); return; }
    if (act === 'folder-link') { linkFolder(); return; }
    if (act === 'folder-relink') { relinkFolderPermission(); return; }
    if (act === 'folder-reindex') { reindexFromFolder(); return; }
    if (act === 'folder-unlink') {
      appModal.confirm({
        title: 'Desvincular carpeta',
        message: 'La carpeta dejará de actualizarse sola. Los archivos ya creados no se borran.',
        buttons: [
          { label: 'Cancelar', value: false, kind: 'neutral' },
          { label: 'Desvincular', value: true, kind: 'danger' }
        ]
      }).then(function (ok) { if (ok) unlinkFolder(); });
      return;
    }
    if (act === 'wipe') {
      appModal.confirm({
        title: 'Borrar todo',
        message: '¿Borrar TODOS los turnos y ajustes? Esta acción no se puede deshacer.',
        buttons: [
          { label: 'Cancelar', value: false, kind: 'neutral' },
          { label: 'Borrar todo', value: true, kind: 'danger' }
        ]
      }).then(function (ok) {
        if (!ok) return;
        appModal.confirm({
          title: 'Confirma el borrado',
          message: 'Segunda confirmación: se perderán todos los registros.',
          buttons: [
            { label: 'Cancelar', value: false, kind: 'neutral' },
            { label: 'Sí, borrar todo', value: true, kind: 'danger' }
          ]
        }).then(function (ok2) {
          if (!ok2) return;
          turnos = [];
          try {
            localStorage.removeItem(K_TURNOS);
            localStorage.removeItem(K_SETTINGS);
          } catch (e3) {}
          settings = {}; loadAll(); applyTheme();
          renderSettings();
        });
      });
      return;
    }
  }

  // ===== Inicio =====
  function init() {
    loadAll();
    loadHorarios();
    turnos.forEach(normTurno);

    var now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();

    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('click', onClick);

    // Editor inline de retraso: Enter o blur guardan; Escape cancela.
    function commitRet(inp) {
      var bind = inp.getAttribute('data-ret-bind');
      var min = parseRetraso(inp.value);
      var stored = (min == null) ? '' : String(min);
      applyBind(bind, stored);
      markRetFrozen(bind);
      activeRetBind = null;
      renderEditor();
    }
    document.addEventListener('keydown', function (e) {
      if (!e.target.classList || !e.target.classList.contains('ret-input')) return;
      if (e.key === 'Enter') { e.preventDefault(); commitRet(e.target); }
      else if (e.key === 'Escape') {
        e.preventDefault(); activeRetBind = null; renderEditor();
      }
    });
    document.addEventListener('blur', function (e) {
      if (e.target.classList && e.target.classList.contains('ret-input')) {
        commitRet(e.target);
      }
    }, true);
    document.addEventListener('change', function (e) {
      if (e.target.id === 'file-backup' && e.target.files[0]) {
        importBackup(e.target.files[0]); e.target.value = '';
      }
      if (e.target.id === 'set-autodl') {
        settings.autoDownload = e.target.checked;
        saveSettings(); flashSaved();
      }
    });

    renderCalendar();
    setView('calendario');

    initFolderHandle().then(maybeFirstRunFolderPrompt);

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }

    // El registro real y el listener de actualización viven en index.html
    // (con guarda para no recargar en la primera instalación, solo en
    // actualizaciones reales) — este bloque queda fuera para no duplicarlo.
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.REGISTRO = {
    version: APP_VERSION,
    getActiveTurno: function () {
      return turnos.find(function (t) { return t.estado === 'en_curso'; }) || null;
    },
    // Turno abierto ahora mismo en el editor (o null si no hay editor abierto).
    getEditTurno: function () {
      return editId != null ? getTurno(editId) : null;
    },
    // Índice del servicio expandido en el editor (al que apunta el cross-feed
    // de Horario). Permite que la marcha caiga sobre el 2º servicio, no el 1º.
    getActiveSvcIndex: function () {
      return expandedSvc;
    },
    getOrCreateActiveTurno: function () {
      var t = turnos.find(function (t) { return t.estado === 'en_curso'; });
      if (!t) {
        t = blankTurno(today());
        turnos.push(t);
        save(K_TURNOS, turnos);
      }
      return t;
    },
    setView: setView,
    // switchTo: render + setView (para que app.js active la vista correcta con datos)
    switchTo: function (v) {
      if (v === 'calendario') {
        renderCalendar();
        setView('calendario');
        // Re-render tras el paint para fix de layout intermitente (la
        // primera render puede ocurrir con el pane aún oculto, lo que
        // cachea dimensiones grid mal calculadas).
        requestAnimationFrame(renderCalendar);
      }
      else if (v === 'telefonemas') {
        if (window.TELEFONEMAS_LISTADO) window.TELEFONEMAS_LISTADO.render($('telefonemas-pane'));
        setView('telefonemas');
      }
      else if (v === 'informe') { renderInforme(); setView('informe'); }
      else if (v === 'estadisticas') { renderStats(); setView('estadisticas'); }
      else if (v === 'ajustes') { renderSettings(); setView('ajustes'); }
      else if (v === 'registro') {
        // Si hay turno cargado, re-renderizar el editor para mantener el
        // servicio expandido (p.ej. el 2º si ya estaba empezado). Si no,
        // abrir el del día actual (flujo openDay del calendario).
        if (editId != null && getTurno(editId)) { renderEditor(); setView('registro'); }
        else { editId = null; openDay(today()); }
      }
    },
    // Refresco automático (cross-feed GPS/HT). El modelo SIEMPRE se guarda,
    // pero el repintado se salta si el usuario tiene el foco en un campo del
    // editor o está dictando — un innerHTML completo en ese momento destruye
    // el nodo y pierde lo que aún no se ha confirmado (blur/Enter). En cuanto
    // el usuario suelta el foco, el siguiente refreshEditor (llega en 1-2s
    // con GPS activo) ya repinta con todo lo acumulado.
    refreshEditor: function () {
      if (editId == null) return;
      save(K_TURNOS, turnos);
      var pane = $('registro-pane');
      var el = document.activeElement;
      var editing = pane && el && pane.contains(el) &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if (editing || currentRec) return;
      renderEditor();
    },
    discardEmptyEdit: discardEmptyEdit
  };
  // Fuente de verdad del catálogo, leída (no duplicada) por
  // telefonemas-listado.js para la pestaña de solo consulta.
  window.TELEFONEMAS = TELEFONEMAS;
})();