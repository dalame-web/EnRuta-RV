# Integrar RV (Registro de Viajes) en otra HT

Este paquete contiene el módulo **RV** extraído de EnRuta, para integrarlo
en otra app HT (ya tenéis una "casi igual" a la nuestra). Ningún archivo
de aquí se ha reescrito — son extracciones literales o copias exactas.

## Archivos de este paquete

| Archivo | Qué es | ¿Tocar algo? |
|---|---|---|
| `registro.js` | El módulo RV completo (modelo, calendario, editor, estadísticas, ajustes, PDF). Copia exacta. | No. |
| `data.js` | Traduce el Libro de Horarios de vuestra HT (`<script id="data">`) al formato que `registro.js` espera (`window.RV_HORARIOS`). Copia exacta. | Solo si vuestro `<script id="data">` tiene un formato distinto (ver más abajo). |
| `registro.css` | Todo el CSS visual de RV, extraído de `index.html`. | Revisar la sección final ("pegamento de integración") si vuestro sistema de pestañas es distinto al nuestro. |
| `app-modal.js` | Los diálogos de confirmación/aviso propios (`appModal.confirm/alert`) que usa `registro.js` en vez de `confirm()`/`alert()` nativos. Archivo autocontenido (inyecta su propio CSS). | No. |
| `informe-logo.png`, `informe-decorativo.jpg`, `carlito-regular.ttf`, `carlito-bold.ttf` | Assets del PDF "Informe de incidencia" (logo, imagen decorativa, tipografía de la empresa). `registro.js` los carga con `fetch('informe-logo.png')` etc. — **rutas relativas**, deben estar en el mismo directorio que `index.html`/`registro.js`. | No, pero deben copiarse tal cual (binarios). |

## Qué necesita vuestra HT para que RV arranque

1. **4 contenedores vacíos** en vuestro HTML, con estos IDs exactos:
   ```html
   <section id="registro-pane"></section>
   <section id="calendario-pane"></section>
   <section id="estadisticas-pane"></section>
   <section id="ajustes-pane"></section>
   <div class="save-flash" id="save-flash">Guardado</div>
   ```
2. **Un botón de tema con `id="theme-toggle"`**, si queréis que RV comparta
   tema día/noche con vuestra HT (RV solo LEE la clase `body.light` que
   vuestro botón ya aplica — no añade su propio listener, así evitamos el
   bug de doble-toggle que tuvimos nosotros). Si no tenéis ese botón, RV
   simplemente arranca en tema oscuro y sus botones de Ajustes ("Tema
   oscuro"/"Tema claro") funcionan igual, solo local a RV.
3. **`<script id="data">`** con el Libro de Horarios en el mismo formato
   que usa vuestra HT hoy (array de marchas con paradas `{n, h, c, ...}`).
   `data.js` lo lee y construye `window.RV_HORARIOS`. Si el formato difiere,
   hay que adaptar `data.js` (es solo un adaptador de 60 líneas).
4. **jsPDF 2.5.1** vía CDN, solo si queréis la función "Exportar a PDF" o el
   "Informe de incidencia":
   ```html
   <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
   ```
5. Si queréis el **"Informe de incidencia"** (botón en el editor de turno,
   genera un PDF calcado al formato oficial de la empresa): los 4 archivos
   `informe-logo.png`, `informe-decorativo.jpg`, `carlito-regular.ttf` y
   `carlito-bold.ttf` deben estar accesibles en la misma ruta relativa que
   `index.html` (por ejemplo, para que un Service Worker los precachee,
   añadidlos a su lista `PRECACHE`). Si fallan al cargar (sin conexión y
   sin cache, o si no los copiáis), el informe se sigue generando pero sin
   logo/imagen y con tipografía `helvetica` en vez de la corporativa — no
   rompe nada, solo se ve más soso.

## Orden de carga en el `<head>`/`<body>`

```html
<link rel="stylesheet" href="registro.css">
...
<script id="data">{ ... vuestro libro de horarios ... }</script>
<script src="data.js"></script>
<script src="app-modal.js"></script>
<script src="registro.js"></script>
```

`data.js` debe cargar antes que `registro.js` (necesita `window.RV_HORARIOS`
ya construido). `app-modal.js` también debe cargar antes que `registro.js`
(usa `appModal.confirm/alert` como variable global, sin comprobar si existe).

## Cómo mostrar las vistas de RV

`registro.js` expone `window.REGISTRO` con estos métodos:

- `REGISTRO.switchTo('calendario' | 'registro' | 'estadisticas' | 'ajustes')`
  — renderiza y activa la vista. Llamadlo desde el click de vuestros propios
  botones de navegación.
- `REGISTRO.getActiveTurno()` / `getOrCreateActiveTurno()` — turno en curso.
- `REGISTRO.getEditTurno()` / `getActiveSvcIndex()` — turno/servicio abierto
  ahora mismo en el editor (para cruzar datos con vuestra HT, ver abajo).
- `REGISTRO.discardEmptyEdit()` — llamadlo al salir de la vista Registro,
  para no dejar turnos fantasma vacíos.

RV pinta cada vista con `.pane` + `.active` sobre los 4 `<section>` del
paso 1. Si vuestro router de pestañas usa otro mecanismo (no `.active`),
ajustad la última sección de `registro.css` ("pegamento de integración") o
la función `setView()` dentro de `registro.js`.

## Cross-feed opcional (Horario ↔ Registro)

Esto es **opcional** — RV funciona standalone sin ello (registro manual
puro). En EnRuta, `app.js` (no incluido en este paquete, es específico de
nuestro nav) conecta HT y RV escuchando una API `window.HTIryo` con estos
métodos:

| Método de `window.HTIryo` | Para qué lo usa el cross-feed |
|---|---|
| `getMarch()` | Nº de servicio de la marcha activa en Horario |
| `onMarchaChange(cb)` | Avisar cuando cambia la marcha activa |
| `getStopDelays()` | Retrasos calculados por GPS/marcas, por parada |
| `getActiveLegInfo()` | Qué tramo concreto (en servicios partidos) está activo |
| `showService(num, noNav)` | Abrir un servicio concreto en Horario |

En sentido contrario (RV → HT), `registro.js` dispara este evento:

| Evento | Cuándo | Qué debería hacer el que escucha |
|---|---|---|
| `iryo:turnoCerrado` | Al pulsar "Cerrar turno" | En EnRuta, HT escucha esto y llama a su propio `finalizeService()` para dejar el servicio en "—" (turno terminado, ya no hay marcha activa que sincronizar). Si no escucháis nada, no pasa nada — es un evento informativo, nadie está obligado a reaccionar. |

Si vuestra HT ya expone una API parecida, os servimos aparte el código de
`app.js` de EnRuta como referencia (no lo pongáis tal cual: adaptad la
parte de detección de pestañas, que ahí es específica de nuestro nav).

Si decidís implementar el cross-feed, tened en cuenta:
- Los campos `_rSalidaFrozen`, `_rLlegDestinoFrozen`, `_rLlegFrozen`,
  `_rSalFrozen` marcan un retraso como "definitivo" para que el cross-feed
  no lo machaque con el valor en vivo del GPS. Los pone tanto vuestro lado
  (HT, al confirmar una marca real) como el propio `registro.js`
  (`markRetFrozen`, dentro de este paquete): en cuanto el usuario edita un
  retraso a mano en RV y lo confirma (Enter/blur), ese campo queda
  congelado y ya no se sobrescribe automáticamente. Llegada y salida de
  cada parada se congelan **por separado** (marcar una no afecta a la otra).
- Si el servicio es "transversal" (parte en dos tramos, ej. cambio de
  maquinista en una estación intermedia), al construir las paradas desde
  fuera aseguraos de incluir los mismos campos que usa `registro.js`
  (`nombre, hora, tParada, rLleg, rSal, viajeros, asistencias, pmr`) —
  si falta alguno, `registro.js` tiene *fallbacks* casi todos, pero es
  más simple mantener la misma forma.

## Qué NO hace falta traer

- El botón compartido de tema con doble listener (ya solucionado: RV solo
  lee el estado, no lo escribe).
- Ningún código de nav "fósil" (ya se limpió del `registro.js` de este
  paquete: no busca `nav.tabs button` ni emite eventos sin consumidores).
- El lápiz/canvas de dibujo (`s.dibujos`): campo de compatibilidad que
  existe en el modelo pero no se usa ni se renderiza.

## Referencia rápida del modelo de datos

`localStorage['rviryo_turnos_v1']` = array de `Turno`:
```jsonc
{
  "id": "abc123", "estado": "en_curso" | "cerrado",
  "servicios": [{
    "fecha": "2026-07-06", "servicioComercial": "6010",
    "origen": "...", "destino": "...", "via": "4", "rama": "12",
    "hSalida": "09:20", "hDestino": "13:05",
    "rSalida": "5", "rLlegDestino": "+3", "horaLTV": "10:00",
    "paradas": [{ "nombre": "...", "hora": "10:49", "tParada": 1,
                  "rLleg": "+3", "rSal": "+2", "viajeros": "120",
                  "asistencias": "1", "pmr": [{"baja": "..."}] }],
    "n1": "...", "viajeros": "250", "asistencias": "5",
    "pmr": [{"baja": "..."}],
    "comprobaciones": [true, false, /* 13 en total */],
    "observaciones": "...", "dibujos": [],
    "incidencias": [{
      "hora": "10:15", "linea": "L30", "cabina": "DM1", "pk": "...",
      "coche": "3", "descripcion": "...", "medidas": "...", "trenes": "...",
      "generado": true
    }]
  }]
}
```

`incidencias` es un **array** (un servicio puede tener 0, 1 o varias
incidencias, cada una con su propio PDF) — botón "📋 Informe de
incidencia" en la tarjeta del servicio, junto a "🎤 Dictar", despliega el
bloque y permite "+ Añadir otra incidencia". `generado: true` se marca en
cuanto esa incidencia genera su PDF con éxito; mientras esté a `true`
aparece un icono 📋 en la cabecera del servicio (expandida y colapsada) y
en el calendario (celda del día y fila de la vista lista) — todo eso es
puramente informativo, no bloquea nada.

**Migración desde versiones anteriores del paquete**: si integrasteis una
versión previa donde cada servicio tenía como mucho una incidencia en
campos planos (`s.incHora`, `s.incLinea`, `s.incCabina`, `s.incPk`,
`s.incCoche`, `s.incDescripcion`, `s.incMedidas`, `s.incTrenes`),
`normTurno()` (dentro de `registro.js`) migra esos datos automáticamente a
`incidencias[0]` la primera vez que carga cada turno guardado — no hace
falta ningún script de migración aparte, ni de vuestra parte ni nuestra.

`localStorage['rviryo_settings_v1']` = `{ theme, telefono, ramas, calView,
autoDownload, lastBackup, nombre, apellidos, idEmpleado }`. Los 3 últimos
(nombre, apellidos, ID de empleado) son los datos personales del
maquinista que se estampan en la cabecera del Informe de incidencia
(card nueva en Ajustes → "Datos personales").

Ninguna de estas dos claves colisiona con las de HT (que usan el prefijo
`ebula_*`) — podéis convivir sin conflicto.
