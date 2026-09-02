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
  var K_GCAL_CACHE = 'rviryo_gcal_cache_v1';
  // Solo el access token de Google (vida corta, ~1h, lo emite Google — no
  // es la contraseña de la cuenta ni nada permanente) + su caducidad, para
  // no tener que volver a autenticar en cada apertura de la app dentro de
  // esa hora. Pasado ese tiempo caduca solo y no se renueva en segundo
  // plano (ver init) — habría que pedir un popup sin gesto del usuario,
  // que el navegador bloquea.
  var K_GCAL_TOKEN = 'rviryo_gcal_token_v1';
  var APP_VERSION = 'enruta-v74';

  // Lista de comprobaciones de fábrica. El usuario puede editarla en Ajustes
  // (settings.comprobaciones). Cada servicio guarda sus marcas por CLAVE
  // ({asfa:true, ...}), no por posición — así añadir/quitar/mover no descuadra
  // los turnos ya guardados.
  var DEFAULT_COMPROBACIONES = [
    { id: 'arranque-rama', label: 'Arranque rama' },
    { id: 'estado-pantografo', label: 'Estado Pantógrafo' },
    { id: 'dat-dhltv', label: 'DAT/DHLTV' },
    { id: 'asfa', label: 'ASFA' },
    { id: 'etcs-lzb', label: 'ETCS/LZB' },
    { id: 'datos-tren', label: 'Datos Tren' },
    { id: 'prueba-estanqueidad', label: 'Prueba estanqueidad' },
    { id: 'prueba-freno', label: 'Prueba de freno (Básica/Instrumental)' },
    { id: 'prueba-hm', label: 'Prueba HM' },
    { id: 'enclavamientos', label: 'Enclavamientos' },
    { id: 'luces', label: 'Luces gran intensidad / limpia' },
    { id: 'registro-gsmr', label: 'Registro GSM-R' },
    { id: 'puertas', label: 'Puertas' }
  ];
  function comprobsLista() {
    var l = settings && settings.comprobaciones;
    if (!Array.isArray(l)) return DEFAULT_COMPROBACIONES;
    var f = l.filter(function (c) { return c && c.id && c.label; });
    return f.length ? f : DEFAULT_COMPROBACIONES;
  }
  function slugComprob(label, existentes) {
    var base = String(label || '').toLowerCase();
    try { base = base.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    base = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'comprob';
    var used = {};
    (existentes || comprobsLista()).forEach(function (c) { used[c.id] = 1; });
    var id = base, n = 2;
    while (used[id]) id = base + '-' + (n++);
    return id;
  }
  // ¿El servicio tiene alguna comprobación marcada? (soporta el formato viejo
  // por posición y el nuevo por clave)
  function algunaComprob(s) {
    var c = s && s.comprobaciones;
    if (!c) return false;
    if (Array.isArray(c)) return c.some(function (x) { return x; });
    return Object.keys(c).some(function (k) { return c[k]; });
  }
  function esComprobFabrica(id) {
    return DEFAULT_COMPROBACIONES.some(function (d) { return d.id === id; });
  }
  // Marcas por clave de un servicio (objeto disperso), tolerante al formato viejo.
  function marcasComprob(s) {
    return (s && s.comprobaciones && typeof s.comprobaciones === 'object' && !Array.isArray(s.comprobaciones))
      ? s.comprobaciones : {};
  }
  // Lo que se pinta en el editor / PDF de UN servicio: las visibles, más
  // cualquiera oculta que ese servicio tenga marcada (para no perderla de vista).
  function comprobsParaServicio(s) {
    var m = marcasComprob(s);
    return comprobsLista().filter(function (c) { return !c.oculta || m[c.id]; });
  }

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
      { t: 'text', v: 'Vmeta = 0 en ' },
      { t: 'campo', id: 'tipoPk', label: 'PK / Señal', options: ['PK', 'Señal'] },
      { t: 'text', v: ' ' },
      { t: 'campo', id: 'pk', label: 'Número' },
      { t: 'text', v: ' y se valida en ' },
      { t: 'campo', id: 'tipoValidacion', label: 'Se valida en', options: ['Pantalla', 'Señal'] },
      { t: 'text', v: ' ' },
      { t: 'campo', id: 'numeroValidacion', label: 'Número' }
    ] },
    { id: 'vmeta40', label: 'Vmeta = 40', partes: [
      { t: 'text', v: 'Vmeta = 40 en ' },
      { t: 'campo', id: 'tipoPk', label: 'PK / Señal', options: ['PK', 'Señal'] },
      { t: 'text', v: ' ' },
      { t: 'campo', id: 'pk', label: 'Número' },
      { t: 'text', v: ' y se valida en ' },
      { t: 'campo', id: 'tipoValidacion', label: 'Se valida en', options: ['Pantalla', 'Señal'] },
      { t: 'text', v: ' ' },
      { t: 'campo', id: 'numeroValidacion', label: 'Número' }
    ] },
    { id: 'ltv', label: 'LTV', partes: [
      { t: 'text', v: 'LTV a ' },
      { t: 'campo', id: 'vel', label: 'km/h' },
      { t: 'text', v: ' km/h desde PK ' },
      { t: 'campo', id: 'pkDesde', label: 'PK desde' },
      { t: 'text', v: ' al PK ' },
      { t: 'campo', id: 'pkHasta', label: 'PK hasta' },
      { t: 'text', v: ' por ' },
      { t: 'campo', id: 'motivo', label: 'Motivo', options: ['estado de la vía', 'vientos', 'otros'] },
      { t: 'campoCondicional', id: 'detalle', label: 'Detalle (opcional)', prefijo: ' — ' }
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
    { id: 'parada', label: 'Detenido ante…', partes: [
      { t: 'text', v: 'Detenido ante la ' },
      { t: 'campo', id: 'tipo', label: 'Pantalla / Señal / PK', options: ['Pantalla', 'Señal', 'PK'] },
      { t: 'text', v: ' ' },
      { t: 'campo', id: 'numero', label: 'Número' },
      { t: 'text', v: ', se reanuda la marcha con ' },
      { t: 'campo', id: 'minutos', label: 'Minutos' },
      { t: 'text', v: ' min.' },
      { t: 'campoCondicional', id: 'motivo', label: 'Motivo (opcional)', prefijo: ' Motivo: ' }
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
      cat: 'LTV', catLabel: 'Limitación temporal velocidad', catCorto: 'LTV', color: 'rc',
      nombre: 'Limitación Temporal de Velocidad',
      variantes: [
        {
          codigo: 'LTV3', nombre: 'Establecida o suprimida (con causa)',
          partes: [
            { t: 'selector', id: 'accion', opciones: ['Establecida', 'Suprimida'] },
            { t: 'text', v: ' limitación temporal de velocidad máxima a ' },
            { t: 'campo', id: 'vel', label: 'Velocidad (km/h)' },
            { t: 'text', v: ' km/h ' },
            { t: 'campoOpcional', id: 'vias', prefijo: 'en vía/s ', campoHint: 'vía/s' },
            { t: 'text', v: ' desde el km ' },
            { t: 'campo', id: 'kmDesde', label: 'Km desde' },
            { t: 'text', v: ' al ' },
            { t: 'campo', id: 'kmHasta', label: 'Km hasta' },
            { t: 'text', v: ' entre ' },
            { t: 'campo', id: 'entre1', label: 'Estación' },
            { t: 'text', v: ' y ' },
            { t: 'campo', id: 'entre2', label: 'Estación' },
            { t: 'text', v: ' ' },
            { t: 'campoOpcional', id: 'causa', prefijo: 'por ', campoHint: 'trinchera, zona inundable, vientos…', hueco: true },
            { t: 'text', v: '. Se encuentra ' },
            { t: 'selector', id: 'senalizada', opciones: ['señalizada', 'sin señalizar'] },
            { t: 'text', v: ' ' },
            { t: 'opcional', id: 'csv', label: 'Supone un CSV', v: 'Supone un CSV' }
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
  var cuadranteAbierto = false; // celda "Turno" (datos de Calendar) plegada/desplegada
  var setComprobsOpen = false; // tarjeta "Comprobaciones" de Ajustes, plegada por defecto
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

  // Sincronización con Google Calendar (solo modo desarrollador). Estado
  // en memoria, no persistido — salvo gcalToken, que SÍ se guarda (junto
  // con su caducidad, K_GCAL_TOKEN) para no pedir vincular en cada
  // apertura de la app — ver sección dedicada más abajo.
  var GCAL_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
  var gcalTokenClient = null;
  var gcalToken = null;
  var gcalScriptRequested = false;
  var gcalChecking = false;
  var gcalPropuestas = null; // días con turno YA creado — listos para revisar/completar
  var gcalRangoDesde = null;
  var gcalRangoHasta = null;
  // Caché de lo que dice Google Calendar para días SIN turno creado
  // todavía — puramente informativa (Calendario) hasta que el usuario
  // cree el turno a mano, momento en que se usa para autorrellenarlo.
  var gcalCache = {};
  var gcalModalResolve = null; // resolveWith del modal de revisión abierto desde Calendario, si hay uno

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
    var out = v;
    // Un turno marcado _deCache (creado solo, autorrellenado desde la
    // caché de Google Calendar) nunca se persiste por sí solo — solo
    // cuenta como real en cuanto el usuario toca algo (ver applyBind/
    // autofillServicio/autosave). Así ninguna escritura de OTRO turno
    // arrastra de rebote uno que la app creó pero el usuario ni miró.
    if (k === K_TURNOS && Array.isArray(v)) {
      // Salvaguarda: un turno marcado _deCache que ya tiene datos que SOLO
      // pone el usuario (n1, vía, rama, observaciones, comprobaciones, PMR,
      // viajeros, incidencias) NO es "solo caché" — se confirma para que no
      // se pierda si el flag se quedó sin limpiar por algún camino.
      v.forEach(function (t) {
        if (t._deCache && tieneDatosDeUsuario(t)) t._deCache = false;
      });
      out = v.filter(function (t) { return !t._deCache; });
    }
    try { localStorage.setItem(k, JSON.stringify(out)); }
    catch (e) {
      // localStorage lleno o bloqueado: NO tragárselo en silencio, es
      // pérdida de datos. Avisar una vez.
      if (!save._avisadoLleno) {
        save._avisadoLleno = true;
        try {
          appModal.alert({
            title: 'No se pudo guardar',
            message: 'El almacenamiento del dispositivo está lleno o bloqueado. ' +
              'Exporta una copia (Ajustes → Exportar copia) y libera espacio.'
          });
        } catch (e2) {}
      }
    }
    // Único punto por el que pasan TODAS las escrituras de turnos (las
    // debounced de autosave() y las directas) — enganchar aquí basta para
    // que la copia en la nube (OneDrive) cubra cualquier cambio. Capa
    // opcional: si no hay sesión o nube.js no cargó, no hace nada.
    if (k === K_TURNOS && window.NUBE) window.NUBE.onTurnosSaved(out);
    if ((k === K_SETTINGS || k === K_GCAL_CACHE) && window.NUBE && window.NUBE.onConfigSaved) window.NUBE.onConfigSaved();
  }
  var saveTimer = null;
  function autosave() {
    // Cualquier autosave del turno abierto significa que el usuario ha
    // tocado algo de verdad — deja de estar pendiente de confirmación.
    var tEdit = editId != null ? getTurno(editId) : null;
    if (tEdit) tEdit._deCache = false;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      save(K_TURNOS, turnos);
    }, 350);
  }
  // Fuerza el guardado pendiente YA (al cerrar/segundo plano la app, para no
  // perder la última edición si el navegador mata la página antes de los 350ms).
  function flushAutosave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; save(K_TURNOS, turnos); }
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
    gcalCache = load(K_GCAL_CACHE, {});
    var gcalTok = load(K_GCAL_TOKEN, null);
    if (gcalTok && gcalTok.token && gcalTok.exp > Date.now()) gcalToken = gcalTok.token;
    if (!settings.ramas || !settings.ramas.length) settings.ramas = DEFAULT_RAMAS.slice();
    if (settings.telefono == null) settings.telefono = '';
    if (settings.nombre == null) settings.nombre = '';
    if (settings.apellidos == null) settings.apellidos = '';
    if (settings.idEmpleado == null) settings.idEmpleado = '';
    if (!settings.theme) settings.theme = 'dark';
    // Cambio automático claro/oscuro por hora. Por defecto: claro 08:00–20:00.
    if (settings.themeAuto == null) settings.themeAuto = false;
    if (settings.themeAutoClaro == null) settings.themeAutoClaro = '08:00';
    if (settings.themeAutoOscuro == null) settings.themeAutoOscuro = '20:00';
    if (settings.calView !== 'list') settings.calView = 'grid';
    // Comprobaciones editables. Por defecto, las de fábrica. Se sanean a
    // {id,label} y se les pone clave si falta (listas de versiones antiguas).
    if (!Array.isArray(settings.comprobaciones) || !settings.comprobaciones.length) {
      settings.comprobaciones = DEFAULT_COMPROBACIONES.map(function (c) { return { id: c.id, label: c.label }; });
    } else {
      var vistos = {};
      settings.comprobaciones = settings.comprobaciones
        .filter(function (c) { return c && (c.label || typeof c === 'string'); })
        .map(function (c) {
          var label = typeof c === 'string' ? c : String(c.label);
          var id = (c && c.id) || slugComprob(label, Object.keys(vistos).map(function (k) { return { id: k }; }));
          while (vistos[id]) id = id + '-2';
          vistos[id] = 1;
          return { id: id, label: label, oculta: !!(c && c.oculta) };
        });
    }
    // Secciones del editor que se pueden ocultar desde Ajustes (ocultar ≠
    // borrar: si un turno ya tiene el dato, la sección sigue saliendo en él).
    if (settings.regLtvOculta == null) settings.regLtvOculta = false;
    if (settings.regHorarioOculto == null) settings.regHorarioOculto = false;
    // "Asistentes" por estación: oculto por defecto (campo opcional).
    if (settings.regAsistentesOculto == null) settings.regAsistentesOculto = true;
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
    // Copia en la nube (OneDrive) — aviso de primer arranque (una vez).
    if (settings.nubeAvisoContador == null) settings.nubeAvisoContador = 0;
    if (settings.nubePrivacidadVista == null) settings.nubePrivacidadVista = false;
    // Ventana de inicio (carrusel de bienvenida + novedades). Estado por
    // aparato — una tablet nueva vuelve a ver la guía.
    if (settings.bienvenidaVista == null) settings.bienvenidaVista = false;
    if (settings.bienvenidaVersion == null) settings.bienvenidaVersion = '';
  }
  function saveSettings() { save(K_SETTINGS, settings); }

  // ===== Copia en la nube (OneDrive) — puente con nube.js =====
  // nube.js (IIFE aparte) hace login + Microsoft Graph. Aquí viven las
  // funciones que necesita tocar el modelo de turnos. Contrato en
  // window.REGISTRO.nube (al final del archivo).
  function nubeDiaTurnosReales(fecha) {
    return turnosOfDay(fecha).filter(function (t) {
      return !isEmptyTurno(t) && !t._deCache;
    });
  }
  // JSON canónico y determinista de un día (turnos ordenados por id) — lo que
  // nube.js compara para saber si un día está "sucio". null = día sin turnos.
  function nubeDiaJSON(fecha) {
    return nubeCanon(fecha, turnosOfDay(fecha));
  }
  // Forma canónica y determinista de un conjunto de turnos de un día. La usan
  // nube.js para local Y para lo que baja de la nube — misma normalización en
  // los dos lados = comparación fiable (sin subidas/bajadas en bucle).
  function nubeCanon(fecha, arr) {
    var dia = (arr || []).filter(function (t) {
      return t && !t._deCache && !isEmptyTurno(t);
    }).map(function (t) {
      return normTurno(JSON.parse(JSON.stringify(t)));
    }).sort(function (a, b) {
      return String(a.id).localeCompare(String(b.id));
    });
    if (!dia.length) return null;
    return JSON.stringify({ fecha: fecha, turnos: dia });
  }
  function nubeFechasConTurnos() {
    var f = {};
    turnos.forEach(function (t) {
      if (t._deCache || isEmptyTurno(t)) return;
      (t.servicios || []).forEach(function (s) { if (s.fecha) f[s.fecha] = true; });
    });
    return Object.keys(f);
  }
  // Fusión decidida por nube.js: mete turnos nuevos y actualiza los que
  // vienen más recientes de la nube. `removeIds` normalmente vacío.
  // GUARDA DE SEGURIDAD: nunca sustituye un turno local CON DATOS por una
  // versión de la nube que viene vacía (archivo corrupto/truncado, o subido
  // por una versión antigua de la app). Ante la duda, se queda lo local.
  // Copia de seguridad local ANTES de aplicar una fusión de la nube. Solo se
  // refresca si el estado actual NO tiene menos turnos que la copia guardada,
  // así una fusión que pierda datos nunca machaca una copia buena.
  function nubeSnapshot() {
    try {
      var cur = load(K_TURNOS, []);
      var prev = JSON.parse(localStorage.getItem('rviryo_turnos_snap') || 'null');
      if (!prev || cur.length >= ((prev.turnos || []).length)) {
        localStorage.setItem('rviryo_turnos_snap',
          JSON.stringify({ at: Date.now(), turnos: cur }));
      }
    } catch (e) {}
  }
  function nubeAplicarDia(upsert, removeIds) {
    nubeSnapshot();
    (upsert || []).forEach(function (rt) {
      if (!rt || !rt.id) return;
      var lt = getTurno(rt.id);
      var nt = normTurno(rt);
      if (lt) {
        // No pisar datos locales con una versión de la nube más pobre:
        //  - la nube viene vacía y lo local tiene datos, o
        //  - la nube tiene menos servicios con datos que lo local.
        if (!isEmptyTurno(lt) &&
            (isEmptyTurno(nt) || nServiciosConDatos(nt) < nServiciosConDatos(lt))) return;
        turnos[turnos.indexOf(lt)] = nt;
      } else {
        turnos.push(nt);
      }
    });
    (removeIds || []).forEach(function (id) {
      var lt = getTurno(id);
      if (lt) turnos.splice(turnos.indexOf(lt), 1);
    });
    // Un turno de la nube con id distinto para un día que aquí YA tenía turno
    // (creado a la vez en otro aparato) → juntarlos, no dejar dos.
    dedupeTurnos();
    save(K_TURNOS, turnos); // NUBE.onTurnosSaved se autoignora (NUBE.aplicando())
  }
  // ===== Configuración (ajustes) en la nube =====
  // Además de los turnos, se sincroniza la configuración del dispositivo:
  // ramas, nombre/apellidos/ID, teléfono, tema, modo desarrollador, config de
  // Google Calendar... Así, al vincular OneDrive en un aparato nuevo, se trae
  // TODO del que ya lo tenía, no solo los registros.
  // NO se sincroniza: calView (lista/mes es preferencia por aparato) y los
  // contadores locales (aviso de nube, última copia).
  var CONFIG_NO_SYNC = { calView: 1, nubeAvisoContador: 1, lastBackup: 1,
    bienvenidaVista: 1, bienvenidaVersion: 1 };
  // Ajustes de bajo riesgo (no hay nada que "perder"): siempre gana la última
  // escritura, así un cambio de tema propaga a los dos aparatos. El resto
  // (nombre, ramas, Client ID de Google...) solo se rellena si aquí falta.
  var CONFIG_LWW = {
    theme: 1, themeAuto: 1, themeAutoClaro: 1, themeAutoOscuro: 1,
    autoDownload: 1, nubePrivacidadVista: 1, comprobaciones: 1,
    regLtvOculta: 1, regHorarioOculto: 1, regAsistentesOculto: 1
  };
  function nubeConfigParaSubir() {
    var out = {};
    Object.keys(settings).forEach(function (k) {
      if (k.charAt(0) === '_' || CONFIG_NO_SYNC[k]) return;
      out[k] = settings[k];
    });
    return out;
  }
  function nubeConfigVacio(v) {
    return v == null || v === '' || v === false ||
      (Array.isArray(v) && v.length === 0);
  }
  // primeraVez=true (este aparato nunca sincronizó config): se trae TODO del
  // otro. Después: solo se RELLENA lo que aquí esté vacío y NUNCA se pisa un
  // valor que ya tienes con otro distinto — así un aparato sin configurar
  // (p.ej. el móvil sin login de Google) no borra los ajustes del que sí lo
  // está (Client ID de Google, modo desarrollador, nombre, ramas...).
  function nubeAplicarConfig(remote, primeraVez) {
    if (!remote) return false;
    var cambio = false;
    Object.keys(remote).forEach(function (k) {
      if (k.charAt(0) === '_' || CONFIG_NO_SYNC[k]) return;
      if (JSON.stringify(settings[k]) === JSON.stringify(remote[k])) return;
      // CONFIG_LWW (tema, autoDownload...) siempre gana el más nuevo — el
      // que baja aquí ya es más reciente (bajarConfig comprueba rem.at).
      if (!primeraVez && !CONFIG_LWW[k]) {
        if (!nubeConfigVacio(settings[k])) return; // ya tienes valor → no se pisa
        if (nubeConfigVacio(remote[k])) return;    // no traer un vacío
      }
      settings[k] = remote[k];
      cambio = true;
    });
    if (!cambio) return false;
    if (!settings.ramas || !settings.ramas.length) settings.ramas = DEFAULT_RAMAS.slice();
    if (!settings.theme) settings.theme = 'dark';
    saveSettings();
    applyTheme();
    if (lastSetView === 'ajustes') renderSettings();
    else nubeReRender();
    return true;
  }

  // Aplica en local un borrado que viene de la nube (otro dispositivo lo borró).
  // NO genera lápida nueva — solo ejecuta un borrado ya conocido.
  function nubeBorrarIds(ids) {
    var set = {};
    (ids || []).forEach(function (id) { set[id] = true; });
    var antes = turnos.length;
    turnos = turnos.filter(function (t) { return !set[t.id]; });
    if (turnos.length !== antes) { save(K_TURNOS, turnos); nubeReRender(); }
  }
  function nubeReRender() {
    if (lastSetView === 'calendario') renderCalendar();
    else if (lastSetView === 'ajustes') renderSettings();
    else if (lastSetView === 'estadisticas') renderStats();
    else if (lastSetView === 'registro' && editId != null) {
      var pane = $('registro-pane'), el = document.activeElement;
      var editing = pane && el && pane.contains(el) &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if (!editing && !currentRec) renderEditor();
    }
  }
  var nubePrivMostrando = false;
  // Aviso de privacidad: se muestra tras vincular Y también en la siguiente
  // apertura si por lo que sea no llegó a verse (el SW recarga la app sola
  // tras volver del login la primera vez tras una versión nueva). El flag
  // NO se marca hasta que el usuario cierra el aviso.
  function nubeTrasVincular() { maybeNubePrivacidad(false); }
  // forzar=true → botón «Aviso de privacidad» de Ajustes: se muestra siempre.
  // Si NO se pulsa «Entendido» (ESC, o se cierra de otra forma), el flag no se
  // marca y el aviso vuelve a salir en la siguiente apertura.
  function maybeNubePrivacidad(forzar) {
    if (nubePrivMostrando) return;
    if (!forzar) {
      if (settings.nubePrivacidadVista) return;
      if (!window.NUBE || !window.NUBE.estaVinculada()) return;
    }
    nubePrivMostrando = true;
    appModal.confirm({
      title: 'Tu copia en OneDrive',
      message:
        'EnRuta guarda los turnos en tu OneDrive de empresa.\n\n' +
        '· Los datos se guardan en tu propio dispositivo y en tu OneDrive.\n' +
        '· Solo tú tienes acceso. EnRuta no tiene servidor ni base de datos común.\n' +
        '· Con esto, tienes los turnos en el móvil y en la tablet.\n' +
        '· Puedes borrarlos cuando quieras, desde Ajustes o desde OneDrive.',
      buttons: [{ label: 'Entendido', value: 'ok', kind: 'primary' }],
      dismissValue: null
    }).then(function (v) {
      nubePrivMostrando = false;
      if (v === 'ok') { settings.nubePrivacidadVista = true; saveSettings(); }
    });
  }
  // Botón-icono de estado de la copia en la nube. Va en la barra del
  // calendario (rejilla y lista) y en la cabecera del editor de Registro.
  //   sin vincular  → ☁️ gris   · toca = vincular
  //   reconectar    → ⚠️        · toca = reconectar
  //   sincronizando → ⏳ (gira) · toca = nada útil (ya está)
  //   error subida  → ⚠️ rojo   · toca = reintentar
  //   al día        → ☁️ verde  · toca = forzar subida ahora
  function nubeIconoBtn() {
    if (!window.NUBE || !window.NUBE.disponible()) return '';
    var e = window.NUBE.estado();
    var M = {
      sin:        { ic: '☁️', cls: 'nb-sin',   t: 'Copia en la nube desactivada — toca para activar' },
      reconectar: { ic: '⚠️', cls: 'nb-error', t: 'Sesión de Microsoft caducada — toca para reconectar' },
      sync:       { ic: '⏳', cls: 'nb-sync',  t: 'Guardando en la nube…' },
      error:      { ic: '⚠️', cls: 'nb-error', t: 'Error al subir a la nube — toca para reintentar' },
      ok:         { ic: '☁️', cls: 'nb-ok',    t: 'Copia en la nube al día — toca para subir ahora' }
    };
    var m = M[e] || M.sin;
    return '<button class="cal-toggle nube-ico ' + m.cls + '" data-action="nube-icono" title="' +
      m.t + '" aria-label="' + m.t + '">' + m.ic + '</button>';
  }
  function nubeInfoBtn() {
    if (!window.NUBE || !window.NUBE.disponible()) return '';
    return '<button class="cal-toggle" data-action="nube-privacidad" title="Aviso de privacidad" aria-label="Aviso de privacidad">ⓘ</button>';
  }
  // Aviso para activar la copia en la nube (la ÚNICA copia de seguridad ahora
  // que se ha quitado el guardado local en archivos). Se muestra la 1ª vez y,
  // si el usuario no vincula, se repite cada 8 aperturas hasta que lo haga.
  function maybeFirstRunNubePrompt() {
    if (bienvenidaMostradaEsteArranque) return; // no apilar dos modales el primer día
    if (!window.NUBE || !window.NUBE.disponible()) return;
    if (window.NUBE.estaVinculada()) return;
    var n = (settings.nubeAvisoContador || 0) + 1;
    settings.nubeAvisoContador = n;
    saveSettings();
    if (n !== 1 && n % 8 !== 0) return;
    appModal.confirm({
      title: 'Guarda tus turnos en la nube',
      message: 'Tus turnos solo están guardados en esta tablet. Activa la copia ' +
        'en tu OneDrive de empresa para no perderlos nunca y tenerlos también ' +
        'en el móvil. Los datos son solo tuyos y solo hay que dar permiso una vez.',
      buttons: [
        { label: 'Ahora no', value: false, kind: 'neutral' },
        { label: 'Vincular con Microsoft', value: true, kind: 'primary' }
      ]
    }).then(function (ok) { if (ok && window.NUBE) window.NUBE.vincular(); });
  }

  // ===== Ventana de inicio (carrusel de bienvenida + novedades) =====
  var bienvenidaMostradaEsteArranque = false;

  // Páginas de la guía (se ven enteras el primer arranque y desde el botón de
  // Ajustes). NADA de modo desarrollador aquí.
  // Ilustraciones: piezas REALES de la app (icono, barra de pestañas, celdas
  // de calendario) reutilizando sus propias clases — no dibujos.
  var BIENV_FIG = {
    icono:
      '<img src="icon-192.png" alt="EnRuta-RV" width="96" height="96" ' +
      'style="border-radius:20px;box-shadow:0 4px 14px rgba(0,0,0,.3)">',
    // Barra de pestañas: los mismos <button class="tab"> que la app.
    tabs: (function () {
      var t = [['📅', 'Calendario', ' active'], ['📋', 'Registro', ''],
        ['📞', 'Telefonemas', ''], ['📄', 'Informe', ''],
        ['📊', 'Estadísticas', ''], ['⚙', 'Ajustes', '']];
      return '<div class="bienv-tabs">' + t.map(function (x) {
        return '<span class="tab' + x[2] + '">' + x[0] + ' ' + x[1] + '</span>';
      }).join('') + '</div>';
    })(),
    // Mini calendario con las celdas reales (.cal-day), una en curso.
    calendario: (function () {
      var h = '<div class="bienv-cal"><div class="cal-grid">';
      for (var d = 2; d <= 15; d++) {
        var cls = 'cal-day';
        var extra = '';
        if (d === 9) { cls += ' today en-curso'; extra = '<span class="dot en_curso"></span>'; }
        h += '<div class="' + cls + '"><span class="dnum">' + d + '</span>' + extra + '</div>';
      }
      return h + '</div></div>';
    })()
  };

  var BIENVENIDA_PAGINAS = [
    {
      titulo: 'Bienvenido a EnRuta-RV',
      fig: BIENV_FIG.icono,
      puntos: [
        'App para maquinistas: lleva el registro de tus viajes, turno a turno.',
        'Anota servicios, paradas, viajeros, PMR, comprobaciones, telefonemas e informes de incidencia.',
        'Funciona sin conexión. Todo se guarda en tu dispositivo al momento.'
      ]
    },
    {
      titulo: 'Cómo se organiza',
      fig: BIENV_FIG.tabs,
      puntos: [
        'Calendario — tus turnos por día. Toca un día para ver o crear el turno.',
        'Registro — el editor del turno: servicios, paradas, observaciones.',
        'Telefonemas — todos los telefonemas para consulta.',
        'Informe — genera el PDF del informe de incidencia con los datos del servicio donde ocurrió la incidencia.',
        'Estadísticas — servicios, horas y retrasos en el rango que elijas.',
        'Ajustes — tus datos, ramas, tema, edita las opciones del registro de servicios y la gestión en la nube.'
      ]
    },
    {
      titulo: 'Empezar un turno',
      fig: BIENV_FIG.calendario,
      puntos: [
        'En Calendario, toca el día y crea el turno.',
        'Elige el Servicio Comercial: se rellenan origen, destino y paradas del Libro de Horarios.',
        'Completa vía, rama, viajeros, PMR, comprobaciones y observaciones. Se guarda solo.',
        'Al acabar, «Cerrar turno» — queda en solo lectura (puedes reabrirlo).',
        '¿Dormida? El turno abarca los dos días automáticamente.'
      ]
    },
    {
      titulo: 'Dónde están tus datos',
      fig: null,
      puntos: [
        'Todo se guarda en este dispositivo. Nadie más lo ve.',
        'Puedes activar la copia en la nube (Ajustes): guarda una copia en tu OneDrive y mantiene los mismos turnos en el móvil y la tablet.',
        'Cada maquinista gestiona solo sus datos y puede borrarlos cuando quiera.'
      ]
    }
  ];

  // Novedades de la actualización. Se ve sola al actualizar a una versión
  // nueva, y como última página del carrusel el primer arranque.
  var BIENVENIDA_NOVEDADES = {
    titulo: 'Novedades',
    fig: null,
    puntos: [
      'Comprobaciones editables (Ajustes → «Editar el registro»): renómbralas, ocúltalas o añade las tuyas.',
      'Oculta lo que no uses: la hora de LTV, la celda de Toma / Descanso / Deje.',
      'Nuevo campo «Asistentes» por estación (se activa en Ajustes).',
      'Servicio comercial manual cuando no está en el Libro de Horarios.',
      'PMR con dirección y cantidad (♿↑ suben / ♿↓ bajan) en cada estación.',
      'Observaciones con viñetas y atajos (LTV, «detenido ante…», Vmáx…).',
      'Telefonemas rediseñados: selectores de un toque, sin desplegables.',
      'Copia en la nube (OneDrive) más robusta: sincroniza sola, aguanta mala cobertura y los borrados se propagan entre dispositivos.',
      'Calendario en el móvil arreglado.',
      'Los cambios de Ajustes se ven al instante en el editor, sin reabrir el turno.'
    ]
  };

  function bienvPageHtml(pag) {
    var h = '<div class="bienv-page">';
    h += '<div class="modal-title">' + esc(pag.titulo) + '</div>';
    if (pag.fig) h += '<div class="bienv-fig">' + pag.fig + '</div>';
    h += '<ul class="bienv-list">';
    pag.puntos.forEach(function (p) { h += '<li>' + esc(p) + '</li>'; });
    h += '</ul></div>';
    return h;
  }

  // soloNovedades: al actualizar → una sola página, botón «Entendido».
  // desdeAjustes: no persiste flags (es la guía a demanda).
  function mostrarBienvenida(soloNovedades, desdeAjustes) {
    var paginas = soloNovedades ? [BIENVENIDA_NOVEDADES]
      : BIENVENIDA_PAGINAS.concat([BIENVENIDA_NOVEDADES]);
    var total = paginas.length;
    var i = 0;

    appModal.custom({
      className: 'wide bienv-modal',
      backdropClose: false,
      render: function (box, resolveWith) {
        function pintar() {
          var ultima = i === total - 1;
          var h = bienvPageHtml(paginas[i]);
          h += '<div class="bienv-nav">';
          if (total > 1) {
            h += i > 0
              ? '<button type="button" class="modal-btn neutral bienv-prev">‹ Atrás</button>'
              : '<span></span>';
            h += '<span class="bienv-dots">';
            for (var d = 0; d < total; d++) h += '<span class="bienv-dot' + (d === i ? ' on' : '') + '"></span>';
            h += '</span>';
          } else {
            h += '<span></span>';
          }
          if (ultima) {
            h += '<button type="button" class="modal-btn primary bienv-fin">' +
              (soloNovedades ? 'Entendido' : 'Empezar') + '</button>';
          } else {
            h += '<button type="button" class="modal-btn primary bienv-next">Siguiente ›</button>';
          }
          h += '</div>';
          if (ultima && !soloNovedades) {
            h += '<label class="bienv-nomas"><input type="checkbox" class="bienv-nomas-cb"' +
              (settings.bienvenidaVista ? ' checked' : '') + '> No volver a mostrar esta guía</label>';
          }
          box.innerHTML = h;
          var prev = box.querySelector('.bienv-prev');
          var next = box.querySelector('.bienv-next');
          var fin = box.querySelector('.bienv-fin');
          if (prev) prev.addEventListener('click', function () { if (i > 0) { i--; pintar(); } });
          if (next) next.addEventListener('click', function () { if (i < total - 1) { i++; pintar(); } });
          if (fin) fin.addEventListener('click', function () {
            var cb = box.querySelector('.bienv-nomas-cb');
            if (!desdeAjustes) {
              if (!soloNovedades && cb) settings.bienvenidaVista = cb.checked;
              settings.bienvenidaVersion = APP_VERSION;
              saveSettings();
            }
            resolveWith(true);
          });
        }
        pintar();
      }
    });
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
      servicioComercial: '', servicioComercial2: '', origen: '', destino: '', via: '', rama: '',
      hSalida: '', hDestino: '', rSalida: '', rLlegDestino: '',
      esTraslado: false, maniobraNombre: '', servicioManual: false,
      horaLTV: '', paradas: [],
      n1: '', viajeros: '', asistencias: '', asistentes: '', plazasH: '', pmr: [],
      comprobaciones: {},
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
      viajeros: '', asistencias: '', asistentes: ''
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
    // Migración: versiones anteriores guardaban minutos sueltos ("826").
    // Un input type="time" no admite ese formato — se convierte a HH:MM.
    if (/^\d+$/.test(t.descanso)) t.descanso = minToHHMM(+t.descanso);
    if (!t.servicios) t.servicios = [];
    t.servicios.forEach(function (s, si) {
      if (s.origen == null) s.origen = '';
      if (s.destino == null) s.destino = '';
      if (s.servicioComercial2 == null) s.servicioComercial2 = '';
      if (s.servicioManual == null) s.servicioManual = false;
      if (s.rSalida == null) s.rSalida = '';
      if (s.rLlegDestino == null) s.rLlegDestino = '';
      if (s.asistentes == null) s.asistentes = '';
      if (s.horaLTV == null) s.horaLTV = '';
      // Migración LTV global → servicio 0
      if (si === 0 && !s.horaLTV && t.horaLTV) s.horaLTV = t.horaLTV;
      if (!s.paradas) s.paradas = [];
      if (!s.telefonemas) s.telefonemas = [];
      // Recuperar tParada del Libro de Horarios si está a 0 (turnos guardados
      // antes de que autofillServicio lo mapeara). Sin esto, las paradas
      // intermedias comerciales no muestran H. Llegada.
      var hr = null;
      if (s.servicioComercial && !s.servicioManual && horarios && horarios.length) {
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
        if (p.asistentes == null) p.asistentes = '';
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
      // Comprobaciones: del formato viejo por posición al nuevo por clave.
      // Las marcas del array viejo se asignan a las claves de fábrica por
      // posición (una sola vez). Solo se guardan las marcadas (true).
      if (Array.isArray(s.comprobaciones)) {
        var arr = s.comprobaciones, oc = {};
        DEFAULT_COMPROBACIONES.forEach(function (c, i) { if (arr[i]) oc[c.id] = true; });
        s.comprobaciones = oc;
      } else if (!s.comprobaciones || typeof s.comprobaciones !== 'object') {
        s.comprobaciones = {};
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
  // Datos que SOLO introduce el usuario a mano (nunca el autorrelleno de
  // Google Calendar, que solo pone servicio/origen/destino/horas del Libro).
  function tieneDatosDeUsuario(t) {
    return (t.servicios || []).some(function (s) {
      return s.n1 || s.via || s.rama || s.observaciones ||
        (s.pmr || []).length ||
        algunaComprob(s) ||
        (s.incidencias || []).length ||
        (s.paradas || []).some(function (p) {
          return p.viajeros || p.asistencias || p.asistentes || (p.pmr || []).length;
        });
    });
  }
  // ¿Un servicio no tiene NINGÚN dato del usuario? (solo la fecha automática)
  function isEmptyServicio(s) {
    if (!s) return true;
    if (s.servicioComercial || s.servicioComercial2 || s.via || s.rama || s.n1 ||
        s.viajeros || s.asistencias || s.asistentes || s.plazasH || s.observaciones ||
        s.esTraslado || s.servicioManual || s.maniobraNombre ||
        s.origen || s.destino || s.hSalida || s.hDestino ||
        s.rSalida || s.rLlegDestino || s.horaLTV) return false;
    if ((s.pmr || []).length) return false;
    if ((s.paradas || []).some(function (p) {
      return p.nombre || p.hora || p.hLleg || p.rLleg || p.rSal ||
             p.viajeros || p.asistencias || p.asistentes || (p.pmr || []).length;
    })) return false;
    if (algunaComprob(s)) return false;
    if (s.incidencias && s.incidencias.length) return false;
    return true;
  }
  // ¿Turno sin NINGÚN dato del usuario? (solo la fecha automática del servicio)
  function isEmptyTurno(t) {
    if (t.horaLTV || t.toma || t.deje || t.descanso) return false;
    return (t.servicios || []).every(isEmptyServicio);
  }
  // Servicios de un turno que SÍ tienen datos — para no aceptar de la nube una
  // versión con menos contenido que la local.
  function nServiciosConDatos(t) {
    return (t.servicios || []).filter(function (s) { return !isEmptyServicio(s); }).length;
  }

  // ===== Deduplicado de turnos por día =====
  // La app es "un turno por día (o por dormida)". Pero cada turno lleva un id
  // aleatorio: si se crea el turno del mismo día en la tablet Y en el móvil
  // (antes de que sincronicen), la nube fusiona por id y acaban DOS turnos
  // para el mismo día → "servicios duplicados". Esto los vuelve a juntar.
  function fechasDe(t) {
    var fs = {};
    (t.servicios || []).forEach(function (s) { if (s.fecha) fs[s.fecha] = 1; });
    return Object.keys(fs);
  }
  // ¿fechas(a) ⊆ fechas(b)? Se juntan dos turnos solo si uno "cabe" dentro
  // del otro (28 dentro de 28→29). Dos dormidas consecutivas (28→29 y 29→30)
  // comparten un día pero ninguna cabe en la otra → NO se juntan.
  function fechasContenidas(a, b) {
    var bf = fechasDe(b);
    var af = fechasDe(a);
    return af.length > 0 && af.every(function (d) { return bf.indexOf(d) !== -1; });
  }
  // ¿Dos servicios son "el mismo"? Por nº de tren + fecha (clave estable). Sin
  // número (traslado/manual) → por ruta + hora de salida.
  function mismoServicioLogico(a, b) {
    if ((a.fecha || '') !== (b.fecha || '')) return false;
    var an = (a.servicioComercial || '').trim(), bn = (b.servicioComercial || '').trim();
    if (an && bn) return an === bn;
    return (a.origen || '') === (b.origen || '') &&
           (a.destino || '') === (b.destino || '') &&
           (a.hSalida || '') === (b.hSalida || '');
  }
  // Une src DENTRO de ds sin perder nada: rellena huecos, y para los campos
  // multivalor (observaciones, incidencias, comprobaciones, PMR, paradas) une
  // en vez de quedarse solo con uno.
  function rellenaHuecosServicio(ds, ss) {
    ['servicioComercial', 'servicioComercial2', 'via', 'rama', 'n1', 'viajeros',
     'asistencias', 'asistentes', 'plazasH', 'hSalida', 'hDestino', 'rSalida', 'rLlegDestino',
     'horaLTV', 'origen', 'destino', 'maniobraNombre'].forEach(function (k) {
      if (!ds[k] && ss[k]) ds[k] = ss[k];
    });
    // Observaciones: unir líneas que falten (nunca descartar texto).
    if (ss.observaciones && ss.observaciones !== ds.observaciones) {
      var lns = (ds.observaciones || '').split('\n');
      (ss.observaciones || '').split('\n').forEach(function (ln) {
        if (ln.trim() && lns.indexOf(ln) === -1) lns.push(ln);
      });
      ds.observaciones = lns.filter(function (x) { return x !== '' || lns.length === 1; }).join('\n');
    }
    if ((ss.pmr || []).length > (ds.pmr || []).length) ds.pmr = ss.pmr;
    // Comprobaciones: OR por clave (soporta el formato viejo por posición).
    var scc = ss.comprobaciones;
    if (scc) {
      if (typeof ds.comprobaciones !== 'object' || Array.isArray(ds.comprobaciones)) ds.comprobaciones = {};
      if (Array.isArray(scc)) DEFAULT_COMPROBACIONES.forEach(function (c, i) { if (scc[i]) ds.comprobaciones[c.id] = true; });
      else Object.keys(scc).forEach(function (k) { if (scc[k]) ds.comprobaciones[k] = true; });
    }
    // Incidencias: añadir las que no estén ya (por contenido), no descartar.
    (ss.incidencias || []).forEach(function (inc) {
      var js = JSON.stringify(inc);
      ds.incidencias = ds.incidencias || [];
      if (!ds.incidencias.some(function (x) { return JSON.stringify(x) === js; })) ds.incidencias.push(inc);
    });
    // Telefonemas: igual, añadir los que falten.
    (ss.telefonemas || []).forEach(function (tel) {
      var js2 = JSON.stringify(tel);
      ds.telefonemas = ds.telefonemas || [];
      if (!ds.telefonemas.some(function (x) { return JSON.stringify(x) === js2; })) ds.telefonemas.push(tel);
    });
    (ss.paradas || []).forEach(function (sp) {
      var dp = (ds.paradas || []).find(function (p) { return p.nombre === sp.nombre; });
      if (dp) ['hLleg', 'hora', 'rLleg', 'rSal', 'viajeros', 'asistencias', 'asistentes'].forEach(function (k) {
        if (!dp[k] && sp[k]) dp[k] = sp[k];
      });
    });
  }
  // Vuelca src dentro de dst (turnos que son el mismo). dst se queda.
  function fusionarTurnoEn(dst, src) {
    if (!dst.toma && src.toma) dst.toma = src.toma;
    if (!dst.deje && src.deje) dst.deje = src.deje;
    if (!dst.descanso && src.descanso) dst.descanso = src.descanso;
    if (dst.toma || dst.deje || dst.descanso) dst.turnoHorarioActivo = true;
    if (!dst.horaLTV && src.horaLTV) dst.horaLTV = src.horaLTV;
    // Si alguno estaba cerrado, el turno unido queda cerrado (no "reabrir" solo).
    if (src.estado === 'cerrado') dst.estado = 'cerrado';
    (src.servicios || []).forEach(function (ss) {
      if (isEmptyServicio(ss)) return;
      var ds = (dst.servicios || []).find(function (d) { return mismoServicioLogico(d, ss); });
      if (ds) rellenaHuecosServicio(ds, ss);
      else dst.servicios.push(ss);
    });
  }
  // ¿Son DOS COPIAS del mismo turno (duplicado de sincronización), o dos
  // turnos distintos que el usuario creó a propósito el mismo día?
  // Se consideran el mismo SOLO si las fechas de uno están contenidas en las
  // del otro Y ADEMÁS: uno es _deCache (nunca deliberado), o comparten un
  // servicio real (mismo nº de tren + fecha). Dos turnos del mismo día con
  // trenes distintos = deliberados → NO se juntan.
  function mismoTurnoDuplicado(a, b) {
    if (!(fechasContenidas(a, b) || fechasContenidas(b, a))) return false;
    if (a._deCache || b._deCache) return true;
    return (a.servicios || []).some(function (sa) {
      if (isEmptyServicio(sa)) return false;
      return (b.servicios || []).some(function (sb) {
        return !isEmptyServicio(sb) && mismoServicioLogico(sa, sb);
      });
    });
  }
  // Junta turnos cuyas fechas se solapan (uno contenido en el otro). Gana el
  // que MÁS días abarca (una dormida sobre un turno de un día); a igualdad,
  // el que no sea _deCache y luego el de id menor (determinista entre
  // dispositivos). Devuelve los ids de turnos REALES eliminados (para lápida).
  function dedupeTurnos() {
    var kept = [], fuera = [];
    turnos.slice().sort(function (a, b) {
      return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
    }).forEach(function (t) {
      if (!fechasDe(t).length) { kept.push(t); return; }
      var idx = -1;
      for (var i = 0; i < kept.length; i++) {
        if (mismoTurnoDuplicado(t, kept[i])) { idx = i; break; }
      }
      if (idx === -1) { kept.push(t); return; }
      var k = kept[idx], keep, drop;
      var nt = fechasDe(t).length, nk = fechasDe(k).length;
      if (k._deCache && !t._deCache) { keep = t; drop = k; }        // _deCache nunca gana
      else if (t._deCache && !k._deCache) { keep = k; drop = t; }
      else if (nt > nk) { keep = t; drop = k; }                     // más días (dormida) gana
      else if (nt < nk) { keep = k; drop = t; }
      else { keep = k; drop = t; }                                  // id menor (por el sort)
      fusionarTurnoEn(keep, drop);
      kept[idx] = keep;
      if (!drop._deCache) fuera.push(drop.id);
    });
    if (kept.length !== turnos.length) turnos = kept;
    return fuera;
  }
  // Deduplica y propaga los borrados a la nube (lápidas).
  function dedupeYPropaga() {
    var n0 = turnos.length;
    var fuera = dedupeTurnos();
    if (turnos.length === n0) return 0; // nada que juntar
    save(K_TURNOS, turnos);
    if (window.NUBE && window.NUBE.onTurnoBorrado) {
      fuera.forEach(function (id) { window.NUBE.onTurnoBorrado(id); });
    }
    return n0 - turnos.length;
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
      } else if (t.estado !== 'cerrado' && (t._deCache || isEmptyTurno(t))) {
        // _deCache: turno autorrellenado desde Google Calendar que el
        // usuario nunca llegó a tocar — se descarta igual que uno vacío,
        // aunque tenga datos (vienen de la app, no de él).
        turnos = turnos.filter(function (x) { return x.id !== editId; });
        save(K_TURNOS, turnos);
        editId = null;
      }
      // turno con datos → conservar editId y expandedSvc
    }
  }

  // ===== Navegación / vistas =====
  var lastSetView = '';
  var viewScroll = {};
  function setView(v) {
    // Si salimos del editor de Registro hacia otra vista RV, descartar
    // turno blank si quedó vacío. Esto cubre TODOS los flujos de salida
    // (botón "volver", cambio de tab, sub-nav), incluso los que no
    // pasan por onTabChange de app.js (click en día del calendario).
    if (lastSetView === 'registro' && v !== 'registro') {
      discardEmptyEdit();
    }
    // Recordar la altura de scroll de la vista que dejamos, para volver al
    // mismo sitio (p.ej. registro → telefonemas → registro). openEditor()
    // vuelve a forzar 0 cuando se abre un turno nuevo, así que abrir un turno
    // sí lleva arriba; solo cambiar de pestaña conserva la posición.
    if (lastSetView && lastSetView !== v) viewScroll[lastSetView] = window.scrollY;
    lastSetView = v;
    ['calendario', 'registro', 'telefonemas', 'informe', 'estadisticas', 'ajustes'].forEach(function (p) {
      var el = $(p + '-pane');
      if (el) el.classList.toggle('active', p === v);
    });
    window.scrollTo(0, viewScroll[v] || 0);
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
  // Nº(s) de un servicio para mostrar: "1234" o "1234 / 5678" (traslados
  // Chamartín↔Atocha con dos números). '' si no hay ninguno.
  function svcNumCombo(s) {
    var a = (s.servicioComercial || '').trim();
    var b = (s.servicioComercial2 || '').trim();
    if (a && b) return a + ' / ' + b;
    return a || b || '';
  }
  function renderSvcBlock(s) {
    var esTraslado = !!s.esTraslado;
    var numTxt = svcNumCombo(s) || (esTraslado ? (s.maniobraNombre || 'Traslado') : '');
    var num = numTxt ? '<b>' + esc(numTxt) + '</b>' : '';
    var rd = parseInt(String(s.rLlegDestino || '').replace(/^\+/, ''), 10);
    var ret = (!isNaN(rd) && rd > 0) ? ' <span class="ret">+' + rd + 'm</span>' : '';
    var tag = esTraslado ? '<span class="svc-tag">TRASLADO</span>' :
      (num ? '<span class="svc-tag normal">COMERCIAL</span>' : '');
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

  // En móvil (pantalla estrecha) la rejilla del mes no cabe bien — 7 columnas
  // no dan para mostrar los servicios y se descuadra. Se fuerza la vista lista,
  // que sí queda bien. En tablet/PC se respeta lo que elija el usuario.
  function esMovil() {
    try { return window.matchMedia('(max-width: 620px)').matches; }
    catch (e) { return (window.innerWidth || 999) <= 620; }
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
      (settings.telDevMode ? '<button class="cal-toggle" data-action="gcal-sync-cal" title="Sincronizar Google Calendar (2 días atrás + 7 adelante)">' +
        (gcalChecking ? '⏳' : '🔄') + '</button>' : '') +
      nubeIconoBtn() + nubeInfoBtn() +
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
      if (t0 && t0.estado === 'en_curso') cls += ' en-curso'; // color del punto en móvil
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
        } else {
          // Sin turno creado todavía: si hay algo en la caché de Google
          // Calendar para este día, un aviso discreto (no un bloque de
          // servicio real) — se autorrellena al pulsar "Crear turno".
          var prevista = gcalCacheFind(ds);
          if (prevista) {
            var horarioTxt = (prevista.toma || prevista.deje) ?
              ' ' + esc(prevista.toma || '—') + '-' + esc(prevista.deje || '—') : '';
            h += '<span class="gcal-preview" title="Previsto en Google Calendar, aún no creado">' +
              esc(prevista.codigo) + horarioTxt + '</span>';
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
      nubeIconoBtn() + nubeInfoBtn() +
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
        var num = svcNumCombo(s) || (esTraslado ? (s.maniobraNombre || '—') : '—');
        var hrs = (s.hSalida && s.hDestino) ? (s.hSalida + ' → ' + s.hDestino) : '—';
        var ruta = (s.origen && s.destino) ? ' · ' + s.origen + ' → ' + s.destino : '';
        var rd = parseInt(String(s.rLlegDestino || '').replace(/^\+/, ''), 10);
        var retHtml = (!isNaN(rd) && rd > 0)
          ? ' · <span class="ret">+' + rd + 'm</span>'
          : '';
        var tagHtml = esTraslado ? '<span class="svc-tag">TRASLADO</span> ' : '';
        h += '<div class="lr-svc-line' + (esTraslado ? ' traslado' : ' normal') + '">' +
          tagHtml + '<b>' + (esTraslado ? 'Traslado ' : 'Comercial ') + esc(num) + '</b> · ' + esc(hrs) + esc(ruta) + retHtml +
          '</div>';
      });
      h += '</div>';
      h += '</div>';
    });
    h += '</div>';
    pane.innerHTML = h;
  }

  // Rellena un turno recién creado con lo que ya sabíamos de Google
  // Calendar (caché) — el usuario sigue completando el resto a mano.
  function aplicarCacheATurno(t, prop) {
    // Rellenado por la app, no por el usuario — no se guarda solo (ver
    // save()/discardEmptyEdit). Se confirma en cuanto el usuario toque
    // cualquier campo de este turno.
    t._deCache = true;
    if (prop.toma || prop.deje || prop.descansoMin) {
      t.turnoHorarioActivo = true;
      t.toma = prop.toma || ''; t.deje = prop.deje || '';
      t.descanso = prop.descansoMin ? minToHHMM(prop.descansoMin) : '';
    }
    if (prop.servicios && prop.servicios.length) {
      t.servicios = prop.servicios.map(function (sv) {
        var ns = blankServicio(sv.fecha);
        // Origen/destino/horas/paradas SOLO se rellenan si se ha
        // encontrado el servicio en el Libro de Horarios (mismo efecto que
        // elegirlo a mano en el desplegable "Servicio Comercial") — nunca
        // se copian directamente del texto de Google Calendar, porque los
        // nombres de estación de ahí no siempre casan con el desplegable.
        var hr = sv.guess && sv.guess.hr;
        if (hr) aplicarHorarioAServicio(ns, hr);
        return ns;
      });
    }
  }
  function openDay(ds) {
    var tod = turnosOfDay(ds);
    if (tod.length === 0) {
      var t = blankTurno(ds);
      var cache = gcalCacheFind(ds);
      if (cache) aplicarCacheATurno(t, cache);
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
    // Servicio comercial que no está en el Libro — se rellena a mano.
    h += '<option value="__MANUAL__" data-manual="1"' +
      (s.servicioManual ? ' selected' : '') + '>✎ Crear servicio manual</option>';
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
        var num = svcNumCombo(s) || (esTraslado ? (s.maniobraNombre || '—') : '—');
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
  // Cuántos PMR suben y bajan en una estación del servicio.
  //   ownerIdx: -1 = origen · i>=0 = parada i · null/undefined = destino.
  function pmrEnEstacion(s, nombre, ownerIdx) {
    var suben = 0;
    if (ownerIdx === -1) suben = (s.pmr || []).length;
    else if (typeof ownerIdx === 'number' && ownerIdx >= 0) {
      var pp = s.paradas && s.paradas[ownerIdx];
      suben = (pp && pp.pmr || []).length;
    }
    var bajan = 0, nn = normName(nombre || '');
    if (nn) {
      (s.pmr || []).forEach(function (pr) {
        if (pr.baja && normName(pr.baja) === nn) bajan++;
      });
      (s.paradas || []).forEach(function (pp) {
        (pp.pmr || []).forEach(function (pr) {
          if (pr.baja && normName(pr.baja) === nn) bajan++;
        });
      });
    }
    return { suben: suben, bajan: bajan };
  }
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
    var pm = cfg.pmr, pmTags = '';
    if (pm && pm.bajan) {
      pmTags += ' <span class="pmr-tag baja" title="' + pm.bajan + ' PMR baja' +
        (pm.bajan > 1 ? 'n' : '') + ' aquí">♿↓' + (pm.bajan > 1 ? pm.bajan : '') + '</span>';
    }
    if (pm && pm.suben) {
      pmTags += ' <span class="pmr-tag sube" title="' + pm.suben + ' PMR sube' +
        (pm.suben > 1 ? 'n' : '') + ' aquí">♿↑' + (pm.suben > 1 ? pm.suben : '') + '</span>';
    }
    if ((cfg.parIdx != null && cfg.editable) || cfg.editNombre) {
      var bindNom = cfg.bindNombre || ('srv.' + si + '.par.' + cfg.parIdx + '.nombre');
      h += '<input type="text" class="st-name-input" placeholder="Estación" ' +
        'data-bind="' + bindNom + '" ' +
        'value="' + esc(cfg.nombre || '') + '">' + pmTags;
    } else {
      h += '<span class="st-name">' + esc(cfg.nombre || '—') + pmTags + '</span>';
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
      h += "</div>" + (cfg.esTraslado ?
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
      h += "</div>" + (cfg.esTraslado ?
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
    h += asistentesRow('srv.' + si + '.asistentes', s.asistentes);
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
    h += asistentesRow('srv.' + si + '.par.' + pi + '.asistentes', p.asistentes);
    h += '</div>';
    return h;
  }

  // Fila "Asistentes" — campo numérico opcional por estación, debajo de PMR.
  // Se activa en Ajustes; si esta estación ya tiene un valor, sale igual.
  function asistentesRow(bind, val) {
    if (settings.regAsistentesOculto && !val) return '';
    return '<div class="pax-row"><label>Asistentes</label>' +
      '<input type="number" inputmode="numeric" data-bind="' + bind +
      '" value="' + esc(val) + '"></div>';
  }

  function stationsBlock(s, si) {
    var h = '<div class="stations">';
    var esTraslado = !!s.esTraslado;
    var manual = !!s.servicioManual; // servicio comercial creado a mano
    // Origen
    h += stationCard('origin', si, {
      nombre: manual ? s.origen : (s.origen || '(origen)'),
      editNombre: manual,
      bindNombre: 'srv.' + si + '.origen',
      pmr: esTraslado ? null : pmrEnEstacion(s, s.origen, -1),
      horaSalida: s.hSalida,
      horaLlegada: '',
      editSalida: esTraslado || manual,
      bindHoraSalida: 'srv.' + si + '.hSalida',
      esTraslado: esTraslado,
      manual: manual,
      bindRetSal: 'srv.' + si + '.rSalida',
      valRetSal: s.rSalida,
      pax: esTraslado ? '' : paxBlockOrigen(s, si)
    });
    // Paradas intermedias
    s.paradas.forEach(function (p, pi) {
      var nuevaSinDatos = !p.nombre && !p.hora;
      var hLlegParada = p.hLleg || (p.tParada > 0 ? subMinutos(p.hora, p.tParada) : '');
      h += stationCard('intermediate', si, {
        nombre: p.nombre,
        parIdx: pi,
        editable: nuevaSinDatos,
        editNombre: manual,
        bindNombre: 'srv.' + si + '.par.' + pi + '.nombre',
        pmr: esTraslado ? null : pmrEnEstacion(s, p.nombre, pi),
        horaLlegada: hLlegParada,
        horaSalida: p.hora,
        editLlegada: esTraslado || manual,
        bindHoraLlegada: 'srv.' + si + '.par.' + pi + '.hLleg',
        editSalida: esTraslado || manual || !p.hora,
        bindHoraSalida: 'srv.' + si + '.par.' + pi + '.hora',
        esTraslado: esTraslado,
        manual: manual,
        bindRetLleg: 'srv.' + si + '.par.' + pi + '.rLleg',
        valRetLleg: p.rLleg,
        bindRetSal: 'srv.' + si + '.par.' + pi + '.rSal',
        valRetSal: p.rSal,
        pax: esTraslado ? '' : paxBlockParada(s, p, si, pi)
      });
    });
    // Destino (con mini "+" para añadir parada al final)
    h += stationCard('destination', si, {
      nombre: manual ? s.destino : (s.destino || '(destino)'),
      editNombre: manual,
      bindNombre: 'srv.' + si + '.destino',
      pmr: esTraslado ? null : pmrEnEstacion(s, s.destino, null),
      horaLlegada: s.hDestino,
      horaSalida: '',
      editLlegada: esTraslado || manual,
      bindHoraLlegada: 'srv.' + si + '.hDestino',
      esTraslado: esTraslado,
      manual: manual,
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
    var titulo = svcNumCombo(s) ? esc(svcNumCombo(s)) : String(si + 1);
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
    // Hora LTV: se puede ocultar desde Ajustes. Si este servicio ya la tiene
    // puesta, sigue saliendo para no perderla de vista.
    if (!settings.regLtvOculta || s.horaLTV) {
      h += '<div class="ltv-inline">' +
        '<label>Hora LTV</label>' +
        '<select data-bind="srv.' + si + '.horaLTV">' +
        horaLtvOptions(s.horaLTV) + '</select>' +
        '</div>';
    }
    h += '</div>';

    // Toma/Deje/Descanso ya NO van aquí — están en su propia card al principio
    // del editor (ver renderTurnoHorarioCard). Dato de todo el turno, uno solo.

    // Fecha + Servicio Comercial [+ Nº de traslado, seguido a la derecha
    // del desplegable, en la misma fila — no en una fila aparte].
    h += '<div class="field-grid" style="grid-template-columns:' +
      ((s.esTraslado || s.servicioManual) ? '130px 1fr 110px' : '130px 1fr') + '">' +
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
      // Chamartín↔Atocha: dos números (composición doble). Dos casillas
      // apiladas en la misma columna, cada una a media altura.
      var dosNum = s.maniobraNombre === 'Chamartín - Atocha' ||
        s.maniobraNombre === 'Atocha - Chamartín';
      if (dosNum) {
        h += '<div class="field"><label>Nº</label>' +
          '<div class="svc-man-num-2">' +
          '<input type="text" inputmode="numeric" class="svc-man-num" data-bind="srv.' + si + '.servicioComercial" value="' +
          esc(s.servicioComercial) + '" placeholder="Nº 1">' +
          '<input type="text" inputmode="numeric" class="svc-man-num" data-bind="srv.' + si + '.servicioComercial2" value="' +
          esc(s.servicioComercial2) + '" placeholder="Nº 2">' +
          '</div></div>';
      } else {
        h += '<div class="field"><label>Nº</label>' +
          '<input type="text" inputmode="numeric" class="svc-man-num" data-bind="srv.' + si + '.servicioComercial" value="' +
          esc(s.servicioComercial) + '" placeholder="Número"></div>';
      }
    } else if (s.servicioManual) {
      h += '<div class="field"><label>Nº</label>' +
        '<input type="text" inputmode="numeric" class="svc-man-num" data-bind="srv.' + si + '.servicioComercial" value="' +
        esc(s.servicioComercial) + '" placeholder="Número"></div>';
    }
    h += '</div>';
    if ((s.origen || s.destino) && !s.servicioManual) {
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

    // N1 — escribible en servicios comerciales (normales y manuales), NO en
    // traslados (una maniobra no lleva N1).
    h += '<div class="field"><label class="red">N1</label>' +
      '<input type="text" data-bind="srv.' + si + '.n1" value="' +
      esc(s.n1) + '" placeholder="Nombre"' + (s.esTraslado ? ' disabled' : '') + '></div>';

    // Estaciones (card por estación)
    h += stationsBlock(s, si);

    // Comprobaciones — plegable (abierto por defecto, se pliega solo en
    // cuanto hay hora de salida real; el toggle manual manda siempre que
    // se haya tocado). Estilo plano, mismo patrón que el título del
    // servicio (title-toggle + chev), sin tarjeta ni color propio.
    // Si no queda ninguna comprobación visible (todas ocultas / borradas en
    // Ajustes) y este servicio no tiene ninguna marcada, la sección no sale.
    var listaChk = comprobsParaServicio(s);
    if (listaChk.length) {
      var chkAbierto = comprobacionesOpen(si, s);
      h += '<div class="section-toggle-row">' +
        '<button type="button" class="section-toggle" data-action="comprobaciones-toggle" ' +
        'data-svc="' + si + '">Comprobaciones<span class="chev">' + (chkAbierto ? '▴' : '▾') + '</span></button>' +
        '<button type="button" class="chk-info" data-action="comprobs-info" aria-label="Información">i</button>' +
        '</div>';
      if (chkAbierto) {
        var scMarcas = marcasComprob(s);
        h += '<div class="checks">';
        listaChk.forEach(function (c) {
          h += '<label class="check-item">' +
            '<input type="checkbox" data-bind="srv.' + si + '.chk.' + c.id + '"' +
            (scMarcas[c.id] ? ' checked' : '') + '>' +
            '<span>' + esc(c.label) + '</span></label>';
        });
        h += '</div>';
      }
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
      '<div class="obs-backdrop" data-obs-bd="' + si + '" aria-hidden="true"><div class="obs-bd-inner"></div></div>' +
      '<textarea data-bind="srv.' + si + '.observaciones" data-obs-ta="' + si + '">' + esc(s.observaciones) + '</textarea>' +
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
    // Registro solo ofrece ETC/LZB/LTV para rellenar — el resto de grupos
    // (ABA, ARS, IVC, RET, SOC...) son de solo consulta en la pestaña
    // Telefonemas, no se rellenan desde aquí. Ocultos salvo telDevMode
    // (Ajustes → toca 7 veces "Versión instalada").
    var CATS_REGISTRO = settings.telDevMode ?
      TELEFONEMAS.filter(function (c) {
        return c.cat === 'ETC' || c.cat === 'LZB' || c.cat === 'LTV';
      }) : [];
    if (CATS_REGISTRO.length) {
      h += '<div class="tel-cats">';
      CATS_REGISTRO.forEach(function (c) {
        h += '<button class="btn ghost" data-action="telefonema-cat" data-svc="' + si +
          '" data-cat="' + esc(c.cat) + '">' + esc(c.catCorto || c.catLabel) + '</button>';
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

  // ── Celda "Turno": datos del cuadrante (Google Calendar) para ese día ──
  function cuadranteParaTurno(t) {
    if (!settings.telDevMode) return null;
    var fechas = {};
    (t.servicios || []).forEach(function (s) { if (s.fecha) fechas[s.fecha] = 1; });
    var ks = Object.keys(fechas).sort();
    for (var i = 0; i < ks.length; i++) {
      var c = gcalCacheFind(ks[i]);
      if (c) return c;
    }
    return null;
  }
  function renderCuadranteCell(t) {
    var cache = cuadranteParaTurno(t);
    if (!cache) return '';
    var full = cache.raw ? parseCalendarCompleto(cache.raw) : null;
    var codigo = (full && full.turno) || cache.codigo || '—';
    var horario = (full && full.horario) ||
      ((cache.toma || '?') + '–' + (cache.deje || '?'));
    var h = '<div class="card cuadrante-card' + (cuadranteAbierto ? ' abierta' : '') + '">' +
      '<button type="button" class="cuadrante-head" data-action="cuadrante-toggle">' +
      '<span class="cuadrante-resumen">' + esc(codigo) + ' · ' + esc(horario) + '</span>' +
      '<span class="chev">' + (cuadranteAbierto ? '▴' : '▾') + '</span></button>';
    if (cuadranteAbierto) h += renderCuadranteDetalle(full, cache, t);
    h += '</div>';
    return h;
  }
  function renderCuadranteDetalle(full, cache, t) {
    var h = '<div class="cuadrante-detalle">';
    if (!full) {
      // Caché antigua (sin la descripción completa): se muestra lo que hay.
      h += '<div class="cuad-meta">' +
        '<span>Toma <b>' + esc(cache.toma || '—') + '</b></span>' +
        '<span>Deje <b>' + esc(cache.deje || '—') + '</b></span>' +
        '<span>Descanso <b>' + esc(cache.descansoMin ? fmtDur(cache.descansoMin) : '—') + '</b></span>' +
        '</div>';
      if (cache.servicios && cache.servicios.length) {
        h += '<div class="cuad-tl">';
        cache.servicios.forEach(function (s) {
          h += '<div class="cuad-row t-conduce"><span class="cuad-h">' + esc(s.hSalida || '') + '</span>' +
            '<span class="cuad-t">' + esc(s.origen || '') + ' → ' + esc(s.destino || '') + '</span></div>';
        });
        h += '</div>';
      }
      h += '<div class="hint" style="margin-top:8px">El detalle completo aparece en la próxima sincronización de Google Calendar.</div></div>';
      return h;
    }
    // Cabecera: turno · horario · tiempo de trabajo
    h += '<div class="cuad-meta">' +
      (full.turno ? '<span>Turno <b>' + esc(full.turno) + '</b></span>' : '') +
      (full.horario ? '<span>Horario <b>' + esc(full.horario) + '</b></span>' : '') +
      (full.totalWT ? '<span>Tiempo de trabajo <b>' + esc(full.totalWT) + '</b></span>' : '') +
      '</div>';
    // Chivato: la toma/deje del cuadrante vs lo que hay en el turno.
    // Se compara EN MINUTOS ("8:38" y "08:38" son la misma hora).
    function mismaHora(a, b) {
      var ma = hhmmToMin(a), mb = hhmmToMin(b);
      return ma != null && mb != null && ma === mb;
    }
    var mh = full.horario.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
    var cuadToma = mh ? mh[1] : '', cuadDeje = mh ? mh[2] : '';
    var avisos = [];
    if (cuadToma && t.toma && !mismaHora(cuadToma, t.toma)) avisos.push('La toma del turno (' + t.toma + ') no coincide con el cuadrante (' + cuadToma + ').');
    if (cuadDeje && t.deje && !mismaHora(cuadDeje, t.deje)) avisos.push('El deje del turno (' + t.deje + ') no coincide con el cuadrante (' + cuadDeje + ').');
    if (cuadToma && !t.toma) avisos.push('Falta la toma en el turno (cuadrante: ' + cuadToma + ').');
    if (cuadDeje && !t.deje) avisos.push('Falta el deje en el turno (cuadrante: ' + cuadDeje + ').');
    avisos.forEach(function (a) { h += '<div class="cuad-alerta">⚠️ ' + esc(a) + '</div>'; });
    // Línea de tiempo — todos los tramos del cuadrante, en orden, tal cual.
    h += '<div class="cuad-tl">';
    var prevMin = null;
    full.tramos.forEach(function (tr, idx) {
      var curMin = hhmmToMin(tr.hora);
      if (prevMin != null && curMin != null && curMin < prevMin) {
        h += '<div class="cuad-noche">— noche —</div>';
      }
      prevMin = curMin;
      var ruta = tr.origen ? (esc(tr.origen) + ' → ' + esc(tr.destino)) : esc(tr.lugar || '');
      var extra = '';
      if (tr.k === 'descanso' || tr.k === 'pausa') {
        var sig = full.tramos[idx + 1];
        var dm = sig ? durMin(tr.hora, sig.hora) : null;
        if (dm != null) extra = ' <span class="cuad-dur">≈ ' + fmtDur(dm) + '</span>';
      }
      h += '<div class="cuad-row t-' + tr.k + '">' +
        '<span class="cuad-h">' + esc(tr.hora) + '</span>' +
        '<span class="cuad-t"><b>' + esc(tr.et) + '</b>' + (ruta ? ' · ' + ruta : '') + extra + '</span>' +
        '</div>';
    });
    h += '</div>';
    if (full.extra && full.extra.length) {
      h += '<div class="cuad-sub"><div class="cuad-sub-t">Más</div>' +
        full.extra.map(function (x) { return '<div>' + esc(x) + '</div>'; }).join('') + '</div>';
    }
    if (full.historial && full.historial.length) {
      h += '<div class="cuad-sub"><div class="cuad-sub-t">Cambios de turno (historial)</div>' +
        full.historial.map(function (hh) {
          return '<div>' + esc(hh.codigo) + (hh.horario ? ' · ' + esc(hh.horario) : '') +
            (hh.totalWT ? ' · ' + esc(hh.totalWT) : '') + '</div>';
        }).join('') + '</div>';
    }
    if (full.notas && full.notas.length) {
      h += '<div class="cuad-sub"><div class="cuad-sub-t">Notas personales</div>' +
        full.notas.map(function (n) { return '<div>' + esc(n) + '</div>'; }).join('') + '</div>';
    }
    h += '</div>';
    return h;
  }

  // Un cambio de Ajustes que afecta a lo que se ve en el editor (comprobaciones,
  // sección LTV, celda toma/deje, Asistentes...) debe reflejarse YA en la
  // pestaña Registro, sin tener que reabrir el turno. Se repinta el editor
  // aunque el pane no esté visible (el usuario está en Ajustes); al volver a
  // Registro ya está fresco. No roba el foco ni cambia de vista.
  function refrescarEditorTrasAjuste() {
    if (editId != null && getTurno(editId)) renderEditor();
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
    h += nubeIconoBtn();
    if (t.servicios.length < 5) {
      var ord = ['', '', '2º', '3er', '4º', '5º'][t.servicios.length + 1] || '';
      h += '<button class="btn" data-action="add-servicio">' +
        '+ Añadir ' + ord + ' servicio</button>';
    }
    h += '</div>';

    if (cerrado) {
      h += '<div class="editor-ro-aviso">🔒 Turno cerrado — solo lectura. ' +
        'Pulsa <b>Reabrir turno</b> para editar.</div>';
    }

    // Celda "Turno" — datos del cuadrante (Google Calendar) para ese día,
    // ENCIMA de Toma/Descanso/Deje. Solo si hay datos y en modo desarrollador.
    h += renderCuadranteCell(t);

    // Toma / Deje / Descanso — card propia, un solo dato para todo el turno,
    // entre la barra de arriba y los servicios. Se puede ocultar desde Ajustes;
    // si este turno ya tiene alguno puesto, la card sigue saliendo.
    if (!settings.regHorarioOculto || t.toma || t.deje || t.descanso) {
      h += '<div class="card turno-horario-card">' +
        '<div class="field-grid" style="grid-template-columns:repeat(3,1fr);margin:0">' +
        '<div class="field"><label>Toma</label><input type="time" data-bind="toma" value="' + esc(t.toma) + '"></div>' +
        '<div class="field"><label>Descanso</label><input type="time" data-bind="descanso" value="' + esc(t.descanso) + '"></div>' +
        '<div class="field"><label>Deje</label><input type="time" data-bind="deje" value="' + esc(t.deje) + '"></div>' +
        '</div></div>';
    }

    // Servicios — acordeón: solo expandedSvc abierto.
    if (expandedSvc >= t.servicios.length) expandedSvc = 0;
    h += '<div class="servicios">';
    t.servicios.forEach(function (s, si) {
      if (si === expandedSvc) {
        h += '<div class="card servicio-card" id="svc-card-' + si + '">' +
          servicioInner(t, si) + '</div>';
      } else {
        var num = svcNumCombo(s) ? esc(svcNumCombo(s)) : String(si + 1);
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

    // Turno cerrado: desactivar todos los campos (también teclado / pegar /
    // selectores nativos). Los botones que modifican los filtra onClick.
    if (cerrado) {
      pane.querySelectorAll('input, select, textarea').forEach(function (el) { el.disabled = true; });
      pane.classList.add('editor-ro');
    } else {
      pane.classList.remove('editor-ro');
    }
    pintarObsBackdrop(expandedSvc);
  }

  function refreshServicioCard(si) {
    var t = getTurno(editId);
    var card = $('svc-card-' + si);
    if (t && card) {
      card.innerHTML = servicioInner(t, si);
      if (t.estado === 'cerrado') {
        card.querySelectorAll('input, select, textarea').forEach(function (el) { el.disabled = true; });
      }
      pintarObsBackdrop(si);
    }
  }

  // ¿La línea de Observaciones es el texto de un telefonema? Devuelve su color
  // ('rc' verde / 'maquinista' rosa) o null. Los telefonemas escriben la línea
  // como "<CODIGO> · <hora> — <texto>" (composeObsLineTelefonema).
  function obsLineaColorTelefonema(linea, telefonemas) {
    for (var i = 0; i < (telefonemas || []).length; i++) {
      var c = telefonemas[i].codigo;
      if (c && linea.indexOf(c + ' · ') === 0) return telefonemas[i].color || 'rc';
    }
    return null;
  }
  // Pinta el fondo de color bajo las líneas de telefonema en el textarea de
  // Observaciones del servicio si (el "backdrop" detrás del textarea).
  function pintarObsBackdrop(si) {
    var t = getTurno(editId);
    var s = t && t.servicios[si];
    var bd = document.querySelector('[data-obs-bd="' + si + '"] .obs-bd-inner');
    var ta = document.querySelector('[data-obs-ta="' + si + '"]');
    if (!s || !bd || !ta) return;
    var lineas = (s.observaciones || '').split('\n');
    bd.innerHTML = lineas.map(function (ln) {
      var col = obsLineaColorTelefonema(ln, s.telefonemas);
      var safe = ln ? esc(ln) : ' ';
      return '<div class="obs-bd-line' + (col ? ' obs-hl-' + col : '') + '">' + safe + '</div>';
    }).join('');
    bd.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)';
  }

  function applyBind(bind, value) {
    var t = getTurno(editId);
    if (!t) return;
    if (t.estado === 'cerrado') return; // turno cerrado = solo lectura
    t._deCache = false; // el usuario ha tocado un campo de verdad
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
        if (typeof s.comprobaciones !== 'object' || Array.isArray(s.comprobaciones)) s.comprobaciones = {};
        if (value) s.comprobaciones[p[3]] = true;
        else delete s.comprobaciones[p[3]];
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
      else if (p.t === 'selector') campos[p.id] = (p.opciones || [''])[0];
      else if (p.t === 'opcional') opcionales[p.id] = false;
      else if (p.t === 'campoOpcional') { opcionales[p.id] = false; campos[p.id] = ''; }
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
      if (p.t === 'campo' || p.t === 'selector') return tel.campos[p.id] || '___';
      if (p.t === 'opcional') return tel.opcionales[p.id] ? p.v : '';
      if (p.t === 'campoOpcional') {
        if (p.hueco) return tel.campos[p.id] ? (p.prefijo + tel.campos[p.id]) : '';
        return tel.opcionales[p.id] ? (p.prefijo + (tel.campos[p.id] || '___')) : '';
      }
      return '';
    }).join('').replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
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
            // Pastilla: gris "+ texto" (fuera) → acento "texto" (dentro). Se
            // toca para incluir/quitar. Nada de casilla en medio de la frase.
            var pill = document.createElement('button'); pill.type = 'button';
            pill.className = 'tel-pill';
            var pillTxt = p.pill || p.v || p.label;
            function pintaPill(on) {
              pill.classList.toggle('on', on);
              pill.textContent = on ? pillTxt : '+ ' + pillTxt;
              pill.dataset.on = on ? '1' : '';
            }
            pintaPill(!!tel.opcionales[p.id]);
            pill.addEventListener('click', function () { dirty = true; pintaPill(!pill.dataset.on); });
            campoInputs[p.id] = pill; // se lee por .dataset.on
            sentence.appendChild(pill);
          } else if (p.t === 'selector') {
            // Texto que cambia al tocarlo (rota entre las opciones). Compacto,
            // se ajusta al texto, se ve como un hueco más de la frase.
            var cyc = document.createElement('button'); cyc.type = 'button';
            cyc.className = 'tel-cycle';
            var cOpts = p.opciones && p.opciones.length ? p.opciones : [''];
            var cCur = tel.campos[p.id];
            if (cOpts.indexOf(cCur) === -1) cCur = cOpts[0];
            cyc.textContent = cCur; cyc.dataset.val = cCur;
            cyc.title = 'Tocar para cambiar';
            cyc.addEventListener('click', function () {
              var i = (cOpts.indexOf(cyc.dataset.val) + 1) % cOpts.length;
              cyc.dataset.val = cOpts[i]; cyc.textContent = cOpts[i]; dirty = true;
            });
            campoInputs[p.id] = cyc; // se lee por .dataset.val
            sentence.appendChild(cyc);
          } else if (p.t === 'campoOpcional' && p.hueco) {
            // Estilo "hueco": prefijo en gris + campo siempre visible. Vacío =
            // no sale en el texto. Sin pastilla ni casilla.
            var chPref = document.createElement('span'); chPref.className = 'tel-cop-pref';
            chPref.textContent = p.prefijo;
            var chInp = document.createElement('input'); chInp.type = 'text';
            chInp.placeholder = p.campoHint || '';
            chInp.value = tel.campos[p.id] || '';
            autosizeCh(chInp, (p.campoHint || '').length || 5);
            function pintaChPref() { chPref.classList.toggle('vacio', !chInp.value.trim()); }
            pintaChPref();
            chInp.addEventListener('input', function () { dirty = true; pintaChPref(); });
            campoInputs[p.id] = { txt: chInp };
            sentence.appendChild(chPref);
            sentence.appendChild(chInp);
          } else if (p.t === 'campoOpcional') {
            // Estilo "pastilla" (como "Supone un CSV"): "+ etiqueta" → al
            // activarla, "etiqueta" + el hueco para el valor.
            var copPill = document.createElement('button'); copPill.type = 'button';
            copPill.className = 'tel-pill';
            var copInp = document.createElement('input'); copInp.type = 'text';
            copInp.className = 'tel-cop-inp';
            copInp.placeholder = p.campoHint || '';
            copInp.value = tel.campos[p.id] || '';
            autosizeCh(copInp, (p.campoHint || '').length || 5);
            var copLbl = (p.prefijo || '').trim();
            function pintaCop(on) {
              copPill.classList.toggle('on', on);
              copPill.textContent = on ? copLbl : '+ ' + copLbl;
              copPill.dataset.on = on ? '1' : '';
              copInp.style.display = on ? '' : 'none';
            }
            pintaCop(!!tel.opcionales[p.id]);
            copPill.addEventListener('click', function () {
              var nv = !copPill.dataset.on;
              dirty = true; pintaCop(nv);
              if (nv) copInp.focus();
            });
            copInp.addEventListener('input', function () { dirty = true; });
            campoInputs[p.id] = { pill: copPill, txt: copInp };
            sentence.appendChild(copPill);
            sentence.appendChild(copInp);
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
            else if (p.t === 'selector') tel.campos[p.id] = campoInputs[p.id].dataset.val || '';
            else if (p.t === 'opcional') tel.opcionales[p.id] = !!campoInputs[p.id].dataset.on;
            else if (p.t === 'campoOpcional') {
              tel.campos[p.id] = (campoInputs[p.id].txt.value || '').trim();
              if (!p.hueco) tel.opcionales[p.id] = !!campoInputs[p.id].pill.dataset.on;
            }
          });
          tel.numTel = cNumTel.input.value.trim(); tel.hora = cHora.input.value.trim();
          tel.de = deInp.value.trim(); tel.a = aInp.value.trim();
          tel.info = fInfo.value.trim();
          tel.emisor = cEmisor.input.value.trim(); tel.firma = cFirma.input.value.trim();
          tel.cumplimentado = cbCump.checked; tel.transferido = cbTrans.checked;
          tel.matricula = cMatricula.input.value.trim(); tel.firmaEntrante = cFirmaEntrante.input.value.trim();
          if (variante.viaBanalizada && campoInputs.cond) { tel.viaBanalizada = viaCb.checked; tel.via = viaSel.value; }

          // Observaciones: una línea con el acrónimo, hora, el texto del
          // telefonema y si se ha transferido — se actualiza EN SU SITIO (no
          // se acumula una línea nueva cada vez que se guarda). El resto de
          // Observaciones, incluido lo que se escriba a mano después del
          // telefonema, se conserva tal cual.
          if (s0) {
            var linea = composeObsLineTelefonema(tel, variante);
            var lines = s0.observaciones ? s0.observaciones.split('\n') : [];
            var pref = tel.codigo + ' · ';
            var idx = -1;
            // 1) el índice guardado, si sigue apuntando a una línea de este telefonema
            if (tel.obsLineIdx != null && lines[tel.obsLineIdx] != null &&
                lines[tel.obsLineIdx].indexOf(pref) === 0) {
              idx = tel.obsLineIdx;
            } else {
              // 2) si el usuario metió/quitó líneas por encima, buscar la línea
              //    de este telefonema por su hora (composeObsLineTelefonema)
              var prefHora = tel.codigo + ' · ' + (tel.hora || '') + ' — ';
              for (var li = 0; li < lines.length; li++) {
                if (lines[li].indexOf(prefHora) === 0) { idx = li; break; }
              }
            }
            if (idx >= 0) { lines[idx] = linea; tel.obsLineIdx = idx; }
            else { lines.push(linea); tel.obsLineIdx = lines.length - 1; }
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
    t._deCache = false;
    var s = t.servicios[si];
    var hr = horarios[horarioIdx];
    if (!hr) return;
    s.servicioComercial = hr.servicio;
    s.origen = hr.origen || '';
    s.destino = hr.destino || '';
    s.hSalida = hr.hSalida || '';
    s.hDestino = hr.hDestino || '';
    s.esTraslado = false; s.maniobraNombre = ''; s.servicioManual = false;
    s.paradas = (hr.paradas || []).map(function (p) {
      var tP = typeof p.tParada === 'number' ? p.tParada : 0;
      return {
        nombre: p.nombre,
        hLleg: tP > 0 ? subMinutos(p.hora, tP) : (p.hLleg || ''),
        hora: p.hora,
        tParada: tP,
        rLleg: '', rSal: '',
        viajeros: '', asistencias: '', asistentes: ''
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
    t._deCache = false;
    var s = t.servicios[si];
    var m = maniobras[manIdx];
    if (!m) return;
    s.servicioComercial = '';
    s.esTraslado = true;
    s.servicioManual = false;
    s.maniobraNombre = m.nombre;
    s.origen = m.origen || '';
    s.destino = m.destino || '';
    s.hSalida = ''; s.hDestino = '';
    s.paradas = (m.paradas || []).map(function (p) {
      return {
        nombre: p.nombre, hLleg: '', hora: '', tParada: 0,
        rLleg: '', rSal: '', viajeros: '', asistencias: '', asistentes: ''
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

  // ===== Sincronización con Google Calendar (solo modo desarrollador) =====
  // Lee turnos ya subidos a Google Calendar (extraídos por el usuario de un
  // portal de empresa) y propone completarlos en la app — nunca escribe
  // nada en `turnos` sin pasar por la pantalla de revisión de Ajustes.
  // Formato de evento esperado (descripción de texto plano):
  //   09:00 🔑 Toma
  //         Madrid Puerta de Atocha
  //   09:50 ▸ Train
  //         Madrid Puerta de Atocha → MALAGA M.ZAMB
  //   12:39 🚩 Deje
  //         MALAGA M.ZAMB
  // Dormida: el evento entero cruza de un día a otro (start/end en fechas
  // distintas) — el turno de la empresa mete un "Duty interruption" en vez
  // de "Break" para el descanso en el hotel, y "Passage connection"/
  // "Preparation" para los traslados de/al hotel (se descartan igual que
  // "Travel time", no generan servicio):
  //   15:39 🚩 Deje / Barcelona-Sants
  //   15:54 ▸ Passage connection / Barcelona-Sants → BARCELONA SANTS HOTEL
  //   15:59 ▸ Duty interruption / (descanso real, hasta el siguiente tramo)
  //   05:45 ▸ Passage connection / BARCELONA SANTS HOTEL → Barcelona-Sants
  //   05:50 ▸ Preparation / Barcelona-Sants
  //   06:50 🔑 Toma / Barcelona-Sants
  //   12:54 ▸ Break
  //         MALAGA M.ZAMB
  // "Travel time" (viaja como pasajero) se descarta, no genera servicio.
  // "46 min" por debajo de 1h, "13h 46m" a partir de 1h — a diferencia de
  // fmtDur (que siempre usa formato "Xh Ym"), aquí interesa el minuto
  // suelto para descansos cortos (Break) y horas para los largos (dormida).
  function fmtDescansoMin(min) {
    min = min || 0;
    if (min < 60) return min + ' min';
    return Math.floor(min / 60) + 'h ' + pad2(min % 60) + 'm';
  }
  // Campo "Descanso" del editor (t.descanso) se guarda en HH:MM, igual que
  // Toma/Deje — antes se guardaban minutos sueltos ("826") y una dormida
  // salía ilegible. minToHHMM convierte los minutos que llegan de Calendar;
  // el editor ya trabaja directamente en HH:MM (input type="time").
  function minToHHMM(min) {
    min = Math.round(min || 0);
    return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
  }
  // Igual que minToHHMM pero 0/sin minutos → '' (no "00:00") — así un
  // descanso vacío en Calendar compara igual que un t.descanso vacío en
  // vez de disparar un falso "cambió en Calendar" en cada sincronización.
  function descansoTxt(min) {
    return min ? minToHHMM(min) : '';
  }
  function gcalLoadScript() {
    if (gcalScriptRequested || document.getElementById('gis-script')) return;
    gcalScriptRequested = true;
    var s = document.createElement('script');
    s.id = 'gis-script';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    document.head.appendChild(s);
  }
  function hhmmToMin(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
    return m ? (+m[1] * 60 + +m[2]) : null;
  }
  function siguienteDia(fechaISO) {
    var p = fechaISO.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + 1);
    return ymd(d);
  }
  // fechaInicioISO/fechaFinISO: fecha de inicio y fin del evento (para una
  // dormida son distintas — el evento entero cruza de un día a otro).
  function parseEventoTurno(fechaInicioISO, fechaFinISO, descripcion) {
    var lineas = String(descripcion || '').split('\n')
      .map(function (l) { return l.trim(); }).filter(Boolean);
    var tipoRe = /^(\d{1,2}:\d{2})\D*\b(Toma|Deje|Break|Duty interruption|Train|Travel time|Passage connection|Preparation)\b/i;
    var tramos = [];
    for (var i = 0; i < lineas.length; i++) {
      var m = lineas[i].match(tipoRe);
      if (!m) continue;
      var loc = (lineas[i + 1] && !tipoRe.test(lineas[i + 1])) ? lineas[i + 1] : '';
      tramos.push({ hora: m[1], tipo: m[2].toLowerCase().replace(/\s+/g, ''), loc: loc });
    }
    // Reparte cada tramo en su día real: empieza en fechaInicio, salta al
    // día siguiente cada vez que la hora "retrocede" respecto al tramo
    // anterior (cruce de medianoche) — el texto no trae fecha por línea.
    var fechaActual = fechaInicioISO, horaAnterior = null;
    tramos.forEach(function (tr) {
      if (horaAnterior != null && hhmmToMin(tr.hora) < hhmmToMin(horaAnterior)) {
        fechaActual = siguienteDia(fechaActual);
      }
      tr.fecha = fechaActual;
      horaAnterior = tr.hora;
    });
    var toma = '', deje = '', descansoMin = 0, servicios = [];
    tramos.forEach(function (tr, j) {
      var sig = tramos[j + 1];
      if (tr.tipo === 'toma' && !toma) toma = tr.hora;
      if (tr.tipo === 'deje') deje = tr.hora; // se queda con el último
      // "Break" (parada corta) y "Duty interruption" (descanso de dormida
      // en el hotel) cuentan igual como descanso.
      if ((tr.tipo === 'break' || tr.tipo === 'dutyinterruption') && sig) {
        var dm = durMin(tr.hora, sig.hora);
        if (dm != null) descansoMin += dm;
      }
      if (tr.tipo === 'train') {
        var partes = tr.loc.split('→').map(function (x) { return x.trim(); });
        servicios.push({ fecha: tr.fecha, origen: partes[0] || '', destino: partes[1] || '',
          hSalida: tr.hora, hDestino: sig ? sig.hora : '' });
      }
      // 'traveltime'/'passageconnection'/'preparation' se descartan a
      // propósito — traslados o preparación tipo pasajero, no servicio.
    });
    // "Horario: HH:MM - HH:MM" de la cabecera SIEMPRE está presente (a
    // diferencia de las líneas sueltas "Toma"/"Deje", que en turnos de
    // reserva no aparecen) — manda sobre lo detectado tramo a tramo.
    var mHorario = String(descripcion || '').match(/Horario:\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i);
    if (mHorario) { toma = mHorario[1]; deje = mHorario[2]; }
    return { fechaInicio: fechaInicioISO, fechaFin: fechaFinISO,
      toma: toma, deje: deje, descansoMin: descansoMin, servicios: servicios };
  }

  // ── Lectura COMPLETA de la descripción de Calendar ─────────────────────
  // Para la celda "Turno" del editor: saca TODO tal cual (cabecera, cada
  // tramo de SERVICIOS, historial de cambios y notas personales), sin
  // descartar nada. Nombres de tramo en inglés → español.
  function tramoEsp(txtIngles) {
    var t = String(txtIngles || '').toLowerCase();
    if (/^toma/.test(t)) return { et: 'Toma', k: 'toma' };
    if (/^deje/.test(t)) return { et: 'Deje', k: 'deje' };
    if (/^train\b/.test(t)) return { et: 'Conduciendo', k: 'conduce' };
    if (/^condotta\b/.test(t)) return { et: 'Retraso conducción', k: 'conduce' };
    if (/travel time/.test(t)) return { et: 'De viajero', k: 'viaje' };
    if (/passage connection/.test(t)) return { et: 'Traslado', k: 'enlace' };
    if (/duty interruption/.test(t)) return { et: 'Descanso (dormida)', k: 'descanso' };
    if (/^break/.test(t)) return { et: 'Pausa', k: 'pausa' };
    if (/^reserve/.test(t)) return { et: 'Reserva', k: 'otro' };
    if (/preparation/.test(t)) return { et: 'Preparación', k: 'prep' };
    if (/limpieza|apagado/.test(t)) return { et: 'Limpieza / apagado', k: 'limpieza' };
    return { et: txtIngles, k: 'otro' }; // desconocido: se muestra tal cual
  }
  function parseCalendarCompleto(desc) {
    var lineas = String(desc || '').split('\n');
    var out = { turno: '', horario: '', totalWT: '', tramos: [], historial: [], notas: [], extra: [] };
    var sec = 'cab';           // cab | serv | hist | notas
    var pend = null;           // tramo esperando su línea de ubicación
    var histAct = null;
    for (var i = 0; i < lineas.length; i++) {
      var ln = lineas[i].trim();
      if (!ln) continue;
      if (/^[─—–_=-]{4,}$/.test(ln)) { pend = null; continue; }
      if (/CAMBIO DE TURNO/i.test(ln)) { sec = 'hist'; pend = null; continue; }
      if (/NOTAS PERSONALES/i.test(ln)) { sec = 'notas'; pend = null; continue; }
      if (/^SERVICIOS:?\s*$/i.test(ln)) { sec = 'serv'; pend = null; continue; }
      if (/^===.*===\s*$/.test(ln)) { pend = null; continue; }
      var m;
      if ((m = ln.match(/^Turno:\s*(.+)$/i))) {
        if (sec === 'hist' && histAct) histAct.codigo = m[1].trim();
        else out.turno = m[1].trim();
        pend = null; continue;
      }
      if ((m = ln.match(/^Anterior:\s*(.+)$/i))) {
        histAct = { codigo: m[1].trim(), horario: '', totalWT: '' };
        out.historial.push(histAct); pend = null; continue;
      }
      if ((m = ln.match(/^Horario:\s*(.+)$/i))) {
        if (sec === 'hist' && histAct) histAct.horario = m[1].trim();
        else if (!out.horario) out.horario = m[1].trim();
        pend = null; continue;
      }
      if ((m = ln.match(/^Total\s*WT:\s*(.+)$/i))) {
        if (sec === 'hist' && histAct) histAct.totalWT = m[1].trim();
        else if (!out.totalWT) out.totalWT = m[1].trim();
        pend = null; continue;
      }
      if (sec === 'notas') { out.notas.push(ln); continue; }
      if (sec === 'hist') { continue; }
      // Sección de servicios: "HH:MM <emoji> <Tipo>" o su línea de ubicación
      var mt = ln.match(/^(\d{1,2}:\d{2})\s+(.+)$/);
      if (mt) {
        var tipoRaw = mt[2].replace(/^[^A-Za-zÀ-ÿ0-9]+/, '').trim();
        var esp = tramoEsp(tipoRaw);
        var tr = { hora: mt[1], et: esp.et, k: esp.k, lugar: '', origen: '', destino: '' };
        out.tramos.push(tr); pend = tr; continue;
      }
      if (pend) {
        if (ln.indexOf('→') !== -1 || ln.indexOf('->') !== -1) {
          var pr = ln.split(/→|->/);
          pend.origen = (pr[0] || '').trim(); pend.destino = (pr[1] || '').trim();
        } else {
          pend.lugar = ln;
        }
        pend = null; continue;
      }
      // Línea suelta que no encaja: se guarda para no perder información.
      if (sec === 'cab' || sec === 'serv') out.extra.push(ln);
    }
    return out;
  }
  // Normaliza un nombre de estación para comparar a pesar de que el
  // portal de la empresa y el Libro de Horarios escriban distinto
  // ("Madrid Puerta de Atocha" vs "MADRID-P.ATOCHA-ALMUDENA GRANDES").
  var RE_DIACRITICOS = new RegExp('[̀-ͯ]', 'g'); // marcas combinantes tras normalize('NFD')
  function normalizaEstacion(s) {
    return String(s || '').toUpperCase()
      .normalize('NFD').replace(RE_DIACRITICOS, '')
      .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // Adivina el nº de tren buscando en el Libro de Horarios por
  // origen+destino (primera palabra) + hora de salida aproximada
  // (±20 min). Nunca se aplica sola — siempre se muestra para confirmar.
  function adivinarServicio(origen, destino, hSalida) {
    var oPal = normalizaEstacion(origen).split(' ')[0];
    var dPal = normalizaEstacion(destino).split(' ')[0];
    var hMin = hhmmToMin(hSalida);
    if (!oPal || !dPal || hMin == null) return null;
    var mejor = null, mejorDiff = Infinity;
    horarios.forEach(function (hr) {
      if (normalizaEstacion(hr.origen).split(' ')[0] !== oPal) return;
      if (normalizaEstacion(hr.destino).split(' ')[0] !== dPal) return;
      var hrMin = hhmmToMin(hr.hSalida);
      if (hrMin == null) return;
      var diff = Math.abs(hrMin - hMin);
      if (diff <= 20 && diff < mejorDiff) { mejorDiff = diff; mejor = hr; }
    });
    // Se devuelve también el registro completo del Libro de Horarios (no
    // solo el número) para que aplicarCacheATurno pueda autorrellenar
    // origen/destino/horas/paradas exactamente igual que al elegir el
    // servicio a mano en el desplegable — nunca desde el texto de Calendar.
    return mejor ? { servicio: mejor.servicio, hr: mejor } : null;
  }
  // Busca el registro del Libro de Horarios para un número de servicio ya
  // conocido (p.ej. el que el usuario ha tecleado/corregido a mano en la
  // revisión de sincronización) — un mismo número puede tener ida y vuelta,
  // se desempata por la ruta/hora que trae Calendar. Se usa para que
  // origen/destino/paradas SIEMPRE vengan del Libro de Horarios, nunca del
  // texto de Calendar (mismos motivos que adivinarServicio/aplicarCacheATurno).
  function buscarHorarioPorServicio(servicio, origen, destino, hSalida) {
    if (!servicio) return null;
    var candidatos = horarios.filter(function (h) { return String(h.servicio) === String(servicio); });
    if (!candidatos.length) return null;
    if (candidatos.length === 1) return candidatos[0];
    var oPal = normalizaEstacion(origen).split(' ')[0];
    var dPal = normalizaEstacion(destino).split(' ')[0];
    var hMin = hhmmToMin(hSalida);
    var mejor = candidatos[0], mejorScore = -1;
    candidatos.forEach(function (h) {
      var score = 0;
      if (normalizaEstacion(h.origen).split(' ')[0] === oPal) score += 2;
      if (normalizaEstacion(h.destino).split(' ')[0] === dPal) score += 2;
      if (hMin != null) {
        var hrMin = hhmmToMin(h.hSalida);
        if (hrMin != null && Math.abs(hrMin - hMin) <= 20) score += 1;
      }
      if (score > mejorScore) { mejorScore = score; mejor = h; }
    });
    return mejor;
  }
  // Aplica al servicio los campos del Libro de Horarios (mismos que
  // autofillServicio al elegir a mano) — helper común para
  // aplicarCacheATurno y gcalAplicarPropuestas.
  function aplicarHorarioAServicio(ns, hr) {
    ns.servicioComercial = hr.servicio;
    ns.origen = hr.origen || ''; ns.destino = hr.destino || '';
    ns.hSalida = hr.hSalida || ''; ns.hDestino = hr.hDestino || '';
    ns.paradas = (hr.paradas || []).map(function (p) {
      var tP = typeof p.tParada === 'number' ? p.tParada : 0;
      return {
        nombre: p.nombre,
        hLleg: tP > 0 ? subMinutos(p.hora, tP) : (p.hLleg || ''),
        hora: p.hora, tParada: tP, rLleg: '', rSal: '',
        viajeros: '', asistencias: '', asistentes: ''
      };
    });
  }
  // Origen/destino/hSalida "reales" de un servicio parseado de Calendar —
  // los del Libro de Horarios si se identificó (sv.guess.hr), si no los de
  // Calendar tal cual. Único punto de verdad para "¿este servicio ya está
  // en el turno?", usado tanto para decidir si un día entra en la
  // revisión (gcalProcesarEventos) como al aplicarla (gcalAplicarPropuestas)
  // — antes cada uno comparaba de una forma distinta y no coincidían nunca
  // en sincronizaciones repetidas (ni para detectar que ya estaba, ni para
  // no duplicarlo).
  function svCampos(sv) {
    var hr = sv.guess && sv.guess.hr;
    return {
      origen: hr ? hr.origen : sv.origen,
      destino: hr ? hr.destino : sv.destino,
      hSalida: hr ? hr.hSalida : sv.hSalida
    };
  }
  function servicioCoincide(s, fecha, origen, destino, hSalida) {
    return s.fecha === fecha && s.origen === origen && s.destino === destino && s.hSalida === hSalida;
  }
  function servicioYaExiste(turno, sv) {
    var c = svCampos(sv);
    var num = (sv.guess && sv.guess.servicio) || '';
    return turno.servicios.some(function (s) {
      if (num && s.fecha === sv.fecha &&
          (s.servicioComercial || '').trim() === String(num).trim()) return true;
      return servicioCoincide(s, sv.fecha, c.origen, c.destino, c.hSalida);
    });
  }
  // Pide un token de acceso a Google. interactive=true abre la ventana de
  // consentimiento si hace falta (botón "Vincular con Google" — requiere
  // el toque del usuario, los navegadores bloquean popups sin gesto).
  // interactive=false lo intenta sin abrir nada (chequeo automático al
  // abrir la app) — si no hay sesión ya vigente, resuelve null sin
  // molestar, sin más reintentos.
  // Petición de token en curso, si hay una — google.accounts.oauth2 solo
  // tiene UN callback por cliente; si se pisara con una segunda llamada
  // solapada (doble toque en "Vincular", o el botón 🔄 mientras Ajustes
  // también está sincronizando) la primera promesa se quedaría colgada
  // para siempre. Reutilizar la misma promesa evita eso.
  var gcalTokenEnCurso = null;
  function gcalEnsureToken(interactive) {
    if (gcalTokenEnCurso) return gcalTokenEnCurso;
    gcalTokenEnCurso = new Promise(function (resolve) {
      if (gcalToken) { resolve(gcalToken); return; }
      if (!settings.gcalClientId || !window.google || !google.accounts || !google.accounts.oauth2) {
        resolve(null); return;
      }
      if (!gcalTokenClient) {
        gcalTokenClient = google.accounts.oauth2.initTokenClient({
          client_id: settings.gcalClientId, scope: GCAL_SCOPE, callback: function () {}
        });
      }
      gcalTokenClient.callback = function (resp) {
        gcalToken = (resp && resp.access_token) || null;
        // Guarda el token con su caducidad real (expires_in, en segundos —
        // Google suele dar ~3600) para no pedir nada de nuevo si la app se
        // reabre dentro de esa hora. Margen de 60s por seguridad.
        if (gcalToken) {
          var vidaSeg = (resp && resp.expires_in) || 3600;
          save(K_GCAL_TOKEN, { token: gcalToken, exp: Date.now() + (vidaSeg - 60) * 1000 });
        } else {
          save(K_GCAL_TOKEN, null);
        }
        resolve(gcalToken);
      };
      // Sin esto, si Google no puede completar el login (el usuario cierra
      // la ventana, el navegador bloquea el popup, red caída...) `callback`
      // nunca se llama y la promesa se queda colgada para siempre —
      // bloqueando además cualquier vinculación futura por el guard de
      // gcalTokenEnCurso de arriba.
      gcalTokenClient.error_callback = function (err) {
        gcalUltimoError = 'Google no completó el inicio de sesión' +
          ((err && err.type) ? (' (' + err.type + ')') : '') + '.';
        resolve(null);
      };
      try {
        // interactive (botón "Vincular con Google"): fuerza el selector de
        // cuentas de Google con prompt: 'select_account' — sin esto, en un
        // dispositivo con una cuenta ya conectada (p.ej. la de la tablet)
        // Google reutiliza esa sesión directamente y nunca deja elegir
        // otra cuenta. El chequeo automático en segundo plano sigue sin
        // prompt para no molestar si no hay sesión ya vigente.
        gcalTokenClient.requestAccessToken(interactive ? { prompt: 'select_account' } : { prompt: '' });
      } catch (e) { resolve(null); }
    }).then(function (tok) { gcalTokenEnCurso = null; return tok; });
    return gcalTokenEnCurso;
  }
  var gcalUltimoError = null; // texto del último fallo real (auth/HTTP/red), para mostrarlo en vez de tragárselo
  // Desfase horario local en formato "+02:00" — sin esto, Google interpreta
  // timeMin/timeMax como UTC y el rango de fechas se desplaza.
  function offsetLocal() {
    var min = -new Date().getTimezoneOffset();
    var signo = min >= 0 ? '+' : '-';
    min = Math.abs(min);
    return signo + pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
  }
  function gcalFetchEventos(desdeISO, hastaISO) {
    if (!gcalToken) return Promise.reject(new Error('Sin token de Google.'));
    var calId = encodeURIComponent(settings.gcalCalendarId || 'primary');
    var off = offsetLocal();
    var base = 'https://www.googleapis.com/calendar/v3/calendars/' + calId + '/events' +
      '?timeMin=' + encodeURIComponent(desdeISO + 'T00:00:00' + off) +
      '&timeMax=' + encodeURIComponent(hastaISO + 'T23:59:59' + off) +
      '&singleEvents=true&orderBy=startTime&maxResults=2500';
    var todos = [];
    // Google devuelve como mucho 2500 eventos por página. Rangos amplios
    // (varias semanas/meses) los parte en varias — hay que seguir el
    // nextPageToken o se pierden los del final del rango.
    function pagina(pageToken) {
      var url = base + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
      return fetch(url, { headers: { Authorization: 'Bearer ' + gcalToken } })
        .then(function (r) {
          if (r.ok) return r.json();
          if (r.status === 401) { gcalToken = null; save(K_GCAL_TOKEN, null); }
          return r.text().then(function (body) {
            throw new Error('HTTP ' + r.status + ': ' + body.slice(0, 300));
          });
        })
        .then(function (data) {
          (data.items || []).forEach(function (it) { todos.push(it); });
          if (data.nextPageToken) return pagina(data.nextPageToken);
        });
    }
    return pagina(null).then(function () { return todos; });
  }
  // Compara cada evento con lo que ya hay guardado ese día — nunca decide
  // sobrescribir, solo detecta huecos y (para "ayer") posibles cambios de
  // horario ya guardado con valor distinto.
  // Busca en la caché por fecha de inicio directa, o como segundo día de
  // una dormida guardada bajo su fecha de inicio.
  function gcalCacheFind(fecha) {
    if (gcalCache[fecha]) return gcalCache[fecha];
    var k = Object.keys(gcalCache).find(function (key) { return gcalCache[key].fechaFin === fecha; });
    return k ? gcalCache[k] : null;
  }
  // Por cada evento: SIEMPRE se guarda en la caché (para autorrellenar al
  // crear el turno, ver openDay). Si ese día YA tiene un turno creado,
  // ADEMÁS entra en la lista de revisión (huecos / aviso de cambio) — los
  // días sin turno no aparecen ahí, no hay nada que "aplicar" para ellos.
  function gcalProcesarEventos(eventos) {
    var props = [];
    eventos.forEach(function (ev) {
      var fechaInicio = (ev.start && (ev.start.date || (ev.start.dateTime || '').slice(0, 10))) || '';
      if (!fechaInicio) return;
      var fechaFin = (ev.end && (ev.end.date || (ev.end.dateTime || '').slice(0, 10))) || fechaInicio;
      var parsed = parseEventoTurno(fechaInicio, fechaFin, ev.description || '');
      parsed.servicios.forEach(function (sv) {
        sv.guess = adivinarServicio(sv.origen, sv.destino, sv.hSalida);
      });
      var codigo = (ev.summary || '').replace(/^\*\s*/, '');
      gcalCache[fechaInicio] = { codigo: codigo, fechaFin: fechaFin, toma: parsed.toma,
        deje: parsed.deje, descansoMin: parsed.descansoMin, servicios: parsed.servicios,
        raw: (ev.description || '') };

      // Dormida: el turno guardado puede estar indexado por cualquiera de
      // los dos días — se busca en ambos.
      var existente = turnosOfDay(fechaInicio)[0] || turnosOfDay(fechaFin)[0] || null;
      if (!existente) return; // sin turno creado → solo caché, no hay nada que revisar
      var prop = {
        fecha: fechaInicio, fechaFin: fechaFin, codigo: codigo,
        toma: parsed.toma, deje: parsed.deje, descansoMin: parsed.descansoMin,
        servicios: parsed.servicios, existente: existente, cambioHorario: null
      };
      if (existente.turnoHorarioActivo && (existente.toma || existente.deje || existente.descanso)) {
        var distinto = existente.toma !== parsed.toma || existente.deje !== parsed.deje ||
          String(existente.descanso || '') !== descansoTxt(parsed.descansoMin);
        if (distinto) {
          prop.cambioHorario = {
            tomaGuardado: existente.toma, dejeGuardado: existente.deje, descansoGuardado: existente.descanso,
            tomaNuevo: parsed.toma, dejeNuevo: parsed.deje, descansoNuevoMin: parsed.descansoMin
          };
        }
      }
      // Solo entra en la revisión si de verdad hay algo que hacer — antes
      // se metía SIEMPRE que hubiera turno + evento, así que un día ya
      // completado del todo seguía saliendo como pendiente en cada
      // sincronización sin parar.
      // Lista EXACTA de lo que falta por completar en el turno (para la
      // revisión de Ajustes — que el usuario vea qué va a rellenar).
      var faltan = [];
      if (!existente.toma && parsed.toma) faltan.push('Toma: ' + parsed.toma);
      if (!existente.deje && parsed.deje) faltan.push('Deje: ' + parsed.deje);
      if (!existente.descanso && parsed.descansoMin) faltan.push('Descanso: ' + fmtDescansoMin(parsed.descansoMin));
      parsed.servicios.forEach(function (sv) {
        if (servicioYaExiste(existente, sv)) return;
        var num = (sv.guess && sv.guess.servicio) || '?';
        faltan.push('Servicio ' + num + ': ' + prettyEstacion(sv.origen) + ' → ' +
          prettyEstacion(sv.destino) + (sv.hSalida ? ' (' + sv.hSalida + ')' : ''));
      });
      prop.faltan = faltan;
      var mWT = String(ev.description || '').match(/Total\s*WT:\s*([\d:]+)/i);
      prop.totalWT = mWT ? mWT[1] : '';
      var faltaHorario = (!existente.toma && parsed.toma) || (!existente.deje && parsed.deje) ||
        (!existente.descanso && parsed.descansoMin);
      var faltaServicio = parsed.servicios.some(function (sv) { return !servicioYaExiste(existente, sv); });
      if (!faltaHorario && !faltaServicio && !prop.cambioHorario) return;
      props.push(prop);
    });
    save(K_GCAL_CACHE, gcalCache);
    return props;
  }
  function gcalEjecutarChequeo(desde, hasta, interactive) {
    gcalChecking = true;
    gcalUltimoError = null;
    return gcalEnsureToken(interactive).then(function (token) {
      if (!token) {
        gcalChecking = false; gcalPropuestas = null;
        // Si error_callback (gcalEnsureToken) ya dejó un motivo concreto,
        // no lo taparlo con este genérico.
        if (!gcalUltimoError) gcalUltimoError = 'No se obtuvo token de Google (revisa el Client ID o vincula de nuevo).';
        return null;
      }
      return gcalFetchEventos(desde, hasta).then(function (eventos) {
        gcalPropuestas = gcalProcesarEventos(eventos);
        gcalChecking = false;
        return { eventos: eventos.length, revision: gcalPropuestas.length };
      });
    }).catch(function (err) {
      gcalChecking = false; gcalPropuestas = null;
      gcalUltimoError = (err && err.message) || String(err);
      return null;
    });
  }
  // Aplica lo confirmado en pantalla — lee el DOM (checkboxes/inputs ya
  // editados por el usuario), nunca sobrescribe un campo que ya tenía
  // valor, solo completa huecos o crea turno si el día estaba vacío.
  function gcalAplicarPropuestas() {
    if (!gcalPropuestas) return;
    var cambios = 0;
    gcalPropuestas.forEach(function (prop, gi) {
      var incluirEl = document.querySelector('[data-gcal-incluir][data-gi="' + gi + '"]');
      if (!incluirEl || !incluirEl.checked) return;
      var actualizarEl = document.querySelector('[data-gcal-actualizar][data-gi="' + gi + '"]');
      var actualizarCambio = !!(actualizarEl && actualizarEl.checked);
      var numeros = Array.prototype.map.call(
        document.querySelectorAll('.gcal-num[data-gi="' + gi + '"]'),
        function (el) { return el.value.trim(); }
      );
      // Todas las filas que llegan aquí tienen `existente` garantizado
      // (gcalProcesarEventos no mete en la revisión un día sin turno) —
      // solo se completan huecos, nunca se crea un turno nuevo desde aquí.
      var t = prop.existente;
      // Por si acaso: si t fuera un turno recién autorrellenado y aún sin
      // confirmar (_deCache, ver aplicarCacheATurno), aplicar la revisión
      // es una acción explícita del usuario — cuenta como real, o si no
      // discardEmptyEdit lo borraría igualmente al salir del editor.
      t._deCache = false;
      var huboCambio = false;
      if (!t.toma && prop.toma) { t.toma = prop.toma; huboCambio = true; }
      if (!t.deje && prop.deje) { t.deje = prop.deje; huboCambio = true; }
      if (!t.descanso && prop.descansoMin) { t.descanso = minToHHMM(prop.descansoMin); huboCambio = true; }
      if (t.toma || t.deje || t.descanso) t.turnoHorarioActivo = true;
      prop.servicios.forEach(function (sv, si) {
        // Mismo criterio que aplicarCacheATurno: origen/destino/horas/
        // paradas SOLO del Libro de Horarios, nunca del texto de
        // Calendar — se busca por el nº de tren (el que haya en el
        // campo, editado o no) para respetar la corrección manual del
        // usuario si cambió el número que se había adivinado.
        var numTren = numeros[si] || (sv.guess && sv.guess.servicio) || '';
        var hr = buscarHorarioPorServicio(numTren, sv.origen, sv.destino, sv.hSalida);
        // "¿Ya está?" se compara contra lo que se ACABARÍA guardando (el
        // origen/destino/hSalida oficiales), no contra el texto en bruto
        // de Calendar — si no, cada vez que se vuelve a sincronizar el
        // mismo día no reconoce el servicio ya añadido (nunca coincide
        // con el texto de Calendar) y mete un duplicado nuevo.
        var origenCmp = hr ? hr.origen : sv.origen;
        var destinoCmp = hr ? hr.destino : sv.destino;
        var hSalidaCmp = hr ? hr.hSalida : sv.hSalida;
        var yaHay = t.servicios.some(function (s) {
          // Clave estable primero: mismo nº de tren + fecha = mismo servicio,
          // aunque el origen/destino guardado (p.ej. venido de otro aparato por
          // la nube) no sea idéntico carácter a carácter al del Libro de ahora.
          if (numTren && s.fecha === sv.fecha &&
              (s.servicioComercial || '').trim() === String(numTren).trim()) return true;
          return servicioCoincide(s, sv.fecha, origenCmp, destinoCmp, hSalidaCmp);
        });
        if (!yaHay) {
          var ns = blankServicio(sv.fecha);
          if (hr) aplicarHorarioAServicio(ns, hr);
          else ns.servicioComercial = numTren;
          t.servicios.push(ns);
          huboCambio = true;
        }
      });
      if (actualizarCambio && prop.cambioHorario) {
        t.toma = prop.cambioHorario.tomaNuevo;
        t.deje = prop.cambioHorario.dejeNuevo;
        t.descanso = descansoTxt(prop.cambioHorario.descansoNuevoMin);
        huboCambio = true;
      }
      if (huboCambio) cambios++;
    });
    gcalPropuestas = null;
    if (cambios) { save(K_TURNOS, turnos); renderCalendar(); }
    renderSettings();
    if (gcalModalResolve) { gcalModalResolve(null); gcalModalResolve = null; }
    appModal.alert({ title: 'Sincronización aplicada', message: cambios + ' turno(s) actualizados.' });
  }
  function renderGcalPropuestasHtml() {
    if (!gcalPropuestas.length) {
      var nCache = Object.keys(gcalCache).length;
      return '<div class="hint" style="margin-top:10px">Nada que completar en ese rango' +
        (nCache ? ' — ' + nCache + ' turno(s) guardados en caché para cuando los crees.' : '.') + '</div>';
    }
    var h = '<div class="stat-list" style="margin-top:12px">';
    gcalPropuestas.forEach(function (prop, gi) {
      var esDormida = prop.fecha !== prop.fechaFin;
      var fechaLabel = esDormida ? (esc(ymdNice(prop.fecha)) + ' → ' + esc(ymdNice(prop.fechaFin))) : esc(ymdNice(prop.fecha));
      h += '<div class="card" style="background:var(--panel-2)">';
      h += '<div class="card-title" style="display:flex;align-items:center;gap:8px">' +
        '<span style="flex:1">' + fechaLabel + ' · ' + esc(prop.codigo) + (esDormida ? ' · Dormida' : '') + '</span>' +
        '<label class="gcal-check-sm">' +
        '<input type="checkbox" data-gcal-incluir data-gi="' + gi + '" checked>' +
        'Completar huecos</label></div>';
      h += '<div class="hint">Cuadrante: Toma ' + esc(prop.toma || '—') + ' · Deje ' + esc(prop.deje || '—') +
        ' · Descanso ' + fmtDescansoMin(prop.descansoMin) +
        (prop.totalWT ? ' · Tiempo de trabajo ' + esc(prop.totalWT) : '') + '</div>';
      if (prop.faltan && prop.faltan.length) {
        h += '<div class="hint" style="color:var(--warn);margin-top:4px">Falta por completar en el turno:</div>' +
          '<ul class="gcal-faltan">' +
          prop.faltan.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') +
          '</ul>';
      }
      h += '<div class="hint">Solo se rellenarán los campos vacíos — nunca se pisa lo que ya tienes.</div>';
      prop.servicios.forEach(function (sv, si) {
        h += '<div class="field-grid" style="grid-template-columns:1fr 1fr 90px;margin-top:6px">' +
          '<div class="field"><label>Origen' + (esDormida ? ' (' + esc(ymdNice(sv.fecha)) + ')' : '') + '</label><div class="hint" style="margin:0">' + esc(prettyEstacion(sv.origen)) + '</div></div>' +
          '<div class="field"><label>Destino</label><div class="hint" style="margin:0">' + esc(prettyEstacion(sv.destino)) + '</div></div>' +
          '<div class="field"><label>Nº tren</label><input type="text" class="gcal-num" data-gi="' + gi + '" data-si="' + si + '" value="' +
          esc((sv.guess && sv.guess.servicio) || '') + '"></div>' +
          '</div>';
      });
      if (prop.cambioHorario) {
        h += '<div class="hint" style="color:var(--warn);margin-top:6px">⚠ Cambió en Google Calendar — Toma ' +
          esc(prop.cambioHorario.tomaGuardado || '—') + ' → ' + esc(prop.cambioHorario.tomaNuevo || '—') + ', Deje ' +
          esc(prop.cambioHorario.dejeGuardado || '—') + ' → ' + esc(prop.cambioHorario.dejeNuevo || '—') + ', Descanso ' +
          esc(prop.cambioHorario.descansoGuardado || '—') + ' → ' + fmtDescansoMin(prop.cambioHorario.descansoNuevoMin) + '</div>';
        h += '<label class="gcal-check-sm" style="margin-top:4px">' +
          '<input type="checkbox" data-gcal-actualizar data-gi="' + gi + '"> Actualizar estos 3 campos</label>';
      }
      h += '</div>';
    });
    h += '</div>';
    h += '<div class="btn-row" style="margin-top:10px">' +
      '<button class="btn primary" data-action="gcal-aplicar">Aplicar</button>' +
      '<button class="btn ghost" data-action="gcal-descartar">Descartar</button></div>';
    return h;
  }
  // Modal de revisión lanzado desde el botón 🔄 del Calendario — reusa
  // renderGcalPropuestasHtml() tal cual (los data-action de sus botones
  // ya están delegados globalmente, funcionan igual dentro del modal).
  function abrirRevisionGcalModal() {
    appModal.custom({
      className: 'wide',
      backdropClose: true,
      dismissValue: null,
      render: function (box, resolveWith) {
        gcalModalResolve = resolveWith;
        box.innerHTML = '<div class="modal-title">Revisar turnos de Google Calendar</div>' +
          renderGcalPropuestasHtml() +
          '<div class="btn-row" style="margin-top:10px">' +
          '<button class="btn ghost" data-action="gcal-modal-cerrar">Cerrar</button></div>';
      }
    }).then(function () {
      // Se cierre como se cierre (Cerrar, Aplicar, backdrop o ESC) — evita
      // dejar una referencia colgada que resuelva un modal distinto que
      // esté abierto más tarde (appModal.resolveWith es un singleton).
      gcalModalResolve = null;
    });
  }
  function nubeHaceX(ts) {
    if (!ts) return 'nunca';
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'hace un momento';
    if (s < 3600) return 'hace ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.floor(s / 3600) + ' h';
    return 'hace ' + Math.floor(s / 86400) + ' días';
  }
  function renderNubeCard() {
    if (!window.NUBE || !window.NUBE.disponible()) return '';
    var h = '<div class="card"><div class="card-title">Copia en la nube (OneDrive)</div>';
    if (!window.NUBE.estaVinculada()) {
      h += '<div class="hint">Guarda una copia de tus turnos en tu OneDrive y ten los mismos datos en el móvil y la tablet. Solo la primera vez hay que dar permiso.</div>' +
        '<div class="btn-row"><button class="btn primary" data-action="nube-vincular">Vincular con Microsoft</button></div>';
      h += '</div>';
      return h;
    }
    h += '<div class="hint">Vinculada como <b>' + esc(window.NUBE.correo()) + '</b>.<br>' +
      'Última copia: ' + esc(nubeHaceX(window.NUBE.ultimaCopia())) + '.';
    var okAt = window.NUBE.ultimoSyncOk ? window.NUBE.ultimoSyncOk() : 0;
    if (okAt) h += '<br>Sincronización completa verificada: ' + esc(nubeHaceX(okAt)) + '.';
    if (window.NUBE.estado() === 'error' && !window.NUBE.necesitaReconectar()) {
      h += '<br><span style="color:var(--warn)">La última sincronización no se completó del todo ' +
        '(cobertura). Nada se ha estropeado; se reintenta sola o toca «Sincronizar ahora».</span>';
    }
    h += '</div>';
    if (window.NUBE.necesitaReconectar()) {
      h += '<div class="hint" style="color:var(--warn)">La sesión de Microsoft ha caducado. Un toque y sigue.</div>' +
        '<div class="btn-row"><button class="btn primary" data-action="nube-reconectar">Reconectar</button></div>';
    } else {
      h += '<div class="btn-row"><button class="btn primary" data-action="nube-sync">' +
        (window.NUBE.sincronizando() ? 'Sincronizando…' : 'Sincronizar ahora') + '</button></div>';
    }
    h += '<div class="btn-row"><button class="btn ghost" data-action="nube-desvincular">Desvincular</button>' +
      '<button class="btn danger" data-action="nube-borrar">Borrar mis datos de la nube</button></div>';
    h += '</div>';
    return h;
  }

  function renderGcalCard() {
    var h = '<div class="card"><div class="card-title">Sincronizar Google Calendar</div>';
    h += '<div class="hint" style="margin-bottom:8px">Experimental — si el día ya tiene turno creado, propone completar huecos aquí (nunca sobrescribe). Si no lo tiene, solo se guarda para cuando lo crees en Calendario (botón 🔄).</div>';
    h += '<div class="field"><label>Client ID de Google</label>' +
      '<input type="text" id="set-gcal-client" value="' + esc(settings.gcalClientId) + '" placeholder="xxxx.apps.googleusercontent.com"></div>';
    h += '<div class="field"><label>ID de calendario</label>' +
      '<input type="text" id="set-gcal-cal" value="' + esc(settings.gcalCalendarId) + '" placeholder="primary"></div>';
    h += '<div class="btn-row" style="margin:0 0 10px"><button class="btn" data-action="gcal-guardar-config">Guardar configuración</button></div>';
    if (!settings.gcalClientId) {
      h += '<div class="hint">Pega el Client ID de tu proyecto OAuth para activar esto.</div></div>';
      return h;
    }
    h += '<div class="btn-row"><button class="btn primary" data-action="gcal-vincular">' +
      (gcalToken ? 'Volver a vincular' : 'Vincular con Google') + '</button></div>';
    var desdeDefault = gcalRangoDesde || ymd(new Date(Date.now() - 2 * 86400000));
    var hastaDefault = gcalRangoHasta || ymd(new Date(Date.now() + 7 * 86400000));
    h += '<div class="field-grid" style="margin-top:10px">' +
      '<div class="field"><label>Desde</label><input type="date" id="gcal-desde" value="' + desdeDefault + '"></div>' +
      '<div class="field"><label>Hasta</label><input type="date" id="gcal-hasta" value="' + hastaDefault + '"></div>' +
      '</div>';
    h += '<div class="btn-row"><button class="btn primary" data-action="gcal-sincronizar">' +
      (gcalChecking ? 'Comprobando…' : 'Sincronizar ahora') + '</button></div>';
    if (gcalPropuestas) h += renderGcalPropuestasHtml();
    h += '</div>';
    return h;
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

    // 3b. Editar el registro — plegable (cerrado por defecto, ocupa mucho
    // abierto). Qué secciones se ven en el editor del turno + comprobaciones.
    var _cl = comprobsLista();
    h += '<div class="card"><button type="button" class="section-toggle" style="margin:0" ' +
      'data-action="set-comprobs-toggle">Editar el registro ' +
      '<span class="chev">' + (setComprobsOpen ? '▴' : '▾') + '</span></button>' +
      '<div class="hint" style="margin:8px 0 0">Qué se ve en el editor del turno. ' +
      'Ocultar no borra nada: si un turno ya tiene el dato, la sección sigue saliendo en él.</div>';
    if (setComprobsOpen) {
    h += '<div class="comprob-editor" style="margin-top:10px">' +
      '<div class="comprob-row">' +
      '<label class="comprob-vis" title="Se muestra en el editor">' +
      '<input type="checkbox" data-reg-vis="ltv"' + (settings.regLtvOculta ? '' : ' checked') + '></label>' +
      '<span class="comprob-label" style="border:0;padding-left:2px">Hora LTV en cada servicio</span>' +
      '</div>' +
      '<div class="comprob-row">' +
      '<label class="comprob-vis" title="Se muestra en el editor">' +
      '<input type="checkbox" data-reg-vis="horario"' + (settings.regHorarioOculto ? '' : ' checked') + '></label>' +
      '<span class="comprob-label" style="border:0;padding-left:2px">Celda Toma / Descanso / Deje</span>' +
      '</div>' +
      '<div class="comprob-row">' +
      '<label class="comprob-vis" title="Se muestra en el editor">' +
      '<input type="checkbox" data-reg-vis="asistentes"' + (settings.regAsistentesOculto ? '' : ' checked') + '></label>' +
      '<span class="comprob-label" style="border:0;padding-left:2px">Asistentes (por estación, debajo de PMR)</span>' +
      '</div></div>';
    h += '<div class="hint" style="font-weight:600;margin:14px 0 0">Comprobaciones ' +
      '<span style="font-weight:400">(' + _cl.length + ')</span></div>' +
      '<div class="hint" style="margin:4px 0 0">La checklist del editor. Apaga el interruptor para ocultar ' +
      'una sin borrarla; las de fábrica solo se pueden ocultar.</div>';
    h += '<div class="comprob-editor" style="margin-top:10px">';
    _cl.forEach(function (c, i) {
      var fab = esComprobFabrica(c.id);
      h += '<div class="comprob-row' + (c.oculta ? ' oculta' : '') + '">' +
        '<label class="comprob-vis" title="' + (c.oculta ? 'Oculta' : 'Se muestra en el editor') + '">' +
        '<input type="checkbox" data-comprob-vis data-i="' + i + '"' + (c.oculta ? '' : ' checked') + '></label>' +
        '<input type="text" class="comprob-label" data-comprob-label data-i="' + i +
        '" value="' + esc(c.label) + '" placeholder="Nombre de la comprobación">' +
        '<button class="comprob-mv" data-action="comprob-mov" data-i="' + i + '" data-d="-1" ' +
        'aria-label="Subir"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
        '<button class="comprob-mv" data-action="comprob-mov" data-i="' + i + '" data-d="1" ' +
        'aria-label="Bajar"' + (i === _cl.length - 1 ? ' disabled' : '') + '>▼</button>' +
        (fab
          ? '<span class="comprob-mv comprob-slot" aria-hidden="true"></span>'
          : '<button class="comprob-mv comprob-del" data-action="comprob-del" data-i="' + i + '" aria-label="Borrar">✕</button>') +
        '</div>';
    });
    h += '</div>' +
      '<div class="btn-row" style="margin-top:10px">' +
      '<button class="btn" data-action="comprob-add">+ Añadir comprobación</button>' +
      '<button class="btn ghost" data-action="reset-comprobs">Restaurar de fábrica</button></div>';
    }
    h += '</div>';

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

    // 7b. Copia en la nube (OneDrive) — para todos los usuarios
    h += renderNubeCard();

    // 7c. Sincronizar Google Calendar (solo modo desarrollador)
    if (settings.telDevMode) h += renderGcalCard();

    // 7d. Tema (claro / oscuro / automático por hora)
    h += '<div class="card"><div class="card-title">Tema</div>' +
      '<label class="check-item" style="margin-bottom:8px">' +
      '<input type="checkbox" data-action="theme-auto-toggle"' + (settings.themeAuto ? ' checked' : '') + '>' +
      '<span>Cambio automático claro / oscuro por hora</span></label>';
    if (settings.themeAuto) {
      h += '<div class="field-grid" style="margin:0">' +
        '<div class="field"><label>Claro desde</label>' +
        '<input type="time" id="set-theme-claro" value="' + esc(settings.themeAutoClaro) + '"></div>' +
        '<div class="field"><label>Oscuro desde</label>' +
        '<input type="time" id="set-theme-oscuro" value="' + esc(settings.themeAutoOscuro) + '"></div>' +
        '</div>' +
        '<div class="hint" style="margin-top:6px">Ahora mismo tocaría el modo <b>' +
        (temaSegunHora() === 'light' ? 'claro' : 'oscuro') + '</b>.</div>';
    } else {
      h += '<div class="hint">Manual — usa el botón 🌙/☀️ de la barra superior. ' +
        'Recomendado para el automático: claro 08:00, oscuro 20:00.</div>';
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
      '<div class="btn-row" style="margin-top:8px">' +
      '<button class="btn ghost" data-action="ver-guia">Ver la guía de inicio</button>' +
      '</div>' +
      '</div>';

    // 9. Borrar todo
    h += '<div class="card"><div class="card-title">Borrar todo</div>' +
      '<div class="btn-row" style="margin:0"><button class="btn danger" data-action="wipe">Borrar todos los datos</button></div></div>';

    h += '<div class="hint" style="text-align:center;margin-top:8px">Datos guardados solo en esta tablet</div>';
    pane.innerHTML = h;
  }

  // Tema que toca AHORA según la hora y los dos umbrales de Ajustes.
  function temaSegunHora() {
    var now = new Date();
    var m = now.getHours() * 60 + now.getMinutes();
    var claro = hhmmToMin(settings.themeAutoClaro) ;
    var oscuro = hhmmToMin(settings.themeAutoOscuro);
    if (claro == null) claro = 8 * 60;
    if (oscuro == null) oscuro = 20 * 60;
    if (claro < oscuro) return (m >= claro && m < oscuro) ? 'light' : 'dark';
    return (m >= claro || m < oscuro) ? 'light' : 'dark'; // por si se invierten
  }
  function applyTheme() {
    var t = settings.themeAuto ? temaSegunHora() : settings.theme;
    document.body.classList.toggle('light', t === 'light');
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
      line('Servicio Comercial: ' + (svcNumCombo(s) || (s.esTraslado ? (s.maniobraNombre || '—') : '—')) +
        (s.origen ? '  (' + s.origen + ' → ' + s.destino + ')' : ''), { size: 10 });
      line('Vía: ' + (s.via || '—') + '     Rama: ' + (s.rama || '—'), { size: 10 });
      line('N1: ' + (s.n1 || '—'), { size: 10 });

      // Origen
      checkPage();
      line('Origen ' + (s.origen || '—') + '   Sal: ' + (s.hSalida || '—') +
        (s.rSalida ? '  [ret. ' + s.rSalida + ' min]' : ''),
        { bold: true, size: 10, color: [21, 128, 61] });
      if (s.viajeros || s.asistencias || s.asistentes || (s.pmr && s.pmr.length)) {
        line('  Viajeros ' + (s.viajeros || '0') +
             '  Asist ' + (s.asistencias || '0') +
             '  PMR ' + ((s.pmr && s.pmr.length) || '0') +
             (s.asistentes ? '  Asistentes ' + s.asistentes : ''),
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
        if (p.viajeros || p.asistencias || p.asistentes) {
          line('  Viajeros ' + (p.viajeros || '0') +
               '  Asist ' + (p.asistencias || '0') +
               (p.asistentes ? '  Asistentes ' + p.asistentes : ''),
            { size: 8, x: M + 3, gap: 1, color: [110, 110, 110] });
        }
      });

      // Destino
      checkPage();
      line('Destino ' + (s.destino || '—') + '   Lleg: ' + (s.hDestino || '—') +
        (s.rLlegDestino ? '  [ret. ' + s.rLlegDestino + ' min]' : ''),
        { bold: true, size: 10, color: [185, 28, 28] });

      var listaChkPdf = comprobsParaServicio(s);
      if (listaChkPdf.length) {
        checkPage();
        line('Comprobaciones:', { bold: true, size: 10 });
        var scPdf = marcasComprob(s);
        listaChkPdf.forEach(function (c) {
          checkPage();
          line((scPdf[c.id] ? '[X] ' : '[  ] ') + c.label, { size: 9, x: M + 3, gap: 1 });
        });
        state.y += 1.5;
      }
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
          (s.asistentes ? '<span><b>Asistentes</b>' + esc(s.asistentes) + '</span>' : '') +
          '<span><b>PMR</b>' + pmrCount +
          (pmrCount ? ' <span style="color:#666;font-size:11px">(' + esc(pmrDestinos) + ')</span>' : '') + '</span>' +
          '</div>';

        if (s.paradas && s.paradas.length) {
          var colAsist = s.paradas.some(function (p) { return p.asistentes; });
          body += '<table><thead><tr>' +
            '<th>Parada</th><th>H. Lleg</th><th>Ret. lleg</th><th>H. Sal</th><th>Ret. sal</th>' +
            '<th>Viajeros</th><th>Asist.</th>' + (colAsist ? '<th>Asistentes</th>' : '') +
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
              (colAsist ? '<td>' + esc(p.asistentes || '0') + '</td>' : '') +
              '</tr>';
          });
          body += '</tbody></table>';
        }

        var scHtml = marcasComprob(s);
        var listaChkHtml = comprobsParaServicio(s);
        if (listaChkHtml.length) {
          body += '<div class="chk">';
          listaChkHtml.forEach(function (c) {
            var ok = scHtml[c.id];
            body += '<span class="' + (ok ? 'ok' : 'no') + '">' +
              (ok ? '✓ ' : '☐ ') + esc(c.label) + '</span>';
          });
          body += '</div>';
        }

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
          title: 'Importar copia',
          message: 'La copia tiene ' + d.turnos.length + ' turnos. Ahora mismo tienes ' + turnos.length + '.\n\n' +
            '· COMBINAR: añade los turnos de la copia que te falten y recupera los que estén vacíos. No borra ni pisa lo que ya tienes bien. (Recomendado)\n' +
            '· SUSTITUIR: borra TODO lo actual y deja solo lo de la copia.',
          buttons: [
            { label: 'Combinar', value: 'merge', kind: 'primary' },
            { label: 'Sustituir', value: 'replace', kind: 'danger' },
            { label: 'Cancelar', value: 'cancel', kind: 'neutral' }
          ],
          dismissValue: 'cancel'
        }).then(function (modo) {
          if (modo === 'cancel') return;
          if (modo === 'replace') {
            turnos = d.turnos.map(normTurno);
            if (d.settings) {
              settings = d.settings;
              if (!settings.ramas || !settings.ramas.length) settings.ramas = DEFAULT_RAMAS.slice();
              if (!settings.theme) settings.theme = 'dark';
            }
            save(K_TURNOS, turnos);
            saveSettings();
            applyTheme();
            appModal.alert({ title: 'Copia restaurada', message: turnos.length + ' turnos.' });
            renderSettings();
            return;
          }
          // COMBINAR: añade lo que falta, recupera lo vacío, nunca pisa datos.
          var nuevos = 0, recuperados = 0;
          d.turnos.forEach(function (bt) {
            if (!bt || !bt.id) return;
            var lt = getTurno(bt.id);
            var nt = normTurno(JSON.parse(JSON.stringify(bt)));
            if (!lt) { turnos.push(nt); nuevos++; }
            else if (isEmptyTurno(lt) && !isEmptyTurno(nt)) { turnos[turnos.indexOf(lt)] = nt; recuperados++; }
            else if (nServiciosConDatos(nt) > nServiciosConDatos(lt)) { turnos[turnos.indexOf(lt)] = nt; recuperados++; }
          });
          save(K_TURNOS, turnos);
          renderSettings();
          renderCalendar();
          appModal.alert({
            title: 'Copia combinada',
            message: nuevos + ' turnos añadidos · ' + recuperados + ' recuperados. ' +
              'Nada de lo que ya tenías bien se ha tocado.'
          });
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
    // Turno cerrado: no se toca nada del editor (los campos van disabled, esto
    // es la red por si algo se cuela — atajos, dictado, etc.).
    if (editorBloqueado() && el.closest && el.closest('#registro-pane')) return;
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
    // Observaciones: repintar el fondo de color de las líneas de telefonema.
    var mObs = bind.match(/^srv\.(\d+)\.observaciones$/);
    if (mObs) pintarObsBackdrop(+mObs[1]);
  }
  function onChange(e) {
    var el = e.target;
    if (editorBloqueado() && el.closest && el.closest('#registro-pane')) return;
    // Ajustes → editor de comprobaciones: renombrar / ocultar, guardado en vivo.
    if (el.getAttribute && el.getAttribute('data-comprob-label') != null) {
      var clL = comprobsLista(), cli = +el.getAttribute('data-i');
      if (!clL[cli]) return;
      var nv = el.value.trim();
      if (!nv) { renderSettings(); return; }   // vacío: se descarta el cambio
      clL[cli].label = nv;
      settings.comprobaciones = clL;
      saveSettings();
      refrescarEditorTrasAjuste();
      return;
    }
    if (el.getAttribute && el.getAttribute('data-comprob-vis') != null) {
      var cvL = comprobsLista(), cvi = +el.getAttribute('data-i');
      if (!cvL[cvi]) return;
      cvL[cvi].oculta = !el.checked;
      settings.comprobaciones = cvL;
      saveSettings(); renderSettings();
      refrescarEditorTrasAjuste();
      return;
    }
    // Ajustes → "Editar el registro": ocultar/mostrar secciones del editor.
    if (el.getAttribute && el.getAttribute('data-reg-vis') != null) {
      var rvK = { ltv: 'regLtvOculta', horario: 'regHorarioOculto', asistentes: 'regAsistentesOculto' }[el.getAttribute('data-reg-vis')];
      if (!rvK) return;
      settings[rvK] = !el.checked;
      saveSettings();
      refrescarEditorTrasAjuste();
      return;
    }
    if (el.classList && el.classList.contains('srv-sel')) {
      var si = +el.getAttribute('data-svc');
      var opt = el.selectedOptions && el.selectedOptions[0];
      var t = getTurno(editId);
      var s = t ? t.servicios[si] : null;
      // Aviso si hay servicio activo y aún en trayecto (evita cambios involuntarios).
      function doAutofillSrv() {
        if (opt && opt.getAttribute('data-manual') != null) {
          if (t && s) {
            s.servicioManual = true;
            s.esTraslado = false; s.maniobraNombre = '';
            s.servicioComercial = ''; // el <select> mete "__MANUAL__" por el evento input — se limpia aquí
            autosave();
            refreshServicioCard(si);
          }
        } else if (opt && opt.getAttribute('data-idx') != null) {
          autofillServicio(si, +opt.getAttribute('data-idx'));
        } else if (opt && opt.getAttribute('data-man') != null) {
          autofillManiobra(si, +opt.getAttribute('data-man'));
        } else if (t && s) {
          s.servicioComercial = ''; s.origen = ''; s.destino = '';
          s.esTraslado = false; s.maniobraNombre = ''; s.servicioManual = false;
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

  // Turno cerrado = SOLO LECTURA. Hay que pulsar "Reabrir turno" para editar.
  function editorBloqueado() {
    var t = editId != null ? getTurno(editId) : null;
    return !!(t && t.estado === 'cerrado');
  }
  var ACCIONES_RO = /^(volver|reabrir|borrar|svc-toggle|cuadrante-toggle|comprobaciones-toggle|comprobs-info|nube-icono|nube-privacidad|telefonema-abrir)$/;

  function onClick(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var act = el.getAttribute('data-action');
    var t = getTurno(editId);

    // Con el turno cerrado, en el editor solo se permiten acciones de ver /
    // navegar / reabrir / borrar. Todo lo que modifica, ignorado.
    if (editorBloqueado() && el.closest('#registro-pane') && !ACCIONES_RO.test(act)) return;

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
    if (act === 'cuadrante-toggle') {
      cuadranteAbierto = !cuadranteAbierto;
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
        // Lápida para la nube: que el borrado se propague a los demás
        // dispositivos y no reaparezca al sincronizar.
        if (window.NUBE && window.NUBE.onTurnoBorrado) window.NUBE.onTurnoBorrado(t.id);
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
    if (act === 'comprobs-info') {
      appModal.alert({
        title: 'Comprobaciones',
        message: 'Esta lista se edita desde Ajustes → «Editar las comprobaciones»: ' +
          'puedes añadir, quitar, ocultar o reordenar. Si ocultas o quitas todas, ' +
          'esta sección no aparece.'
      });
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
    if (act === 'ver-guia') { mostrarBienvenida(false, true); return; }
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
      // Un toque manual manda: desactiva el modo automático.
      settings.themeAuto = false;
      settings.theme = (document.body.classList.contains('light')) ? 'dark' : 'light';
      saveSettings(); applyTheme();
      if (lastSetView === 'ajustes') renderSettings();
      return;
    }
    if (act === 'theme-auto-toggle') {
      settings.themeAuto = !settings.themeAuto;
      if (!settings.themeAuto) {
        // Al apagar el automático, se queda con el tema que hay puesto ahora.
        settings.theme = document.body.classList.contains('light') ? 'light' : 'dark';
      }
      saveSettings(); applyTheme(); renderSettings();
      return;
    }
    if (act === 'save-datos-personales') {
      settings.telefono = $('set-tel').value.trim();
      settings.nombre = $('set-nombre').value.trim();
      settings.apellidos = $('set-apellidos').value.trim();
      settings.idEmpleado = $('set-id-empleado').value.trim();
      saveSettings(); flashSaved(); refrescarEditorTrasAjuste(); return;
    }
    if (act === 'save-ramas') {
      var arr = $('set-ramas').value.split('\n').map(function (x) { return x.trim(); })
        .filter(Boolean);
      settings.ramas = arr.length ? arr : DEFAULT_RAMAS.slice();
      saveSettings(); flashSaved(); renderSettings(); refrescarEditorTrasAjuste(); return;
    }
    // Editor de comprobaciones (Ajustes) — cada acción guarda en el momento.
    // Cada fila lleva su id estable, así renombrar no descuadra los turnos.
    if (act === 'comprob-mov') {
      var cmL = comprobsLista().slice();
      var cmi = +el.getAttribute('data-i'), cmj = cmi + (+el.getAttribute('data-d'));
      if (cmj < 0 || cmj >= cmL.length) return;
      var cmTmp = cmL[cmi]; cmL[cmi] = cmL[cmj]; cmL[cmj] = cmTmp;
      settings.comprobaciones = cmL;
      saveSettings(); renderSettings();
      refrescarEditorTrasAjuste();
      return;
    }
    if (act === 'comprob-del') {
      var cdL = comprobsLista(), cdi = +el.getAttribute('data-i'), victim = cdL[cdi];
      if (!victim || esComprobFabrica(victim.id)) return;
      appModal.confirm({
        title: 'Borrar comprobación',
        message: '¿Quitar «' + victim.label + '» de la lista? Las marcas que ya tengan los turnos guardados no se borran.',
        buttons: [{ label: 'Cancelar', value: false, kind: 'neutral' }, { label: 'Borrar', value: true, kind: 'danger' }]
      }).then(function (ok) {
        if (!ok) return;
        settings.comprobaciones = comprobsLista().filter(function (_, j) { return j !== cdi; });
        saveSettings(); renderSettings();
        refrescarEditorTrasAjuste();
      });
      return;
    }
    if (act === 'set-comprobs-toggle') { setComprobsOpen = !setComprobsOpen; renderSettings(); return; }
    if (act === 'comprob-add') {
      var caL = comprobsLista().slice();
      caL.push({ id: slugComprob('comprob', caL), label: 'Nueva comprobación', oculta: false });
      settings.comprobaciones = caL;
      saveSettings(); renderSettings(); refrescarEditorTrasAjuste();
      var caInp = $('ajustes-pane').querySelectorAll('.comprob-label');
      if (caInp.length) { var last = caInp[caInp.length - 1]; last.focus(); last.select(); }
      return;
    }
    if (act === 'reset-comprobs') {
      appModal.confirm({
        title: 'Restaurar comprobaciones',
        message: 'Vuelve a la lista de fábrica (13). Las marcas de los turnos ya guardados no se tocan.',
        buttons: [{ label: 'Cancelar', value: false, kind: 'neutral' }, { label: 'Restaurar', value: true, kind: 'primary' }]
      }).then(function (ok) {
        if (!ok) return;
        settings.comprobaciones = DEFAULT_COMPROBACIONES.map(function (c) { return { id: c.id, label: c.label }; });
        saveSettings(); flashSaved(); renderSettings();
        refrescarEditorTrasAjuste();
      });
      return;
    }
    if (act === 'gcal-sync-cal') {
      gcalLoadScript();
      gcalChecking = true;
      renderCalendar();
      var desdeCal = ymd(new Date(Date.now() - 2 * 86400000));
      var hastaCal = ymd(new Date(Date.now() + 7 * 86400000));
      gcalRangoDesde = desdeCal; gcalRangoHasta = hastaCal;
      gcalEjecutarChequeo(desdeCal, hastaCal, true).then(function (result) {
        renderCalendar();
        if (!result) {
          appModal.alert({ title: 'No se pudo sincronizar', message: gcalUltimoError || 'Revisa la vinculación con Google.' });
        } else if (gcalPropuestas && gcalPropuestas.length) {
          abrirRevisionGcalModal();
        } else {
          appModal.alert({ title: 'Calendario actualizado', message: 'Sin turnos ya creados que completar en ese rango.' });
        }
      });
      return;
    }
    if (act === 'gcal-modal-cerrar') {
      if (gcalModalResolve) { gcalModalResolve(null); gcalModalResolve = null; }
      return;
    }
    if (act === 'gcal-guardar-config') {
      settings.gcalClientId = $('set-gcal-client').value.trim();
      settings.gcalCalendarId = $('set-gcal-cal').value.trim() || 'primary';
      gcalToken = null; save(K_GCAL_TOKEN, null); // cambiar de proyecto invalida el token anterior
      // gcalTokenClient se crea UNA vez (initTokenClient) con el Client ID
      // que hubiera en ese momento — sin esto, cambiar el ID aquí y guardar
      // seguía usando por debajo el cliente viejo (invalid_client) hasta
      // recargar la app entera.
      gcalTokenClient = null;
      saveSettings(); flashSaved(); renderSettings();
      return;
    }
    if (act === 'gcal-vincular') {
      gcalLoadScript();
      gcalToken = null; save(K_GCAL_TOKEN, null); // fuerza pedir cuenta de nuevo, sin quedarse el token viejo si la recarga interrumpe justo aquí
      gcalUltimoError = null;
      gcalEnsureToken(true).then(function (token) {
        renderSettings();
        if (!token) {
          appModal.alert({ title: 'No se pudo vincular', message: gcalUltimoError || 'Revisa el Client ID de Google en Ajustes o inténtalo de nuevo.' });
        }
      });
      return;
    }
    if (act === 'gcal-sincronizar') {
      var gcalDesdeEl = $('gcal-desde'), gcalHastaEl = $('gcal-hasta');
      gcalRangoDesde = gcalDesdeEl ? gcalDesdeEl.value : gcalRangoDesde;
      gcalRangoHasta = gcalHastaEl ? gcalHastaEl.value : gcalRangoHasta;
      gcalChecking = true;
      renderSettings();
      gcalEjecutarChequeo(gcalRangoDesde, gcalRangoHasta, true).then(function (result) {
        renderSettings();
        if (!result) {
          appModal.alert({ title: 'No se pudo sincronizar', message: gcalUltimoError || 'Revisa la vinculación con Google o inténtalo de nuevo.' });
        }
      });
      return;
    }
    if (act === 'gcal-descartar') { gcalPropuestas = null; renderSettings(); return; }
    if (act === 'gcal-aplicar') { gcalAplicarPropuestas(); return; }
    if (act === 'export-backup') { exportBackup(); return; }
    if (act === 'import-backup') { $('file-backup').click(); return; }
    if (act === 'nube-vincular') { window.NUBE && window.NUBE.vincular(); return; }
    if (act === 'nube-privacidad') { maybeNubePrivacidad(true); return; }
    if (act === 'nube-reconectar') { window.NUBE && window.NUBE.reconectar(); return; }
    if (act === 'nube-icono') {
      if (!window.NUBE) return;
      var est = window.NUBE.estado();
      if (est === 'sin') { window.NUBE.vincular(); return; }
      if (est === 'reconectar') { window.NUBE.reconectar(); return; }
      if (est === 'sync') return; // ya está subiendo
      // ok / error → forzar subida ahora
      window.NUBE.sincronizarAhora().then(function () {
        nubeReRender();
        if (lastSetView === 'ajustes') renderSettings();
        flashSaved();
      });
      nubeReRender(); // pinta el ⏳ al instante
      return;
    }
    if (act === 'nube-sync') {
      if (window.NUBE) window.NUBE.sincronizarAhora().then(function () {
        if (lastSetView === 'ajustes') renderSettings();
        flashSaved();
      });
      renderSettings();
      return;
    }
    if (act === 'nube-desvincular') {
      appModal.confirm({
        title: 'Desvincular la nube',
        message: 'Dejará de sincronizarse. NO se borra nada de tu OneDrive ni de la app.',
        buttons: [
          { label: 'Cancelar', value: false, kind: 'neutral' },
          { label: 'Desvincular', value: true, kind: 'danger' }
        ]
      }).then(function (ok) {
        if (ok && window.NUBE) { window.NUBE.desvincular(); renderSettings(); }
      });
      return;
    }
    if (act === 'nube-borrar') {
      appModal.confirm({
        title: 'Borrar mis datos de la nube',
        message: 'Se borrarán todos los archivos de turnos de la carpeta «EnRuta» de tu OneDrive.\n\n' +
          'Sigues vinculado y tus turnos de esta tablet NO se tocan: la carpeta se quedará vacía hasta que edites un turno o pulses «Sincronizar ahora».\n\n' +
          'Para dejar de sincronizar del todo, usa «Desvincular».',
        buttons: [
          { label: 'Cancelar', value: false, kind: 'neutral' },
          { label: 'Borrar de la nube', value: true, kind: 'danger' }
        ]
      }).then(function (ok) {
        if (!ok || !window.NUBE) return;
        window.NUBE.borrarDatosNube().then(function () {
          renderSettings();
          appModal.alert({ title: 'Hecho', message: 'Datos de la nube borrados.' });
        });
      });
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
    // Juntar turnos duplicados del mismo día (creados a la vez en dos
    // aparatos antes de sincronizar) — deja el de id menor y propaga la
    // lápida del otro a la nube. Corre antes de NUBE.init().
    dedupeYPropaga();

    var now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();

    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('click', onClick);
    // El fondo de color de Observaciones (telefonemas) sigue el scroll del textarea.
    document.addEventListener('scroll', function (e) {
      var el = e.target;
      if (el && el.getAttribute && el.getAttribute('data-obs-ta') != null) {
        var bd = document.querySelector('[data-obs-bd="' + el.getAttribute('data-obs-ta') + '"] .obs-bd-inner');
        if (bd) bd.style.transform = 'translateY(' + (-el.scrollTop) + 'px)';
      }
    }, true);

    // Guardar la última edición ANTES de que el navegador pueda matar la
    // página (cambio a segundo plano, cierre, recarga del Service Worker).
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushAutosave();
      else if (settings.themeAuto) applyTheme(); // al volver, recalcular el tema
    });
    window.addEventListener('pagehide', flushAutosave);
    window.addEventListener('beforeunload', flushAutosave);
    // Modo tema automático: revisar la hora cada minuto.
    setInterval(function () { if (settings.themeAuto) applyTheme(); }, 60000);

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

    // Observaciones a mano: cada línea empieza con "• ", igual que los atajos.
    // - Al pulsar Enter se mete "\n• " para que se vea al momento.
    // - Al salir del campo (blur) se normalizan todas las líneas.
    function esObsTextarea(el) {
      return el && el.tagName === 'TEXTAREA' &&
        /^srv\.\d+\.observaciones$/.test(el.getAttribute('data-bind') || '');
    }
    function bulletearObs(txt) {
      return String(txt || '').split('\n').map(function (ln) {
        // Línea de telefonema ("ETC1 · 10:00 — ...") — se deja INTACTA: ni
        // viñeta ni mayúscula, para no romper su detección ni su color.
        if (/^[A-Z]{2,5}\d{0,2} · /.test(ln)) return ln;
        var t = ln.replace(/^\s*[•·*\-]\s*/, '').trim();
        if (!t) return '';
        // Primera letra en mayúscula (ortografía).
        return '• ' + t.charAt(0).toUpperCase() + t.slice(1);
      }).join('\n');
    }
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey || !esObsTextarea(e.target)) return;
      e.preventDefault();
      var ta = e.target, a = ta.selectionStart, b = ta.selectionEnd;
      ta.value = ta.value.slice(0, a) + '\n• ' + ta.value.slice(b);
      ta.selectionStart = ta.selectionEnd = a + 3;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.addEventListener('blur', function (e) {
      if (!esObsTextarea(e.target)) return;
      var ta = e.target, nv = bulletearObs(ta.value);
      if (nv !== ta.value) {
        ta.value = nv;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, true);
    // Al escribir la PRIMERA línea de Observaciones (campo vacío), que salga
    // con "• " al momento, igual que las siguientes (Enter ya mete "\n• ").
    document.addEventListener('input', function (e) {
      var ta = e.target;
      if (!esObsTextarea(ta) || !ta.value) return;
      var nl = ta.value.indexOf('\n');
      var primera = nl === -1 ? ta.value : ta.value.slice(0, nl);
      if (!primera.trim()) return;
      if (primera.indexOf('•') !== -1) return;                  // ya hay viñeta en esa línea
      if (/^[A-Z]{2,5}\d{0,2} · /.test(primera)) return;        // línea de telefonema
      var sel = ta.selectionStart;
      ta.value = '• ' + ta.value;
      ta.selectionStart = ta.selectionEnd = (sel || 0) + 2;
      ta.dispatchEvent(new Event('input', { bubbles: true }));  // que applyBind y el fondo se enteren
    });
    // Nombres de estación escritos a mano (servicio manual / parada nueva) →
    // a MAYÚSCULAS, como el resto de la app.
    document.addEventListener('blur', function (e) {
      var el = e.target;
      if (!el.classList || !el.classList.contains('st-name-input')) return;
      var up = (el.value || '').toUpperCase();
      if (up !== el.value) {
        el.value = up;
        el.dispatchEvent(new Event('input', { bubbles: true }));
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
      if (e.target.id === 'set-theme-claro' || e.target.id === 'set-theme-oscuro') {
        settings.themeAutoClaro = $('set-theme-claro').value || '08:00';
        settings.themeAutoOscuro = $('set-theme-oscuro').value || '20:00';
        saveSettings(); applyTheme(); flashSaved();
      }
    });

    renderCalendar();
    setView('calendario');

    // Limpieza: se quitó el guardado local en archivos (File System Access).
    // Borrar su IndexedDB huérfana de quien ya tenía la app.
    try { if (window.indexedDB) indexedDB.deleteDatabase('rviryo_folder_v1'); } catch (e) {}

    // Ventana de inicio: carrusel completo el primer arranque (hasta marcar
    // «no volver a mostrar»); solo la página de novedades al actualizar a una
    // versión nueva. Va antes del aviso de la nube (que se salta si esto sale).
    if (!settings.bienvenidaVista) {
      bienvenidaMostradaEsteArranque = true;
      setTimeout(function () { mostrarBienvenida(false, false); }, 500);
    } else if (settings.bienvenidaVersion !== APP_VERSION) {
      bienvenidaMostradaEsteArranque = true;
      setTimeout(function () { mostrarBienvenida(true, false); }, 500);
    }

    // Copia en la nube (OneDrive): arranca MSAL, procesa la vuelta del login
    // por redirect y, si ya hay sesión, sincroniza. Si no está configurada
    // (sin CLIENT_ID) o msal-browser.min.js no cargó, no hace nada.
    if (window.NUBE) {
      window.NUBE.init();
      setTimeout(maybeFirstRunNubePrompt, 1200);
      // Si ya está vinculada pero el aviso de privacidad no llegó a verse
      // (p.ej. el SW recargó la app justo al volver del login), mostrarlo ahora.
      setTimeout(maybeNubePrivacidad, 1800);
    }

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(function () {});
    }

    // Google Calendar (solo modo desarrollador): chequeo automático al
    // abrir la app, pero SOLO si ya hay un token guardado (ver loadAll)
    // que siga vigente — nunca se llama a requestAccessToken() sin un
    // toque real del usuario, porque abre su propio popup incluso con
    // prompt:'' y sin gesto el navegador lo bloquea (o lo muestra igual,
    // pareciendo que "pide verificar la cuenta" cada vez que se abre la
    // app). Si el token guardado ya caducó, no se intenta nada solo —
    // toca vincular a mano (🔄 del Calendario / Ajustes), pero no en cada
    // apertura, solo cuando pasa la hora de validez del token.
    if (settings.telDevMode && settings.gcalClientId) {
      gcalLoadScript();
      if (gcalToken) {
        setTimeout(function () {
          gcalRangoDesde = ymd(new Date(Date.now() - 2 * 86400000));
          gcalRangoHasta = ymd(new Date(Date.now() + 7 * 86400000));
          gcalEjecutarChequeo(gcalRangoDesde, gcalRangoHasta, false).then(function (result) {
            if (!result) return;
            if (lastSetView === 'ajustes') renderSettings();
            else if (lastSetView === 'calendario') renderCalendar();
          });
        }, 1500);
      }
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
    discardEmptyEdit: discardEmptyEdit,
    // Contrato para nube.js (copia en OneDrive). Ver bloque "Copia en la nube".
    nube: {
      diaJSON: nubeDiaJSON,
      canon: nubeCanon,
      diaTurnos: nubeDiaTurnosReales,
      fechas: nubeFechasConTurnos,
      aplicarDia: nubeAplicarDia,
      borrarIds: nubeBorrarIds,
      dedupe: dedupeYPropaga,
      configParaSubir: nubeConfigParaSubir,
      aplicarConfig: nubeAplicarConfig,
      gcalGet: function () { return gcalCache; },
      // MERGE, nunca reemplazo: se añaden/actualizan días del cuadrante que
      // vengan de otro aparato, pero NUNCA se borra lo que ya hay aquí (un
      // aparato sin login de Google no puede vaciar la caché del que sí).
      gcalSet: function (obj) {
        if (!obj || typeof obj !== 'object') return;
        var n = 0;
        Object.keys(obj).forEach(function (f) {
          if (obj[f] && typeof obj[f] === 'object') { gcalCache[f] = obj[f]; n++; }
        });
        if (!n) return;
        save(K_GCAL_CACHE, gcalCache);
        if (lastSetView === 'registro' && editId != null) nubeReRender();
        else if (lastSetView === 'calendario') renderCalendar();
      },
      reRender: nubeReRender,
      trasVincular: nubeTrasVincular,
      pintarBanner: function () { nubeReRender(); },
      pintarAjustes: function () { if (lastSetView === 'ajustes') renderSettings(); else nubeReRender(); },
      aviso: function (msg) { appModal.alert({ title: 'Copia en la nube', message: msg }); }
    }
  };
  // Fuente de verdad del catálogo, leída (no duplicada) por
  // telefonemas-listado.js para la pestaña de solo consulta.
  window.TELEFONEMAS = TELEFONEMAS;
})();