# Bitácora — Copia en la nube (OneDrive) y sincronización multi-dispositivo

> Registro cronológico de TODO lo que se toca en esta funcionalidad, para poder
> reconstruir o deshacer paso a paso. Plan completo:
> `C:\Users\david\.claude\plans\tender-drifting-rabin.md`

---

## Estado de partida (checkpoint)

- **Rama:** `feature/nube-onedrive` (creada desde `main` local).
- **Etiqueta de vuelta atrás:** `pre-nube` → commit `f77d60e`.
- `main` local: `f77d60e` (incluye `enruta-v38`, congelado, sin push).
- `origin/main`: `63669ec` (lo que hay en la tablet ahora mismo).
- Versiones en el checkpoint: `APP_VERSION = 'enruta-v38'` ·
  `registro.js?v=202608300` · `sw.js CACHE = 'enruta-rv-v30'`.
- Árbol de trabajo limpio salvo lo de esta funcionalidad.

## Procedimiento de vuelta atrás

- **Deshacer TODO:** `git checkout main && git branch -D feature/nube-onedrive`
  (o, si ya se fusionó, `git revert -m 1 <commit-merge>`). `main` nunca se toca
  hasta que David dé el OK.
- **Deshacer solo la nube, dejar el resto:**
  1. Quitar de `index.html` los 2 `<script>` (`msal-browser.min.js` y
     `nube.js`).
  2. Quitar de `registro.js` la línea `if (window.NUBE) NUBE.onTurnosSaved(...)`
     dentro de `save()`.
  3. Quitar la tarjeta "Copia en la nube" de `renderSettings()` y el aviso de
     primer arranque de `init()`.
  4. Revertir bumps de versión.
  La capa nube es **aditiva**: sin esos 4 puntos, la app se comporta
  exactamente como en el checkpoint.
- **Datos:** `nube.js` nunca borra `localStorage` sin merge previo. Ante
  cualquier fallo de sync, los turnos locales de cada tablet quedan intactos.

---

## Cambios (más reciente arriba)

### 2026-08-31 — Paso 11: fuera el guardado local en archivos; potenciar la nube (enruta-v40)

David: el guardado local (File System Access) no se puede arreglar (Android no
persiste el permiso). Se quita todo y se potencia OneDrive.

**Eliminado de `registro.js`** (todo el bloque «Carpeta de turnos»):
`folderHandle`, `folderPendingHandle`, `FOLDER_DB`, `folderSupported`,
`idbOpen/idbGetHandle/idbSetHandle`, `dayFileName`, `writeDayFile`,
`syncTurnoDates`, `syncFolderFull`, `scheduleTurnoFolderSync`, `linkFolder`,
`resumeFolderAccess`, `unlinkFolder`, `reindexFromFolder`, `initFolderHandle`,
`maybeFirstRunFolderPrompt`, `folderBanner`. Acciones `folder-*`. Tarjeta
«Carpeta de turnos (archivos)» de Ajustes. Claves `settings.folderSetupSeen`
y `settings.folderLinked`. La llamada en `save()` (queda solo el hook de NUBE).
`.folder-banner` de `registro.css`. `init()` borra la IndexedDB huérfana
`rviryo_folder_v1`.

**Potenciar la nube:**
- El aviso para vincular ahora **se repite cada 8 aperturas** si no se ha
  vinculado (antes: una sola vez). Texto reescrito ("Tus turnos solo están
  guardados en esta tablet…"). `settings.nubeAvisoVisto` →
  `settings.nubeAvisoContador`.
- Icono ☁️ **sin vincular**: borde rojo + latido suave (antes: gris apagado,
  se perdía de vista). Ahora es la única copia de seguridad, tiene que verse.

Versiones: `enruta-v40` · `?v=202609011` · `CACHE enruta-rv-v32`.
Verificado en navegador: sin refs a folder, sin errores, tarjeta de Ajustes
solo con la nube, aviso se muestra (contador=1), IndexedDB limpia.

### 2026-08-31 — Paso 10: arreglo de recargas en bucle (enruta-v39)

David reporta: al abrir la app se recarga varias veces y se pierden las
ventanas abiertas (p.ej. el aviso de vincular OneDrive).

Causa: el precache `c.addAll(PRECACHE)` fallaba entero si un recurso caía
(muy posible con `msal-browser.min.js` ~275 KB y mala cobertura). La
instalación se reintentaba y cada éxito disparaba una recarga en seco.

Arreglo:
- `sw.js`: precache **tolerante a fallos** — `c.add(u).catch(()=>{})` por
  recurso; un fallo no aborta la instalación (ese recurso se cachea luego con
  el handler de fetch). `CACHE` → `enruta-rv-v31`.
- `index.html`: recarga automática **educada** — solo una vez por carga
  (`swReloaded`), y **nunca mientras hay un diálogo abierto o el usuario
  escribe** (reintenta cada 3 s hasta que la pantalla esté libre).
- `APP_VERSION` → `enruta-v39` · `?v=202608312`.

### 2026-08-31 — Paso 9: PUBLICACIÓN v38

- Valores finales: `APP_VERSION = 'enruta-v38'` · `?v=202608311` (registro.js,
  nube.js, registro.css) · `sw.js CACHE = 'enruta-rv-v30'`. (v37 / v29 era lo
  publicado.)
- Syntax check OK de registro.js, nube.js, sw.js, msal-browser.min.js.
- Verificado en navegador con caché limpia: carga sin errores, `NUBE.estado`
  OK, iconos de la barra, celdas 118/206px por fila, 5 servicios, card
  Toma/Deje/Descanso sin check, scroll por pestaña con turno con datos.
- Merge `feature/nube-onedrive` → `main` y push → despliegue GitHub Pages.
- **Pendiente tras publicar:** prueba real móvil + tablet de empresa
  (sincronización cruzada de turnos entre dispositivos).

### 2026-08-31 — Paso 8: mejoras de editor y calendario (misma rama, separables)

Estos cambios NO son de la nube; van en la misma rama pero son independientes.

- **(5) Celdas del calendario más altas y ajustables por fila.** `.cal-day`
  `min-height` 92→118px (140 en tablet, 160 en pantalla grande) y **quitado
  `overflow:hidden`**. Todas las celdas de una fila crecen a la altura de la
  más alta (comportamiento por defecto de grid + flex-column) — verificado:
  una fila con un día de 3 servicios = 206px las 7 celdas; otra fila = 118px.
  Fuentes de los bloques de servicio un punto más grandes.
- **(6) Hasta 5 servicios por día.** Botón «+ Añadir Nº servicio»
  (2º/3er/4º/5º) visible mientras `servicios.length < 5`. El editor, la celda
  del calendario y el PDF (`pintarTurnoEnDoc` ya pagina solo) ya iteraban con
  `forEach`, sin límite duro.
- **(8) Toma / Descanso / Deje en su propia card.** Sale del bloque de
  servicio y pasa a una card propia (`.turno-horario-card`) al principio del
  editor, entre la barra de botones y los servicios. Un solo dato de turno.
- **(9) Quitado el check «Turno».** Toma/Descanso/Deje **siempre visibles**.
  Fuera el `<input type=checkbox>`, la acción `turno-horario-toggle` y el CSS
  `.turno-horario-check`. `isEmptyTurno` ahora cuenta toma/deje/descanso como
  «tiene datos».
- `registro.css?v=` añadido a `index.html` (antes no tenía cache-buster).

### 2026-08-31 — Paso 7: iconos en la barra + numeración de versión

- **Numeración:** se deja de subir versión en cada commit de la rama. Toda la
  funcionalidad de la nube (+ el arreglo de la carpeta local de v38) publica
  como **`enruta-v38`** (v37 es la publicada en tablets). `?v=` y `CACHE`
  quedan con valor único; durante el desarrollo se usa un valor DEV que se
  fija al valor definitivo justo antes del merge.
- **Icono de estado de la nube** (`nubeIconoBtn`) en: barra del calendario
  (rejilla y lista) y cabecera del editor de Registro (a la izquierda de
  «Añadir 2º servicio»). Estados: sin (☁️ gris) · reconectar (⚠️) · sync
  (⏳ girando) · error (⚠️ rojo) · al día (☁️ + punto verde).
  `NUBE.estado()` nuevo; `errorSubida` marcado solo en errores HTTP reales
  (no en «sin red»).
- **Toque en el icono:** sin vincular → login; caducado → reconectar;
  al día/error → **fuerza subida ahora**.
- **Botón «ⓘ» de privacidad** solo en la barra del calendario (rejilla y
  lista), junto al icono de la nube. Quitado el pie `nube-pie` y el banner
  `nube-banner` (el estado ya lo da el icono).
- **Scroll por pestaña** (`viewScroll` en `setView`): cambiar de pestaña y
  volver conserva la posición; abrir un turno sigue llevando arriba.
- Estilos `.nube-ico` en `registro.css`.

### 2026-08-31 — Paso 6: «Borrar datos de la nube» ya NO desvincula

- David: borrar datos y desvincular son dos cosas distintas; el botón hacía
  las dos.
- Ahora **«Borrar mis datos de la nube»** solo borra los `turno-*.json` de la
  carpeta EnRuta y resetea el registro de sincro (`fileEtags`, `syncedDay`,
  `turnoAt`, `dayIndex`, `ultima`). **Sigue vinculado.** La carpeta queda vacía
  hasta que el usuario edite un turno o pulse «Sincronizar ahora» (que re-sube
  todo limpio). Para dejar de sincronizar → «Desvincular» (separado).
- Diálogo de confirmación reescrito para explicarlo.
- Versiones: `enruta-v44` · `?v=202608316` · `CACHE enruta-rv-v36`.

### 2026-08-31 — Paso 5: acceso a privacidad desde el Calendario

- Quitado el botón «ⓘ Privacidad» de la tarjeta de Ajustes.
- Nuevo **pie discreto bajo el calendario** (rejilla y lista):
  «☁️ Copia en la nube activa/desactivada · ⓘ Privacidad [· Activar]».
  `nubePie()` en `registro.js`; estilos `.nube-pie` / `.nube-pie-link` en
  `registro.css`.
- Versiones: `enruta-v43` · `?v=202608315` · `CACHE enruta-rv-v35`.

### 2026-08-31 — Paso 4: aviso de privacidad con OK obligatorio + botón «ⓘ Privacidad»

- El aviso de privacidad ahora es `appModal.confirm` con **un solo botón
  "Entendido"** y `dismissValue: null`: si se cierra con ESC (o de cualquier
  forma que no sea el botón), **el flag `nubePrivacidadVista` NO se marca** y el
  aviso vuelve a salir en la siguiente apertura. Solo "Entendido" lo da por
  visto. Verificado en navegador (ESC → flag sigue false; botón → true).
- Nuevo botón **«ⓘ Privacidad»** en la tarjeta de Ajustes (vinculada y sin
  vincular) → `maybeNubePrivacidad(true)` muestra el aviso siempre, a demanda.
- Texto del aviso alineado con el del primer arranque ("OneDrive de empresa…").
- Versiones: `enruta-v42` · `?v=202608314` · `CACHE enruta-rv-v34`.

**Prueba real en local (Firefox, cuenta de EMPRESA) — CONFIRMADO por David:**
carpeta `EnRuta` creada en OneDrive, archivos `turno-*.json` con los turnos
locales, turno nuevo aparece en OneDrive en segundos. Pendiente: prueba
multi-dispositivo (móvil + tablet de empresa).

### 2026-08-31 — Paso 3: prueba real OK + ajustes de texto y privacidad

- **Prueba en local (Firefox, cuenta de EMPRESA):** vincular OK sin error,
  Ajustes muestra "Vinculada" y "última copia hace 1 min" → sincronización
  funcionando. La cuenta de empresa de Iryo **sí deja entrar**.
- **Bug menor:** el aviso de privacidad no llegó a leerse porque el Service
  Worker recarga la app sola al volver del login (guard `hadController` en
  index.html: solo recarga si ya había SW previo → le pasa a usuarios que ya
  tenían la app). **Arreglado:** `maybeNubePrivacidad()` — el aviso se muestra
  tras vincular Y también en la siguiente apertura si no llegó a verse; el flag
  `nubePrivacidadVista` no se marca hasta que el usuario cierra el aviso.
- **Texto del aviso de primer arranque** reescrito (versión de David):
  "…en tu OneDrive de empresa. Se guardan los datos en tu propio dispositivo y
  en OneDrive; solo tendrás acceso tú…".
- Versiones: `APP_VERSION` → `enruta-v41`, `?v=` → `202608313`,
  `CACHE` → `enruta-rv-v33`.

### 2026-08-31 — Paso 2: CLIENT_ID puesto, función ACTIVA

- `nube.js`: `CLIENT_ID = '1815cec1-b40a-41d6-94fa-136337db1dda'` (app SPA
  registrada por David en Entra ID; multi-tenant + cuentas personales;
  redirect `https://dalame-web.github.io/EnRuta-RV/` + `http://localhost:8781/`;
  permisos delegados `Files.ReadWrite`, `offline_access`, `User.Read`).
- `index.html`: `nube.js?v=` y `registro.js?v=` → `202608312`.
- `registro.js`: `APP_VERSION` → `'enruta-v40'`. `sw.js`: `CACHE` → `'enruta-rv-v32'`.
- Verificado en navegador: `window.NUBE.disponible() === true`, la tarjeta
  "Copia en la nube (OneDrive)" aparece en Ajustes, sin errores nuevos en
  consola. **Falta probar el ciclo OAuth completo en Firefox** (el preview de
  Claude Code bloquea el redirect).

### 2026-08-30 — Paso 1: implementación completa (falta el CLIENT_ID)

Toda la funcionalidad escrita. **Inactiva hasta poner el CLIENT_ID en
`nube.js`** (`var CLIENT_ID = ''`) — sin él no sale ni la tarjeta ni el aviso,
y la app se comporta exactamente igual que antes (verificado en navegador:
`window.NUBE.disponible() === false`).

- **Nuevo `nube.js`** (`window.NUBE`): login MSAL redirect + `handleRedirectPromise`,
  `acquireTokenSilent` con banner de reconexión, Microsoft Graph
  (carpeta `EnRuta`, `turno-*.json` por día), merge por id de turno, `If-Match`
  + reintento en 412, cola de reintento propia, sincro al abrir / en
  `visibilitychange`, subida con debounce 5 s. Estado propio en
  `localStorage['rviryo_nube_v1']` (no toca `settings` ni `turnos`).
- **`index.html`**: `<script src="msal-browser.min.js">` + `<script src="nube.js?v=202608310">`
  antes de `registro.js`; `registro.js?v=` → `202608310`.
- **`registro.js`**:
  - `save()` (~L969): `if (window.NUBE) window.NUBE.onTurnosSaved(out);` junto a
    `scheduleTurnoFolderSync()`. Única modificación a lógica existente.
  - `loadAll()`: claves `settings.nubeAvisoVisto`, `settings.nubePrivacidadVista`.
  - Bloque nuevo "Copia en la nube — puente con nube.js" (~L1260): helpers
    `nubeDiaJSON`, `nubeDiaTurnosReales`, `nubeFechasConTurnos`, `nubeAplicarDia`,
    `nubeReRender`, `nubeTrasVincular`, `nubeBanner`, `maybeFirstRunNubePrompt`.
  - `renderCalendar` + `renderList`: `+ nubeBanner()` junto a `folderBanner()`.
  - `renderSettings`: `+ renderNubeCard()` tras la tarjeta de carpeta (visible a
    TODOS los usuarios, no modo desarrollador). `renderNubeCard` + `nubeHaceX`
    definidos junto a `renderGcalCard`.
  - `onClick`: acciones `nube-vincular`, `nube-reconectar`, `nube-sync`,
    `nube-desvincular`, `nube-borrar`.
  - `init()`: `window.NUBE.init()` + `maybeFirstRunNubePrompt` (1,2 s).
  - `window.REGISTRO.nube = {...}` (contrato con nube.js).
  - `APP_VERSION` → `'enruta-v39'`.
- **`sw.js`**: `./nube.js` + `./msal-browser.min.js` a `PRECACHE`;
  `CACHE` → `'enruta-rv-v31'`.
- **Nuevo `PRIVACIDAD.md`**.
- Sin cambios en `registro.css` (la tarjeta reusa `.card/.hint/.btn`; el banner
  reusa `.folder-banner`).
- Syntax check OK (`nube.js`, `registro.js`, `sw.js`). App carga sin errores
  nuevos en consola (solo los 404 de `_vercel/*` que ya existían).

**Siguiente:** David registra la app en Azure (`docs/AZURE-SETUP.md`) → me pasa
el *Application (client) ID* → lo pongo en `CLIENT_ID` de `nube.js` → prueba
completa en Firefox.

### 2026-08-30 — Paso 0: checkpoint y andamiaje

- Rama `feature/nube-onedrive` + etiqueta `pre-nube`.
- **Nuevo** `msal-browser.min.js` — librería de login de Microsoft
  (@azure/msal-browser v5.20.0, bundle UMD de jsdelivr, expone `window.msal`).
  Vendido en el repo: MSAL v3+ ya no está en el CDN de Microsoft y la app no
  tiene build. Se cargará como `<script>` local y lo cacheará el Service
  Worker. Syntax check OK. No se edita.
- **Nuevo** `CAMBIOS-NUBE.md` (este archivo).
- **Nuevo** `docs/AZURE-SETUP.md` — guía paso a paso para que David registre la
  app en Azure y obtenga el *client ID*. Redirect URIs: producción
  `https://dalame-web.github.io/EnRuta-RV/` + local `http://localhost:8781/`
  (puerto de `.claude/launch.json`).

---

## Pendiente (Fase 1)

1. [ ] **David:** registrar app SPA en Azure (Entra ID) → obtener
   *Application (client) ID*. Guía en `docs/AZURE-SETUP.md` (se crea en el
   paso 2).
2. [ ] `index.html`: 2 `<script>` nuevos antes de `registro.js` + bump `?v=`.
3. [ ] `nube.js`: MSAL redirect + `handleRedirectPromise`, `acquireTokenSilent`
   + banner de un toque, Graph delta + GET/PUT/DELETE de `turno-*.json` por
   día, merge por `id` de turno, eTag/412, cola de reintento propia.
4. [ ] `registro.js`: 1 línea en `save()` (`:954`); tarjeta en
   `renderSettings()`; aviso primer arranque en `init()`; claves nuevas en
   `loadAll()`; bump `APP_VERSION`.
5. [ ] `registro.css`: estilos tarjeta / botón login / banner reconectar /
   ventana de privacidad.
6. [ ] `sw.js`: `msal-browser.min.js` + `nube.js` a `PRECACHE`; bump `CACHE`.
7. [ ] `PRIVACIDAD.md`.
8. [ ] Syntax checks, pruebas en Chrome real + tablet, commit por paso.
   **Sin push ni merge a `main` sin permiso.**
