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
