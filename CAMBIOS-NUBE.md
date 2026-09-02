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

### 2026-09-02 — Paso 49: lote de retoques (celda "Turno", Ajustes plegables, novedades) (enruta-v79, SIN PUBLICAR)

David, bloque de 8:

1. **Ajustes → "Sincronizar Google Calendar"** ahora es plegable (cerrada por
   defecto). `setGcalOpen` + `set-gcal-toggle`. `renderGcalCard` reestructurado
   (cabecera = `section-toggle`; contenido solo si abierta).
2. **Ajustes → "Exportar a PDF"** ahora es plegable (cerrada por defecto).
   `setPdfOpen` + `set-pdf-toggle`.
3. **"Retraso conducción" en ROJO** (antes verde como Conducción). `tramoEsp`
   de `Condotta` pasa de `k:'conduce'` a `k:'retraso'`; CSS
   `.cuad-row.t-retraso .cuad-t b{color:var(--bad)}`. "Conduciendo" sigue en
   verde. `parseEventoTurno`: la Condotta ya no genera servicio (guard `k ===
   'conduce'` a secas).
4. **Jornada > 8h en un turno de UN día → valor en rojo y negrita.** Dormidas
   excluidas. En `renderCuadranteDetalle` y en la revisión de la sincro. Clase
   `b.cuad-alto`.
5. **Dormida con descanso < 9h → ese tramo en rojo y negrita.** Clase
   `.cuad-row.cuad-alto` sobre el tramo de descanso. También en la revisión.
6. **"Tiempo de trabajo" → "Jornada"** (celda "Turno" + revisión de la sincro).
7. **Dormidas: el horario sale con "+"** — "18:35 - 10:00" → "18:35 - 10:00+".
   Helper `horarioMasDormida` (si el fin < inicio, añade "+"). En el resumen
   plegado y en el detalle de la celda "Turno".
8. **Ventana de Novedades actualizada** — antes salía la lista vieja (v72) en
   cada actualización. Ahora encabeza el traslado de La Sagrera CTT + PDF
   plegable + lo más útil reciente. (Nada de modo desarrollador en el texto.)

- Dormida en la celda "Turno" se detecta por `horario` (fin < inicio),
  independiente de `isDormida(t)`.
- CSS nuevo: `.cuad-row.t-retraso`, `b.cuad-alto`, `.cuad-row.cuad-alto`.
- Verificado en preview: TESTA (jornada 08:35 en rojo, Condotta en rojo,
  Conducción en verde), TESTB (dormida: horario "10:00+", Jornada 09:00 NO
  roja por ser dormida, descanso 8h00 en rojo). Ajustes: los dos plegables
  cerrados por defecto y abren al pulsar. Novedades sale al subir de versión
  con el texto nuevo. Sin errores de consola.
- Versiones (pendientes de publicar): `enruta-v79` · `registro.js?v=202609065`
  · `registro.css?v=202609065` · `CACHE enruta-rv-v77`.

### 2026-09-02 — Paso 48: Calendar manda en Toma/Deje/Descanso (aunque el turno esté cerrado) (enruta-v78, SIN PUBLICAR)

David: cuando la Toma o el Deje difieren entre Google Calendar y la app, no
se actualizaban. Calendar es la fuente oficial de la empresa — "la app bebe
de Calendar". Si cambia una de las dos, tiene que cambiar en el turno,
**aunque esté cerrado**.

**Causas:**
1. La casilla "Actualizar estos 3 campos" de la revisión salía **desmarcada**
   → si el usuario pulsaba "Aplicar" sin marcarla, el cambio de horario no se
   aplicaba.
2. La detección exigía `existente.turnoHorarioActivo` (flag de UY poco
   fiable en turnos viejos / venidos de la nube).
3. El cambio de horario iba encadenado a "Completar huecos": si esa casilla
   estaba desmarcada, tampoco se aplicaba el horario.

**Cambios (`gcalProcesarEventos` / `gcalAplicarPropuestas` /
`renderGcalPropuestasHtml`):**
- Detección: se marca `cambioHorario` si el turno tiene Toma **o** Deje **o**
  Descanso y Calendar trae un valor distinto. Comparación **en minutos**
  (`mismaHoraHHMM`, helper nuevo): "8:38" y "08:38" no cuentan como cambio.
  Solo se marca el campo concreto que cambió, y **nunca** con valor vacío
  (si el parseo de Calendar falla en un campo, ese no se toca).
- Revisión: casilla **marcada por defecto**, texto "Actualizar en el turno
  (aunque esté cerrado)", y solo lista los campos que de verdad cambiaron.
- Aplicación: **independiente** de "Completar huecos". Pisa solo Toma/Deje/
  Descanso que cambiaron. **No comprueba `t.estado`** → funciona con el turno
  cerrado. Si el turno afectado está abierto en el editor, se repinta.
- Verificado con test Node (`scratchpad/test-cambiohorario.js`, 8/8):
  detección por campo, "8:38"=="08:38", parseo fallido no borra, turno vacío
  va por "faltan". App carga sin errores.
- Alcance: **solo Toma/Deje/Descanso del turno**. Las horas de cada servicio
  siguen viniendo del Libro de Horarios (por nº de tren), como hasta ahora.
- Versiones (pendientes de publicar): `enruta-v78` · `registro.js?v=202609064`
  · `CACHE enruta-rv-v76`.

### 2026-09-02 — Paso 47: icono del botón de La Sagrera → 🅿️ (apartadero) (enruta-v77, SIN PUBLICAR)

David: la llave 🔧 no identifica lo que es. La Sagrera es para apartar
trenes (apartadero). Cambiado a **🅿️** ("apartar"). Título del botón:
"Traslado a/desde La Sagrera CTT (apartadero)".

- Versiones (pendientes de publicar): `enruta-v77` · `registro.js?v=202609063`
  · `CACHE enruta-rv-v75`. (`registro.css` sin tocar.)

### 2026-09-02 — Paso 46: traslado a/desde La Sagrera CTT dentro del servicio (enruta-v76, SIN PUBLICAR)

David: registrar el movimiento en vacío entre Barcelona-Sants y el depósito
La Sagrera CTT **dentro del mismo servicio** (no como servicio aparte). Plan:
`C:\Users\david\.claude\plans\compiled-pondering-balloon.md`.

- **Botón "taller" 🔧** en la tarjeta de estación (a la izquierda del `+`),
  solo cuando `origen` o `destino` del servicio es Barcelona-Sants
  (`esBarcelonaSants` / `sagreraDir`, junto a `normalizaEstacion`).
- **Modelo**: `s.sagrera = { hSalida, hLlegada, num }` — objeto opcional,
  presente solo si activado. La dirección (origen/destino) NO se guarda, se
  deriva en cada render. `blankServicio` no lo añade; `normTurno` lo sanea o
  lo borra si no es objeto. En `isEmptyServicio`/`tieneDatosDeUsuario` cuenta
  como dato; `rellenaHuecosServicio` lo trae del origen si falta.
- **Caso DESTINO Barcelona-Sants**: 🔧 en la tarjeta destino → fila
  "H. Salida La Sagrera" (input + ⏱) en la tarjeta de Barcelona-Sants +
  tarjeta nueva **debajo** "La Sagrera CTT" con "H. Llegada" (+ ⏱) + "Nº
  traslado" + papelera 🗑.
- **Caso ORIGEN Barcelona-Sants**: al revés. 🔧 en la tarjeta origen →
  tarjeta "La Sagrera CTT" **encima** con "H. Salida" (+ ⏱) + "Nº traslado" +
  🗑; fila "H. Llegada La Sagrera" en la tarjeta de Barcelona-Sants.
- **Quitar**: papelera 🗑 en la tarjeta "La Sagrera CTT" (confirma si hay
  datos). Al quitar vuelve a salir el 🔧.
- `applyBind`: rama nueva `p[2] === 'sagrera'`. Handlers `sagrera-toggle` /
  `sagrera-del` (no en `ACCIONES_RO` → bloqueados con turno cerrado).
- **PDF del turno** (`exportPDFMany`, tras "Destino"): línea "Traslado … → La
  Sagrera CTT  Sal: …  Lleg: …  (nº …)".
- **Export HTML** (`buildBackupHtml`): fila `<div class="fr">` con Traslado /
  H. Salida / H. Llegada / Nº.
- **Estadísticas**: `porManiobra["Barcelona-Sants → La Sagrera CTT"]++`
  (o al revés) — cuenta en "Traslados por maniobra" (no suma en "Servicios").
- CSS: `.st-taller`, `.sagrera-card` (borde punteado azul). Reutiliza
  `.st-row`/`.st-lbl`/`.st-time-col`/`.svc-man-num`/`.ret-now`.
- **Verificado en preview**: 🔧 solo en Barcelona-Sants; caso destino y caso
  origen (tarjeta arriba/abajo, dirección auto); ⏱ y campos escriben en
  `s.sagrera`; persiste al recargar; papelera con confirmación; turno cerrado
  bloquea botones e inputs; turno viejo (sin campo) abre sin errores;
  Estadísticas muestra la maniobra. PDF/HTML: código simple con guarda
  `if (s.sagrera)` (no ejecutable en el sandbox del preview). Sin errores de
  consola nuevos.
- Versiones (pendientes de publicar): `enruta-v76` · `registro.js?v=202609062`
  · `registro.css?v=202609062` · `CACHE enruta-rv-v74`.

### 2026-09-02 — Paso 45: nuevo formato de Google Calendar (una línea por tramo) (enruta-v75, SIN PUBLICAR)

David: Google Calendar cambia el formato de los turnos. Ahora cada tramo es
UNA línea: `HH:MM-HH:MM (DUR) <icono> <Tipo> [· lugar | → destino]`. La
cabecera (`Turno:`, `Horario: HH:MM - HH:MM`, `Total WT:`) y las secciones
`CAMBIO DE TURNO (Historial)` y `NOTAS PERSONALES` **no cambian**. El formato
nuevo sustituye al viejo del todo (no hay doble parser).

Ejemplo:
```
SERVICIOS:
14:22-14:42 (20') 🔑 Toma · Madrid Puerta de Atocha
14:42-18:13 (3h31) 🚄 Train → Barcelona-Sants
18:13-18:28 (15') 🚩 Deje · Barcelona-Sants
00:44-10:45 (10h01) 🏨 Duty interruption
```

- **`parseTramoCal(línea)`** — helper nuevo: parsea una línea de tramo →
  `{ hora, horaFin, dur, tipo, lugar, destino }`. Quita el emoji inicial,
  separa `·` (lugar) y `→` (destino).
- **`parseEventoTurno`** (sincronización) reescrito con el helper. Toma/Deje
  de la cabecera `Horario:` (igual que antes). Descanso = duración (del
  rango de horas) de los tramos Break + Duty interruption. Conducción
  (`Train`): origen = lugar/destino del tramo ANTERIOR, destino del `→`,
  horas del propio rango. `Condotta` (retraso) no genera servicio.
- **`parseCalendarCompleto`** (celda "Turno") reescrito: usa el helper, fuera
  la lógica de "línea de ubicación siguiente" (`pend`) — ya no existe.
- **`renderCuadranteDetalle`**: cada tramo muestra `HH:MM–HH:MM (dur) Tipo ·
  lugar/ruta` en texto plano, sin iconos (David). `.cuad-row` pasa de grid a
  bloque fluido.
- `tramoEsp` sin cambios (ya traducía Train/Travel time/Break/Duty
  interruption/Limpieza).
- **Verificado** con los dos ejemplos reales de David (turno normal BC009-D +
  dormida SURP4-D) en un script Node — 22/22 asserts OK: toma/deje, descanso
  (15 min y 601 min), servicios con origen del tramo anterior, cruce de
  medianoche en la dormida (servicio 2 al día siguiente), Travel time y
  Limpieza descartados. Celda "Turno" verificada en el preview.
- Versiones (pendientes de publicar): `enruta-v75` · `registro.js?v=202609061`
  · `registro.css?v=202609061` · `CACHE enruta-rv-v73`.

### 2026-09-02 — Paso 44: ventana de inicio — piezas reales + retoques de texto (enruta-v74, SIN PUBLICAR)

David: los dibujos SVG estaban mal; que las imágenes usen las piezas reales
de la app. Y varios cambios de texto.

- **Ilustraciones = componentes reales**, no dibujos:
  - Pág. 1: el icono real de la app (`icon-192.png`).
  - Pág. 2: la barra de pestañas real (los mismos `<span class="tab">` con
    su CSS, «Calendario» con el subrayado rojo activo). Scroll horizontal
    interno en móvil.
  - Pág. 3: mini calendario con celdas `.cal-day` reales, una `today
    en-curso` con su punto ámbar.
  - Págs. 4 y 5: sin ilustración.
- Fuera todo el SVG dibujado y las clases `.il-*` (CSS muerto).
- **Textos**: «App para maquinistas» (sin «de Iryo»); «Telefonemas — todos
  los telefonemas para consulta»; «Informe — … con los datos del servicio
  donde ocurrió la incidencia»; «Ajustes — … edita las opciones del registro
  de servicios y la gestión en la nube»; quitado «También hay Exportar copia…».
- El botón «‹ Atrás» ya no sale (deshabilitado) en la primera página.
- Verificado en preview: las 5 páginas, pieza real en 1-3, flujos de
  persistencia, móvil 375 px sin scroll de página, sin errores de consola.
- Versiones (pendientes de publicar): `enruta-v74` · `registro.js?v=202609060`
  · `registro.css?v=202609060` · `CACHE enruta-rv-v72`.

### 2026-09-02 — Paso 43: ventana de inicio (carrusel de bienvenida + novedades) (enruta-v73, SIN PUBLICAR)

David: pantalla de bienvenida/ayuda al arrancar con "no volver a mostrar",
carrusel de varias páginas, con ilustraciones. En cada versión nueva, enseñar
las novedades. NADA de modo desarrollador en el texto.

- **`settings.bienvenidaVista`** (bool, default false) y
  **`settings.bienvenidaVersion`** (string, default ''). En `CONFIG_NO_SYNC`
  (estado por aparato — tablet nueva vuelve a ver la guía).
- **`mostrarBienvenida(soloNovedades, desdeAjustes)`** — usa
  `appModal.custom({className:'wide bienv-modal'})`. Carrusel con ‹/›, puntos,
  y en la última página casilla "No volver a mostrar" + botón "Empezar".
  - `BIENVENIDA_PAGINAS` (4): Bienvenida · Cómo se organiza (las 6 pestañas) ·
    Empezar un turno · Dónde están tus datos. `BIENVENIDA_NOVEDADES` (1).
  - Cada página con ilustración SVG en línea (`BIENV_FIG`: tren, tabs,
    calendario, datos, checklist) que hereda el tema por clases de
    `.bienv-fig` (currentColor / vars).
- **Disparo en `init()`**: `!bienvenidaVista` → carrusel completo (5 págs);
  `bienvenidaVersion !== APP_VERSION` → solo la página Novedades ("Entendido").
  Va antes del aviso de la nube (`maybeFirstRunNubePrompt` se salta si el
  carrusel salió este arranque — `bienvenidaMostradaEsteArranque`).
- Al cerrar: si marcó la casilla → `bienvenidaVista=true`; siempre
  `bienvenidaVersion=APP_VERSION`. Cerrar sin marcar → reaparece la próxima
  vez. `desdeAjustes` no persiste nada.
- **Ajustes → Aplicación**: botón "Ver la guía de inicio" (`ver-guia`) → abre
  el carrusel completo sin tocar flags.
- CSS nuevo en `registro.css` (`.bienv-*`, ilustraciones). Responsive a
  375 px (botones a ancho completo, puntos arriba).
- Verificado en preview: carrusel 5 págs con SVG; casilla marca/no marca →
  persiste/reaparece; simulando actualización sale solo Novedades; botón de
  Ajustes abre sin tocar flags; tema claro y móvil OK; sin errores de consola.
- Versiones (pendientes de publicar): `enruta-v73` · `registro.js?v=202609059`
  · `registro.css?v=202609059` · `CACHE enruta-rv-v71`.

### 2026-09-02 — Paso 42: los ajustes del editor se reflejan al instante en Registro (enruta-v72, SIN PUBLICAR)

David: "cada vez que se active/desactive algo en Ajustes se tiene que ver YA
en la pestaña de Registro, sin tener que borrar/reabrir el turno."

**Causa**: los handlers de Ajustes que tocan el editor hacían
`if (lastSetView === 'registro' && editId != null) renderEditor();`. Estando
en Ajustes, `lastSetView === 'ajustes'` → nunca se repintaba el editor. Al
volver a Registro, `switchTo('registro')` sí repinta si hay turno cargado —
pero según el flujo de vuelta (sub-nav, discardEmptyEdit, etc.) podía no
pasar, y entonces la única forma de ver el cambio era reabrir el turno.

- **Helper `refrescarEditorTrasAjuste()`**: `if (editId != null &&
  getTurno(editId)) renderEditor();` — repinta el editor SIEMPRE tras un
  cambio de Ajustes, aunque el pane no esté visible. No cambia de vista ni
  roba el foco (el usuario está en Ajustes).
- Sustituye el guard `lastSetView === 'registro' && editId != null` en:
  `data-comprob-label`, `data-comprob-vis`, `data-reg-vis` (LTV / toma-deje /
  Asistentes), `comprob-mov`, `comprob-del`, `reset-comprobs`. Añadido a
  `comprob-add` (antes no refrescaba nada) y a `save-ramas` /
  `save-datos-personales` (la rama y el teléfono se ven en el editor).
- No se toca: `nubeReRender` (línea 1288 / 6766, cross-feed nube con su
  propio guard de foco) ni el `discardEmptyEdit` de `setView`.

**Compatibilidad con turnos anteriores — verificado, no dado por hecho:**
Probado en preview cargando un turno con schema viejo (sin `asistentes` en
servicio ni paradas, `comprobaciones` como array posicional `[true,false,
true]`, `descanso` en minutos sueltos `'826'`, `horaLTV` global, settings sin
las claves `reg*`). Resultado: abre sin errores de consola; `descanso` migra
a `13:46`, `horaLTV` global migra a `s.horaLTV`, comprobaciones migran a
objeto por clave (13 filas), `asistentes` ausente → campo oculto sin
`esc(undefined)`; turno cerrado sigue en solo lectura. Los cambios de los
pasos 40-42 son **aditivos** (`== null` guards, `s.asistentes ? … : ''` en
PDF/HTML) — un turno viejo sin el campo se comporta igual que antes.

- Versiones (pendientes de publicar): `enruta-v72` · `registro.js?v=202609058`
  · `CACHE enruta-rv-v70`.

### 2026-09-02 — Paso 41: campo "Asistentes" opcional por estación (enruta-v71, SIN PUBLICAR)

David: en las paradas, debajo de PMR, poder añadir (opcionable desde Ajustes)
un campo "Asistentes" con una celda para una cantidad de personas. Campo
nuevo aparte, no se confunde con "Asistencias".

- **Schema**: `s.asistentes` / `p.asistentes` (string, ''), añadidos a
  `blankServicio`, `blankParada` y a los 3 literales de parada que rehacen
  `s.paradas` (`autofillServicio`, `autofillManiobra`,
  `aplicarHorarioAServicio`). Guardas en `normTurno()` (`== null → ''`).
- **isEmpty / merge**: `asistentes` cuenta como dato de usuario en
  `isEmptyServicio`, `tieneDatosDeUsuario`; y se une en `fusionarTurnoEn`
  (lista de claves de servicio y de parada).
- **`settings.regAsistentesOculto`** (bool, default **`true`** — oculto por
  defecto, campo opcional). En `CONFIG_LWW`.
- **Ajustes → "Editar el registro"**: tercer interruptor "Asistentes (por
  estación, debajo de PMR)".
- **Editor**: helper `asistentesRow(bind, val)` — fila numérica debajo del
  bloque PMR en `paxBlockOrigen` y `paxBlockParada` (origen + paradas
  intermedias; el destino no tiene bloque de pasaje). Se pinta si
  `!regAsistentesOculto || val` (si esa estación ya tiene valor, sale aunque
  esté oculto).
- **PDF del turno**: línea "Viajeros / Asist / PMR" del origen y "Viajeros /
  Asist" de paradas → `+ '  Asistentes N'` solo si hay valor.
- **Export HTML**: `<span>Asistentes</span>` en la cabecera del servicio si
  `s.asistentes`; columna "Asistentes" en la tabla de paradas solo si alguna
  parada tiene valor (`colAsist`).
- **Estadísticas**: sin cambios — no agrega Viajeros/Asistencias hoy, así que
  tampoco Asistentes.
- Sin CSS nuevo (reusa `.pax-row`, `.comprob-row`, `.comprob-vis`).
- Versiones (pendientes de publicar): `enruta-v71` · `registro.js?v=202609057`
  · `CACHE enruta-rv-v69`.

### 2026-09-02 — Paso 40: ocultar secciones del editor desde Ajustes (enruta-v70, SIN PUBLICAR)

David: "que desde ajustes se pueda quitar la hora de la LTV y también la
celda de toma, descanso y deje. Que se puedan ocultar." Mismo patrón que las
comprobaciones (ocultar ≠ borrar).

- **`settings.regLtvOculta` y `settings.regHorarioOculto`** (bool, default
  `false`). Saneados en `loadAll()` con `== null → false`. Añadidos a
  `CONFIG_LWW` (preferencia pura, gana el más nuevo entre dispositivos).
- **Ajustes → la tarjeta "Editar las comprobaciones" pasa a "Editar el
  registro".** Al abrir, encima del editor de comprobaciones, dos
  interruptores mostrar/ocultar (checkbox `checked` = visible, estilo
  `.comprob-row`/`.comprob-vis`): "Hora LTV en cada servicio" y "Celda Toma /
  Descanso / Deje". Debajo, subtítulo "Comprobaciones (N)" + su editor de
  siempre. Texto de ayuda general reescrito.
- Handler `data-reg-vis` en `onChange` (junto a `data-comprob-vis`): fija el
  flag, `saveSettings()`, `renderEditor()` si hay turno abierto. No
  `renderSettings()` (el checkbox es nativo, evita perder foco).
- **Editor (`servicioInner`)**: `.ltv-inline` (Hora LTV, cabecera del
  servicio) se pinta solo si `!settings.regLtvOculta || s.horaLTV` — si ese
  servicio ya tiene hora LTV, sigue saliendo.
- **Editor (`renderEditor`)**: la card `.turno-horario-card` (Toma/Descanso/
  Deje) se pinta solo si `!settings.regHorarioOculto || t.toma || t.deje ||
  t.descanso`.
- **PDF del turno y export HTML: sin cambios.** Ya imprimían la LTV solo con
  `s.horaLTV ? … : ''` (líneas ~5037 y ~5531) — es exactamente el criterio
  pedido. Toma/Descanso/Deje no salen en PDF ni HTML.
- Sin CSS nuevo (reusa `.comprob-row`, `.comprob-vis`, `.comprob-label`).
- Versiones (pendientes de publicar): `enruta-v70` · `registro.js?v=202609056`
  · `CACHE enruta-rv-v68`. (`registro.css`, `nube.js`,
  `telefonemas-listado.js` sin tocar → sin bump.)

### 2026-09-02 — Paso 39: comprobaciones editables desde Ajustes (enruta-v69, SIN PUBLICAR)

David: "que desde ajustes pueda poner lo que salga en el registro o quitar
las comprobaciones o anadir alguna mas." Las comprobaciones siguen en el
editor y en el PDF del turno; **nunca** en el informe de incidencia.

- **Almacenamiento por servicio: de array posicional a objeto por CLAVE**
  (`s.comprobaciones = { 'asfa': true, ... }`, disperso, solo las marcadas).
  Antes era `[true,false,...]` y anadir/reordenar en Ajustes descuadraba
  todos los turnos.
- **Migracion en `normTurno()`**: array viejo -> objeto usando los slugs de
  `DEFAULT_COMPROBACIONES` por posicion. Idempotente (se re-migra en cada
  carga hasta el primer guardado). Helper `algunaComprob(s)` soporta los dos
  formatos (usado en `tieneDatosDeUsuario`, `isEmptyServicio`).
- **`fusionarTurnoEn`**: OR por clave, soporta origen en formato viejo.
- **Ajustes -> tarjeta "Comprobaciones"**: plegable, cerrada por defecto
  (14 filas abiertas ocupan mucho). Cabecera `.section-toggle` con el numero
  y chevron; `setComprobsOpen` (estado de UI, no se persiste);
  `set-comprobs-toggle`. Abierta: editor fila a fila, guardado en vivo
  (nada de textarea ni boton Guardar). Cada fila:
  - interruptor "se ve en el editor" (checkbox). Apagarlo pone `oculta:true`
    -> no sale en el turno pero **no se borra**.
  - campo de texto para el nombre (renombrar en el sitio, `change`/blur).
    Como cada fila lleva su `id` estable, renombrar no descuadra nada.
  - flechas arriba/abajo para ordenar.
  - las de fabrica (`esComprobFabrica`) NO tienen papelera, solo se ocultan;
    las anadidas por el usuario si (`comprob-del`, con confirmacion).
  - "+ Anadir comprobacion" y "Restaurar de fabrica".
- Helpers nuevos: `esComprobFabrica(id)`, `marcasComprob(s)`,
  `comprobsParaServicio(s)` (visibles + cualquiera oculta que ESE servicio
  tenga marcada, para no perderla de vista en editor/PDF).
- Handlers en `onClick` (`comprob-mov`, `comprob-del`, `comprob-add`,
  `reset-comprobs`) y en `onChange` (`data-comprob-label`, `data-comprob-vis`).
- **`reset-comprobs`**: vuelve a la lista de fabrica (13), sin ocultas. Las
  marcas de los turnos guardados no se tocan.
- `oculta` se conserva en el saneado de `loadAll()`.
- CSS nuevo en `registro.css`: `.comprob-editor`, `.comprob-row`,
  `.comprob-vis`, `.comprob-label`, `.comprob-mv`, `.comprob-del`,
  `.comprob-slot`.
- `settings.comprobaciones` en `CONFIG_LWW` (last-write-wins entre
  dispositivos). Saneado en `loadAll()`.
- Editor (`servicioInner`), `applyBind` (`srv.N.chk.<slug>`), PDF del turno
  (`pintarTurnoEnDoc`) y export HTML completo: leen la lista viva de
  `comprobsLista()` y las marcas por clave.
- **Informe de incidencia: sin tocar** (grep confirmado, no referencia
  `comprobaciones`).
- **Editor (pestana Registro)**: la seccion "Comprobaciones" no aparece si no
  queda ninguna visible y el servicio no tiene ninguna marcada
  (`comprobsParaServicio(s).length` — mismo criterio en PDF y export HTML).
  Boton "i" (`.chk-info`, `comprobs-info`) junto al titulo: abre un
  `appModal.alert` que remite a Ajustes -> "Editar las comprobaciones".
  Funciona tambien con el turno cerrado (`ACCIONES_RO`).
- Verificado en preview: migracion posicional->clave OK; editor pinta las
  comprobaciones visibles con marcas correctas; toggle en turno abierto
  anade/borra claves y persiste; turno cerrado sigue de solo lectura;
  renombrar conserva `id` y marcas; ocultar quita del editor salvo si ese
  turno la tiene marcada; ordenar / anadir / borrar / restaurar OK; PDF del
  turno se genera sin error. Sin errores nuevos en consola (solo 404
  `_vercel/*`).
- Versiones (pendientes de publicar): `enruta-v69` · `registro.js?v=202609055`
  · `registro.css?v=202609055` · `telefonemas-listado.js?v=202609055`
  · `nube.js?v=202609055` · `CACHE enruta-rv-v67`.

---

### 2026-09-01 — Paso 38: campoOpcional del telefonema: pastilla O hueco (enruta-v68, SIN PUBLICAR)

David: en "en via/s" quiere lo mismo que en "Supone un CSV" — una pastilla
que al activarla muestra el campo para anadir las vias.
- **campoOpcional** pasa de "hueco en gris (vacio = no sale)" a **pastilla +
  campo**: "+ en via/s" (fuera) -> "en via/s [___]" (dentro, con el campo).
  Guarda `opcionales[id]` (pastilla) + `campos[id]` (valor).
- Aplica a "en via/s" y "por (trinchera...)" del LTV3.
- Verificado: activar pastilla -> aparece el campo -> escribir -> guardar ->
  linea de Obs correcta; sin activar no sale nada.

- Versiones (pendientes de publicar): `enruta-v68` · `registro.js?v=202609052`
  · `registro.css?v=202609052` · `telefonemas-listado.js?v=202609052`
  · `nube.js?v=202609052` · `CACHE enruta-rv-v64`.

---

### 2026-09-01 — Paso 37: telefonema — fuera los desplegables y las casillas de la frase (enruta-v67)

David: los desplegables nativos ocupan mucho y las casillas en medio de la
frase no se entienden. Rediseno del sistema de partes de la frase:
- **selector** ahora es un TEXTO QUE CAMBIA AL TOCARLO (rota entre las
  opciones), subrayado punteado. Compacto, se ajusta al texto. Nada de
  `<select>` nativo. LTV3: "Establecida/Suprimida" y "señalizada/sin
  señalizar".
- **opcionalCampo** -> **campoOpcional**: un hueco normal con un prefijo
  delante ("en via/s ___"), en gris cuando esta vacio. Vacio = no sale en
  el texto. **Sin casilla.**
- **opcional** ahora es una PASTILLA: "+ texto" (fuera, punteada) -> "texto"
  en acento (dentro). Se toca. Afecta tambien a ETC/LZB/ARS/RET.
Cubierto en render, guardar (selector por dataset.val, opcional por
dataset.on), blankTelefonema, composeObsLineTelefonema y el catalogo. El
texto de Obs se limpia de espacios y de espacio antes de ". , ; :".
Verificado el flujo completo en preview.

- Versiones: `enruta-v67` · `registro.js?v=202609051` · `registro.css?v=202609051`
  · `telefonemas-listado.js?v=202609051` · `nube.js?v=202609051` · `CACHE enruta-rv-v63`.

---

### 2026-09-01 — Paso 36: telefonema LTV3 — selectores y checks con campo (enruta-v66)

David: pulir el LTV3. Tipos de parte nuevos en el sistema de telefonemas:
- **selector** (`{ t:'selector', id, opciones:[...] }`): desplegable en linea.
  LTV3: "Establecida / Suprimida" y "señalizada / sin señalizar".
- **opcionalCampo** (`{ t:'opcionalCampo', id, label, prefijo, campoHint }`):
  check que, al marcarlo, muestra un campo de texto. LTV3: "en via/s" (numero
  de via) y "por" (trinchera / zona inundable / vientos...).
Cubierto en blankTelefonema, el render de la frase, guardar(),
composeObsLineTelefonema y telefonemas-listado.js (catalogo). El texto de
Observaciones se limpia de espacios sobrantes.
Verificado: rellenar, marcar checks -> aparece el campo, guardar, reabrir ->
todo restaurado; linea de Obs correcta.

- Versiones: `enruta-v66` · `registro.js?v=202609050` · `registro.css?v=202609050`
  · `telefonemas-listado.js?v=202609050` · `nube.js?v=202609050` · `CACHE enruta-rv-v62`.

---

### 2026-09-01 — Paso 35: la 1a linea de Observaciones tambien sale con «•» (enruta-v65)

Al escribir en Observaciones con el campo vacio, la primera linea no llevaba
«• » hasta salir del campo (blur). Ahora sale al momento, en cuanto se
escribe el primer caracter — igual que las siguientes (Enter ya mete «
• »).
Listener de input que antepone «• » a la primera linea si no la tiene (salvo
que sea una linea de telefonema o el campo este vacio). Verificado: campo
vacio se queda vacio, telefonema intacto, no se duplica la vineta.

- Versiones:  ·  · 
  ·  · .

---

### 2026-09-01 — Paso 34: "Reserve" -> "Reserva" (enruta-v64)

Otro tipo de tramo en ingles que quedaba sin traducir (aparece en turnos de
reserva/disponibilidad). "Reserve" -> "Reserva".

- Versiones: `enruta-v64` · `registro.js?v=202609048` · `registro.css?v=202609048`
  · `nube.js?v=202609048` · `CACHE enruta-rv-v60`.

---

### 2026-09-01 — Paso 33: fuera el chivato por tramo + la revisión de Ajustes lista qué falta (enruta-v63, SIN PUBLICAR)

**1. Fuera el chivato por tramo** («falta este servicio en el turno»). En una
dormida completa seguía saliendo porque comparaba solo por hora del día, sin
fecha → un tramo del día 2 no casaba con el servicio del día 2. Calendar ya
muestra bien cuándo se conduce (tramos verdes). Eliminado + su código muerto.
Se mantiene el chivato de **toma/deje** (turno vs `Horario:` del cuadrante,
en minutos).

**2. La revisión de sincronización (Ajustes / botón 🔄) ahora lista QUÉ
FALTA.** Antes solo decía «se completarán los campos vacíos». Ahora, por cada
día, sale «Falta por completar en el turno:» con la lista exacta:
- `Toma: 08:38` / `Deje: 14:53` / `Descanso: 32 min` si falta alguno
- `Servicio 6108: Madrid P.Atocha → Málaga (09:50)` por cada servicio del
  cuadrante que no esté en el turno
- Y en la cabecera del día: el **Tiempo de trabajo** (Total WT) del cuadrante.
Texto aclarado: «Solo se rellenarán los campos vacíos — nunca se pisa lo que
ya tienes».

- Versiones (pendientes de publicar): `enruta-v63` · `registro.js?v=202609047`
  · `registro.css?v=202609047` · `nube.js?v=202609047` · `CACHE enruta-rv-v59`.

Pendiente de David: qué es «Condotta» (visto en la dormida BC0P2-D, línea
«10:07 Condotta · Madrid Puerta de Atocha», antes del último Deje).

---

### 2026-09-01 — Paso 32: celda "Turno" — chivatos falsos «no está en el turno» (enruta-v62)

David: en una dormida COMPLETA (ida + vuelta, la vuelta el día siguiente)
seguía saliendo «falta este servicio». El chivato por tramo comparaba solo
por hora del día, sin mirar la fecha → en una dormida un tramo del día 2 no
casaba con el servicio del día 2.

- **Quitado el chivato por tramo** («falta este servicio en el turno»). El
  cuadrante ya muestra bien cuándo se conduce (tramos «Conduciendo» en
  verde); el aviso por tramo confundía y daba falsos en dormidas. (David:
  «en Calendar indica bien cuando conduzco».)
- **Se mantiene** el chivato de toma/deje: si la toma o el deje del turno no
  coinciden con el `Horario:` del cuadrante (comparando en minutos). Esos
  campos son del turno completo, no de conducción — es una comparación
  válida.
- Eliminado el código muerto (`legEnTurno`, `minsTurno`).

- Versiones (pendientes de publicar): `enruta-v63` · `registro.js?v=202609047`
  · `nube.js?v=202609047` · `CACHE enruta-rv-v59`.

Pendiente de David: qué es «Condotta» (visto en la dormida BC0P2-D, línea
«10:07 Condotta · Madrid Puerta de Atocha», justo antes del último Deje).

---

### 2026-09-01 — Paso 32: celda "Turno" — chivatos falsos «no está en el turno» (enruta-v62)

David: en varios tramos salía «no está en el turno» siendo servicios que SÍ
están.

- **Causa:** el chivato comparaba la hora del tramo con la hora de salida
  del servicio **como texto** — `"09:30"` (cuadrante) ≠ `"9:30"` (Libro). Y
  toma/deje igual (`"08:38"` ≠ `"8:38"`).
- **Arreglado:** todo se compara **en minutos**, con tolerancia ±5 min para
  los tramos de conducción (además se mira la hora de cada parada del
  servicio). Verificado con un turno real (17/08, 2 servicios): 0 avisos
  falsos.
- El chivato de un tramo de conducción **solo** salta si tiene ruta real
  (origen→destino) y de verdad no hay ningún servicio a esa hora — los
  movimientos sueltos a/desde cochera ya no lo disparan.
- Texto: «falta este servicio en el turno» (más claro que «no está»).
- La **Pausa** también muestra su duración (≈ 32m), como el descanso.
- Verificado con una dormida real (BC0P2-D): el tramo de vuelta que el
  usuario aún NO había metido como servicio SÍ sale marcado (correcto); la
  ida, que sí está, ya NO sale marcada.

Pendiente de David: qué es el tipo de tramo «Condotta» (aparece sin
traducir); y confirmar que los tramos marcados son de verdad servicios que
faltan por meter.

- Versiones: `enruta-v62` · `registro.js?v=202609046` · `nube.js?v=202609046`
  · `registro.css?v=202609043` · `CACHE enruta-rv-v58`.

---

### 2026-09-01 — Paso 31: arreglos de la sincro de Calendar y de config (enruta-v61)

David: al sincronizar Google Calendar con un rango de fechas amplio desde
Ajustes, «no se actualizan completamente los turnos»; con la sincro
automática de la semana sí salen todos los datos. Además avisos raros de
«vuelve a sincronizar con Google».

- **`gcalFetchEventos` no paginaba.** Google devuelve como mucho 2500
  eventos por página; un rango amplio se parte en varias y solo se leía la
  primera → los días del final del rango no llegaban al caché. Ahora sigue
  el `nextPageToken` hasta traerlos todos.
- **La sincro de config podía PISAR ajustes.** v58 traía la config del otro
  aparato con «gana el más nuevo» a lo bruto: si el móvil (sin login de
  Google, sin modo desarrollador) sincronizaba después, borraba en la
  tablet el **Client ID de Google**, el **modo desarrollador**, el nombre,
  las ramas... y la sincro de Calendar dejaba de funcionar.
  - Ahora: la **primera** sincro de un aparato trae TODO (aparato nuevo);
    después solo se **rellena lo que aquí falte** y NUNCA se pisa un valor
    que ya tienes.
  - Excepción `CONFIG_LWW` (tema, auto-tema, autoDownload, aviso de
    privacidad): esos sí «gana el más nuevo» — no hay nada que perder y así
    un cambio de tema propaga.
- **La caché del cuadrante (`gcalCache`) en la nube: MERGE, nunca
  reemplazo.** Un aparato con caché vacía ya no la sube ni borra la del que
  sí la tiene.
- La celda "Turno" con caché antigua (sin `raw`) ahora muestra lo que hay
  (toma/deje/descanso + servicios) con una nota discreta, en vez del aviso
  «vuelve a sincronizar».

Verificado en preview: un config «de móvil sin configurar» ya NO pisa
Client ID / modo desarrollador / nombre / ramas; tema y autoDownload sí
propagan.

- Versiones: `enruta-v61` · `registro.js?v=202609045` · `nube.js?v=202609045`
  · `registro.css?v=202609043` · `CACHE enruta-rv-v57`.

---

### 2026-09-01 — Paso 30: celda "Turno" con los datos del cuadrante (Calendar) en el editor (enruta-v59)

David: mostrar los datos que salen en Google Calendar dentro del editor de
Registro, en una celda plegable ENCIMA de Toma/Descanso/Deje. Solo modo
desarrollador.

- **`parseCalendarCompleto(desc)`** — lector nuevo que saca TODO de la
  descripción del evento sin descartar nada: cabecera (Turno, Horario,
  Total WT), cada tramo de SERVICIOS, «CAMBIO DE TURNO (Historial)» y
  «NOTAS PERSONALES». Líneas sueltas que no encajan → `extra` (no se
  pierden). No toca `parseEventoTurno` (que sigue para la sincro).
- **Nombres en inglés → español:** Train → Conduciendo, Travel time → De
  viajero, Passage connection → Traslado, Duty interruption → Descanso
  (dormida), Break → Pausa, Preparation → Preparación, Limpieza/apagado tal
  cual. Desconocido → se muestra tal cual.
- **Celda "Turno"** (`renderCuadranteCell`):
  - Plegada: `<código> · <horario> ▾` (sin icono ni etiqueta).
  - Desplegada: cabecera + **chivato ámbar** si la toma/deje del turno no
    coincide con el cuadrante + línea de tiempo con todos los tramos
    (Conduciendo en verde, descanso de dormida en ámbar con su duración,
    divisor «— noche —» al cruzar medianoche, aviso «no está en el turno»
    junto a un tramo de conducción que no tenga servicio) + historial +
    notas.
  - Estado plegado/desplegado en `cuadranteAbierto` (no se persiste).
- **La caché del cuadrante (`gcalCache`) ahora se sincroniza** en
  `_config.json` (`{ at, settings, gcal }`) → todos los dispositivos ven el
  cuadrante aunque solo la tablet tenga el login de Google. `gcalProcesarEventos`
  guarda además `raw` (la descripción del evento). Enganche en `save()` para
  `K_GCAL_CACHE`.

- Versiones: `enruta-v59` · `registro.js?v=202609043` · `registro.css?v=202609043`
  · `nube.js?v=202609043` · `CACHE enruta-rv-v55`.

---

### 2026-09-01 — Paso 29: cambio automático de tema claro/oscuro por hora (enruta-v58)

David: que el modo claro/oscuro cambie solo según la hora.

- **Ajustes → «Tema»:** casilla «Cambio automático claro / oscuro por hora».
  Al activarla salen dos horas: «Claro desde» y «Oscuro desde».
  Recomendado / por defecto: **claro 08:00, oscuro 20:00**.
- `temaSegunHora()` decide el tema según la hora actual y los dos umbrales.
  `applyTheme()` usa ese valor si `themeAuto`, si no `settings.theme`.
- Se recalcula: al abrir la app, al volver de segundo plano, y cada minuto
  (`setInterval`).
- El botón 🌙/☀️ de la barra sigue funcionando como manual y **desactiva el
  automático** (un toque manual manda).
- Se sincroniza por `_config.json` (los umbrales van a los dos aparatos).
- Verificado en preview: casilla, horas, forzar claro/oscuro cambiando los
  umbrales, y el toque manual apaga el automático.

- Versiones: `enruta-v58` · `registro.js?v=202609042` · `nube.js?v=202609042`
  · `registro.css?v=202609040` · `CACHE enruta-rv-v54`.

---

### 2026-09-01 — Paso 28: botón de telefonema LTV con etiqueta corta (enruta-v57)

En el editor de Registro, el botón de telefonema LTV ponía «Limitación
temporal velocidad». Ahora pone solo «LTV» (como ETCS y LZB). Campo nuevo
opcional `catCorto` en la categoría; el botón usa `catCorto || catLabel`.
El catálogo de la pestaña Telefonemas sigue con el nombre largo.

- Versiones: `enruta-v57` · `registro.js?v=202609041` · `nube.js?v=202609041`
  · `registro.css?v=202609040` · `CACHE enruta-rv-v53`.

---

### 2026-09-01 — Paso 27: lote enruta-v56 (dedupe seguro · móvil · turno cerrado · config en la nube · sincro blindada · LTV3 · color en Observaciones)

Todo esto se desarrolló en pasos separados y se publica JUNTO como
`enruta-v56` (un solo deploy). Detalle por área:

**A. Dedupe de turnos duplicados — seguro (sobre lo de v55).**
- `dedupeTurnos` juntaba dos turnos si sus fechas se solapaban a secas.
  Pero `openDay`/`renderDayChooser` SÍ permiten varios turnos el mismo día
  («+ Crear otro turno») → habría destruido turnos deliberados (turno de
  mañana + dormida esa tarde; dos servicios sueltos). Riesgo de pérdida de
  datos + lápida propagada.
- `mismoTurnoDuplicado(a,b)`: se juntan SOLO si las fechas de uno están
  **contenidas** en las del otro **Y ADEMÁS** uno es `_deCache` (nunca
  deliberado) **o** comparten un servicio real (mismo nº de tren + fecha).
  Dos turnos del mismo día con trenes distintos → NO se juntan. Dos
  dormidas consecutivas (28→29 y 29→30) → NO se juntan.
- `_deCache` nunca gana la fusión (bug: podía quedarse el fantasma y
  borrar el real). `_deCache` sobrante no deja lápida (nunca estuvo en la nube).
- `fusionarTurnoEn` NO descarta datos: observaciones se unen línea a línea,
  incidencias/telefonemas se añaden los que falten. Si un lado estaba
  cerrado, el turno unido queda cerrado (no se reabre solo).
- Verificado: (A) fantasma _deCache + dormida real → queda la dormida;
  (B) dos turnos mismo día trenes 100/200 → los dos se conservan;
  (C) misma guardia tren 300 en dos aparatos → se juntan con las
  observaciones de los dos.

**B. Vista mensual en el móvil.** Antes el móvil forzaba lista. Ahora tiene
la cuadrícula del mes (compacta: número + punto de color, se toca para
abrir), y el botón ▦/≡ alterna lista↔mes también en móvil. Sin scroll
horizontal (probado a 375 px). `esMovil()` queda sin usar (se deja definida).

**C. Turno cerrado = solo lectura.** Hay que pulsar «Reabrir turno».
- Todos los `input/select/textarea` van `disabled` (también teclado/pegar).
- `applyBind` corta cualquier mutación si `estado === 'cerrado'`.
- `onClick` en el editor solo deja pasar: volver, reabrir, borrar, ver
  servicios, ver/completar telefonemas ya creados, nube.
- Aviso «🔒 Turno cerrado — solo lectura».
- Un telefonema **ya creado** SÍ se puede completar con el turno cerrado
  (ventana aparte, no usa `applyBind`). Añadir uno **nuevo** → hay que
  reabrir (confirmado por David).
- Verificado: 27 campos disabled, botones no hacen nada, forzar por script
  tampoco escribe, «Reabrir» lo desbloquea entero.

**D. Configuración (ajustes) en la nube.** Antes solo turnos. Ahora también
los ajustes → al vincular OneDrive en un aparato nuevo se trae TODO.
- Archivo `EnRuta/_config.json` = `{ at, settings }`. Gana la última
  escritura (`at`). Enganche en `save()` para `K_SETTINGS`.
- NO se sincroniza: `calView`, `nubeAvisoContador`, `lastBackup`. Sí:
  ramas, nombre, apellidos, idEmpleado, teléfono, tema, telDevMode, gcal,
  autoDownload, nubePrivacidadVista.
- `Borrar mis datos de la nube` borra también `_config.json`.

**E. Sincronización blindada contra mala cobertura** (David: uso con datos
móviles, zonas sin cobertura, cortes).
- Nunca se aplica una descarga a medias: cada archivo (`turno-*.json`,
  `_borrados.json`, `_config.json`) se valida (JSON + forma esperada) antes
  de usarlo; si falla no se aplica nada ni se guarda el eTag → reintento.
- `subirDia` ABORTA si no puede leer el archivo remoto entero antes del PUT
  (nunca sube «solo lo local», que podía encoger el archivo).
- Listado de carpeta paginado incompleto → no se toca el registro de sincro.
- Se usa el eTag del cuerpo de la respuesta, no solo el del listado.
- Firma de detección de cambios: 32 → ~53 bits (dos djb2). *Efecto único al
  actualizar:* resubida de todo con `unir()` (sin pérdida).
- `st.ultimoSyncOk` solo se sella si el ciclo entero fue limpio; si hubo un
  corte, icono ⚠️ + aviso en Ajustes «no se completó del todo (cobertura),
  nada estropeado, se reintenta».
- `localStorage` sigue siendo la fuente de verdad.

**F. LTV3 en la zona de Registro.** `CATS_REGISTRO` incluye `LTV` además de
ETC/LZB. La categoría/variante LTV3 ya existía en `TELEFONEMAS` con el
texto oficial (PDF pág. 32). Color indiferente (`rc`).
- **LZB:** revisado contra el PDF oficial (pág. 32) — LZB1–LZB5 **correctos**.
  Único hueco: LZB5 sin «Guía y uso» (pendiente de David).

**G. Fondo de color en las líneas de telefonema de Observaciones.** Un
backdrop invisible detrás del textarea pinta el fondo de cada línea; las de
telefonema (`"<CÓDIGO> · <hora> — ..."`) llevan el color del telefonema al
15% (verde/rosa). El textarea va transparente encima, 100% editable.
- `bulletearObs` ya NO toca las líneas de telefonema (antes las convertía en
  «• ETC1 · ...» y rompía detección + color).
- Reguardar un telefonema tras mover líneas por encima → lo localiza por su
  hora y actualiza en su sitio, sin duplicar.
- Se puede seguir escribiendo tras el telefonema con normalidad.

- Versiones: `enruta-v56` · `registro.js?v=202609040` · `registro.css?v=202609040`
  · `nube.js?v=202609040` · `CACHE enruta-rv-v52`.

---

### 2026-09-01 — Paso 26: turnos duplicados del mismo día — juntar (enruta-v55)

David: «en varios días se han duplicado los servicios al sincronizar con
Calendar; salen duplicados habiendo ya los originales… ha duplicado
muchísimos».

**Causa raíz:** la app es «un turno por día», pero cada turno lleva un id
aleatorio. Si se crea el turno del mismo día en la tablet Y en el móvil
antes de que sincronicen, la nube fusiona **por id** y quedan DOS turnos
para ese día → todos sus servicios aparecen duplicados. No lo provocó la
sincro de Calendar (esa reusa el turno existente); lo provocó tener dos
turnos-mismo-día con id distinto, que la nube nunca supo que eran el mismo.

- **`dedupeTurnos()`** — junta turnos con el mismo día (o días, en dormidas:
  clave = fechas ordenadas). Se queda el de **id menor** (determinista:
  tablet y móvil eligen el mismo) y vuelca el otro dentro: rellena huecos de
  toma/deje/descanso y **une los servicios** por nº de tren + fecha (o
  ruta+hora si no hay número). El turno sobrante deja **lápida** → se borra
  también en la nube y en el otro aparato.
- Se ejecuta: al arrancar la app (limpia el lío actual), después de cada
  fusión de la nube (`nubeAplicarDia`) y al final de cada sincronización.
- **`servicioYaExiste` / `gcalAplicarPropuestas`** ahora reconocen un
  servicio ya presente **por nº de tren + fecha** primero (clave estable),
  no solo por origen/destino/hora carácter a carácter — que fallaba cuando
  el turno venía de otro aparato por la nube y el texto no era idéntico.
- Idempotente: pasar dedupe otra vez sobre datos ya limpios no toca nada.
- Verificado en preview: 2 turnos mismo día (uno con más datos) → queda 1
  con los datos combinados + lápida del otro; dormida 20→21 con un servicio
  distinto en cada copia → queda 1 turno con los dos servicios reales.

- Versiones: `enruta-v55` · `registro.js?v=202609034` · `nube.js?v=202609034`
  · `CACHE enruta-rv-v47`.

---

### 2026-09-01 — Paso 25: borrados que se propagan (lápidas / tombstones) (enruta-v54)

David: «si borro un turno en un sitio, se tiene que borrar en todos. No
puede quedar huérfano en un dispositivo porque al sincronizar volvería».

- **Botón «Borrar turno» → lápida.** `NUBE.onTurnoBorrado(id)` deja
  `{ id: ts }` en `st.tombstones` (y limpia `turnoAt`/`turnoHash` de ese id).
- **Archivo compartido `EnRuta/_borrados.json`** = `{ id: ts, ... }` con
  todas las lápidas. Al sincronizar:
  - `bajarBorrados()` — trae las lápidas de otros dispositivos y las fusiona
    (gana el `ts` mayor).
  - `aplicarBorrados()` — quita de local los turnos con lápida (salvo que se
    hayan **editado después** de la marca de borrado → gana la edición, LWW).
  - `subirBorrados()` — sube las lápidas propias al archivo compartido.
- **`unir()`** (la unión antes de cada PUT de un día) ahora **descarta los
  ids con lápida**, así un turno borrado no puede volver a colarse en el
  archivo del día desde ningún dispositivo.
- **Día que queda vacío por un borrado explícito** → ahora SÍ se sube el
  archivo vacío (la lápida lo justifica). Un falso vacío (sin lápida) sigue
  sin tocar el archivo remoto (protección del Paso 22 intacta).
- **Convergencia:** al confirmarse que el archivo de un día ya no tiene el
  turno borrado, se suelta su `dayIndex` para no reintentar la limpieza en
  cada sincro. La lápida sigue viva en `st.tombstones` + `_borrados.json`.
- **`Borrar mis datos de la nube`** ahora también borra `_borrados.json` y
  vacía `st.tombstones`.
- Lápidas: no se recogen nunca (son minúsculas, `{id: ts}`). `ponytail:`
  añadir caducidad si el archivo pasa de unos pocos KB.
- «Sustituir» al importar copia NO genera lápidas (es una restauración
  local, no un borrado meditado turno a turno).

Verificado en preview: «Borrar turno» → el turno desaparece de
`rviryo_turnos_v1` y aparece `tombstones: { <id>: <ts> }` en
`rviryo_nube_v1`. La propagación por OneDrive (bajar/subir/unir) no se puede
probar en el preview — hace falta cuenta real; lógica revisada y sin errores
de sintaxis/consola.

- Versiones: `enruta-v54` · `registro.js?v=202609033` · `nube.js?v=202609033`
  · `CACHE enruta-rv-v46`.

---

### 2026-09-01 — Paso 24: auditoría de la sincro vs. cómo lo hacen otras apps (enruta-v53)

David: «revisa bien la lógica, que no dé fallos, mira cómo lo hacen otras
apps de guardado en la nube». Investigado (patrones offline-first: LWW por
registro, merge de cambios que no se pisan, tombstones para borrados,
reconciliar con el remoto ANTES de escribir). Encontrados y arreglados:

- **La subida podía ENCOGER el archivo de la nube.** Si un día pasaba de 2
  turnos a 1 en local (turno vaciado por error, `discardEmptyEdit`, un merge
  raro), el PUT sobrescribía el archivo remoto con el conjunto más pequeño y
  se perdía el turno también en la nube. Ahora `subirDia` **baja el archivo
  remoto y UNE por id antes de escribir** (`unir()`): solo añade / actualiza
  al más reciente, nunca quita un id. Igual que hacen los motores de sync
  serios.
- **Un turno creado en un dispositivo podía no llegar nunca a la nube.**
  Tras bajar, el día se marcaba como «sincronizado» con el estado local ya
  fusionado; si local tenía un turno que el archivo remoto no traía, el
  sync-up lo veía «limpio» y no lo subía hasta la siguiente edición. Ahora
  se guarda la **firma de lo que HAY en la nube** (no de lo local), así el
  día queda sucio y se sube. Con una **forma canónica común**
  (`REGISTRO.nube.canon`, misma normalización para local y remoto) para que
  no haya subidas/bajadas en bucle. Verificado: `canon` estable ante orden
  y ante repetición.
- **`rviryo_nube_v1` crecía sin límite.** Guardaba una copia del JSON entero
  de cada turno (`_json_<id>`) y de cada día. Con muchos turnos podía llenar
  `localStorage` → `save()` falla → **la causa raíz de la pérdida de datos**.
  Ahora guarda solo una **firma corta** (djb2) y **purga** turnos borrados.
- **Crear la carpeta `EnRuta` usaba `conflictBehavior: replace`.** Si la
  lectura previa fallaba por un fallo transitorio y la carpeta existía,
  `replace` la **borraba con todo dentro**. Cambiado a `fail` + releer.
- **412 (otro dispositivo escribió a la vez):** simplificado — como la unión
  ya trae lo remoto, solo se refresca el eTag y se reintenta; si el archivo
  ya no existe, se recrea.

Pendiente (no crítico, hablarlo): merge **por servicio** dentro de un turno
(hoy si se edita el MISMO turno en tablet y móvil gana el último, se pierde
lo del otro) y **tombstones** para que los borrados se propaguen entre
dispositivos (hoy un turno borrado en un aparato reaparece desde otro).

- Versiones: `enruta-v53` · `registro.js?v=202609032` · `nube.js?v=202609032`
  · `CACHE enruta-rv-v45`.

---

### 2026-09-01 — Paso 23: importar copia en modo «Combinar» (recuperar días perdidos) (enruta-v52)

David perdió los turnos del 27, 28 y 29 de agosto (borrados en la nube al
principio del OneDrive). Su copia exportada `rviryo-copia-2026-08-31.json`
SÍ tiene los 3 días intactos (2 turnos con todos los datos: N1, paradas,
PMR, observaciones, comprobaciones, toma/deje/descanso).

- **`importBackup` reescrito.** Antes solo «Restaurar» (borraba todo y ponía
  la copia). Ahora 3 botones:
  - **Combinar** (recomendado): añade los turnos de la copia que falten,
    recupera los que estén vacíos localmente (`isEmptyTurno` /
    `nServiciosConDatos`). NUNCA pisa ni borra un turno local con datos.
  - **Sustituir**: comportamiento antiguo (borra todo, deja solo la copia).
  - **Cancelar**.
- Verificado en preview: sembrado turno vacío `mtc4cp8ozffy0` + turno bueno
  `existing1`; importada la copia en Combinar → `mtc4cp8ozffy0` recuperado,
  `existing1` intacto, turno nuevo añadido. Sin errores.
- Pasos para David: Ajustes → Importar copia → elegir
  `rviryo-copia-2026-08-31.json` → **Combinar**.
- Versiones: `enruta-v52` · `registro.js?v=202609031` · `nube.js?v=202609031`
  · `CACHE enruta-rv-v44`.

---

### 2026-09-01 — Paso 22: revisión a fondo de TODA la lógica de guardado (enruta-v51)

David: "revisa bien la lógica del guardado, no se pueden perder datos".
Auditados todos los caminos que escriben/borran turnos. Cambios:

- **`isEmptyTurno` completo.** Antes NO contaba: `hSalida`, `hDestino`,
  `rSalida`, `rLlegDestino`, `maniobraNombre`, `servicioComercial2`,
  `horaLTV` de servicio, `s.pmr`, y de las paradas `hLleg`/`viajeros`/
  `asistencias`/`pmr`. Un turno con solo, p.ej., la hora de llegada o unos
  PMR se tomaba como "vacío" y `discardEmptyEdit` lo borraba al salir del
  editor. Ahora cualquier dato del usuario lo mantiene vivo. Extraído
  `isEmptyServicio` + `nServiciosConDatos`.
- **`save()` — salvaguarda `_deCache`.** Un turno marcado `_deCache` (relleno
  por Google Calendar, no persiste) que YA tiene datos que solo pone el
  usuario (`n1`, vía, rama, observaciones, comprobaciones, PMR, viajeros,
  incidencias — `tieneDatosDeUsuario()`) se "confirma" (`_deCache=false`)
  antes de filtrar, para que no se pierda si el flag se quedó sin limpiar.
- **`save()` — el fallo de `localStorage` ya NO se traga en silencio.** Si el
  almacenamiento está lleno/bloqueado, aviso al usuario (una vez).
- **`flushAutosave()` en `visibilitychange`/`pagehide`/`beforeunload`.** El
  autosave tiene 350 ms de retardo; si el navegador mataba la página (app a
  segundo plano, recarga del SW) antes, se perdía la última edición. Ahora se
  fuerza el guardado al cerrar/segundo plano. Verificado.
- **`nubeAplicarDia` — guarda reforzada.** No sustituye un turno local con
  datos por una versión de la nube que venga vacía O con menos servicios con
  datos.
- Versiones: `enruta-v51` · `registro.js?v=202609023` · `nube.js?v=202609023`
  · `CACHE enruta-rv-v43`.

### 2026-09-01 — Paso 21: PÉRDIDA DE DATOS en la sincro — arreglado (enruta-v50)

David: en 3 días se borraron datos de turnos. GRAVE.

**Causa:** `sincronizarBajar` en `nube.js` borraba turnos locales por AUSENCIA:
- Si el listado `/children` de OneDrive venía incompleto por un fallo
  transitorio, los archivos que faltaban se tomaban como "borrados" y se
  llamaba `fusionarDia(fecha, [], true)` → vaciaba esos días en local.
- Dentro de un día, un turno local que no venía en el archivo remoto y no
  estaba "sucio" se borraba (`removeIds`).

**Arreglo — la sincro es ahora SOLO ADITIVA. Nada puede borrar datos, ni en
local ni en la nube:**
- `fusionarDia` es **SOLO merge**: añade turnos nuevos y actualiza los que en
  la nube son más recientes. **NUNCA borra un turno local.** Fuera
  `borrarAusentes` y todo el `removeIds`.
- Archivo remoto que ya no está en el listado → NO se borra nada en local;
  solo se limpia el registro de sincro y, si el día sigue con turnos, el
  próximo sync-up **recrea el archivo**.
- **`subirDia` ya NUNCA borra ni vacía un archivo de OneDrive.** Si un día se
  queda sin turnos en local (falso vacío por `_deCache`, `discardEmptyEdit`,
  un merge previo...), el archivo remoto conserva su último contenido bueno.
  El ÚNICO sitio que borra archivos de OneDrive es el botón "Borrar mis datos
  de la nube".
- `nubeAplicarDia`: nunca sustituye un turno local CON DATOS por una versión
  de la nube que viene vacía.
- **`nubeSnapshot`**: copia local en `localStorage['rviryo_turnos_snap']` antes
  de cada fusión; solo se refresca si el estado actual no tiene menos turnos
  que la copia.
- **Contrapartida temporal:** borrar un turno YA NO se propaga entre
  dispositivos (reaparece en el otro hasta borrarlo también ahí). Se hará bien
  con "lápidas" explícitas, aparte. Prioridad ahora: cero pérdida de datos.

Recuperación de los datos ya perdidos: los archivos `turno-*.json` en la
carpeta EnRuta de OneDrive tienen **historial de versiones** (OneDrive web →
clic derecho en el archivo → Historial de versiones → Restaurar).

- Versiones: `enruta-v50` · `registro.js?v=202609022` · `nube.js?v=202609022`
  · `CACHE enruta-rv-v42`.

### 2026-09-01 — Paso 20: calendario en móvil (enruta-v49)

David: la pestaña Calendario en el móvil se descuadra y tiene scroll horizontal.

- **`.cal-grid`** → `repeat(7, minmax(0,1fr))` y **`.cal-day`** → `min-width:0` +
  `overflow:hidden` (restaurado). Sin esto, el texto sin envolver de los
  bloques de servicio ensanchaba las columnas y reventaba la rejilla → scroll
  horizontal (peor en móvil). Arreglado en móvil Y tablet.
- **En móvil** (`max-width: 620px`, helper `esMovil()`): `renderCalendar()`
  fuerza la **vista lista** (la rejilla del mes no cabe). En tablet/PC se
  respeta lo que elija el usuario. El botón de "vista cuadrícula" se oculta en
  móvil.
- Coherencia: en la vista lista, "Servicio N" → "Comercial N" (como ya se
  cambió en las celdas de la rejilla).
- Versiones: `enruta-v49` · `registro.js?v=202609021` · `registro.css?v=202609021`
  · `CACHE enruta-rv-v41`.

### 2026-08-31 — Paso 19: PMR en servicio manual + obs con mayúscula + N1 traslados + timeouts nube (enruta-v48)

1. **PMR en las tarjetas de estación del servicio manual:** el icono ♿↓/♿↑
   ahora se pinta también cuando el nombre de la estación es un `<input>`
   editable (antes solo salía junto al `<span>`). `stationCard` calcula
   `pmTags` una vez y lo añade en las dos ramas.
2. **Observaciones a mano:** la primera letra de cada línea `• ` va en
   MAYÚSCULA (`bulletearObs`).
3. **N1 vuelve a estar deshabilitado en traslados** (una maniobra no lleva N1).
   Sigue escribible en servicios comerciales normales y manuales.
4. **Icono de la nube «girando para siempre» — arreglado:**
   - `graph()`: `fetch` con `AbortController` + timeout de 25 s (una conexión
     caída a medias en un tren no rechaza sola).
   - `getToken()`: `acquireTokenSilent` con timeout de 12 s + `tokenEnCurso` se
     limpia siempre (antes, si se colgaba, bloqueaba TODA sincro futura).
   - `sincronizar()`: watchdog de 60 s que fuerza el fin pase lo que pase;
     `sincronizarBajar/Subir` con timeout de 45 s cada uno.

- Versiones: `enruta-v48` · `registro.js?v=202609020` · `nube.js?v=202609020`
  · `CACHE enruta-rv-v40`.

### 2026-08-31 — Paso 18: ajustes del servicio manual + «COMERCIAL» en calendario (enruta-v47)

1. Al crear servicio manual, la casilla Nº ya no aparece con «__MANUAL__»
   (el `<select>` lo metía por el evento `input`; se limpia en `doAutofillSrv`).
2. Nombres de estación escritos a mano → **MAYÚSCULAS** (blur handler para
   `.st-name-input` + `text-transform:uppercase` en CSS). Aplica también a las
   paradas nuevas de servicios normales.
3. Paradas de un servicio manual: además de horas editables, tienen el editor
   de **retrasos** como los servicios comerciales normales (se quitó
   `cfg.manual` del ternario retraso/⏱).
4. Calendario: en las celdas de los días, la etiqueta **«SERVICIO» → «COMERCIAL»**
   (traslados siguen igual).
- Versiones: `enruta-v47` · `?v=202609018` · `CACHE enruta-rv-v39`.

### 2026-08-31 — Paso 17: atajo «LTV» en Observaciones (enruta-v46)

- Nuevo atajo `ltv` (tras los dos Vmeta):
  «LTV a [X] km/h desde PK [X] al PK [X] por [estado de la vía / vientos /
  otros][ — detalle opcional]».
- Versiones: `enruta-v46` · `registro.js?v=202609017` · `CACHE enruta-rv-v38`.

### 2026-08-31 — Paso 16: crear servicio comercial manual (enruta-v45)

Cambio de editor, independiente de la nube.

- Opción **«✎ Crear servicio manual»** al final del desplegable Servicio
  Comercial. Al elegirla (`s.servicioManual = true`):
  - Aparece la casilla **Nº** a la derecha (un número, como los traslados).
  - **Origen, paradas intermedias y destino** con el nombre **editable** en su
    tarjeta.
  - Horas de llegada/salida editables en todas las estaciones (botón ⏱ = hora
    actual, sin campo de retraso, como en los traslados).
  - **Viajeros/asistencias** por estación (como un servicio normal — NO es un
    traslado: cuenta como servicio en Estadísticas, sin línea si la ruta no
    coincide con ninguna conocida).
- Nuevas props de `stationCard`: `editNombre` + `bindNombre` (nombre editable
  en cualquier tarjeta) y `manual` (UI de horas tipo traslado).
- `blankServicio` / `normTurno`: `s.servicioManual` (default false).
- `normTurno` ya no intenta emparejar con el Libro si `servicioManual`.
- `autofillServicio` / `autofillManiobra` limpian el flag; elegir otra opción
  del desplegable también.
- **N1 siempre escribible** (antes estaba deshabilitado en traslados).
- Versiones: `enruta-v45` · `registro.js?v=202609016` · `CACHE enruta-rv-v37`.

### 2026-08-31 — Paso 15: Observaciones a mano con viñeta «• » (enruta-v44)

- El texto escrito a mano en Observaciones ahora lleva «• » delante de cada
  línea, igual que los atajos.
  - **Enter** en el textarea inserta «\n• » (se ve al momento).
  - **Blur** (salir del campo) normaliza todas las líneas: quita cualquier
    viñeta previa (`• · * -`) y pone «• ». Líneas vacías se quedan vacías.
  - No duplica viñeta en las líneas que ya vienen de un atajo.
- Listeners nuevos en `init()` (`keydown` + `blur` capture), acotados a
  `textarea[data-bind="srv.N.observaciones"]`.
- Versiones: `enruta-v44` · `registro.js?v=202609015` · `CACHE enruta-rv-v36`.

### 2026-08-31 — Paso 14: dos traslados nuevos (enruta-v43)

- `RV_MANIOBRAS` (data.js): + «Chamartín - Fuencarral» y «Fuencarral -
  Chamartín» (`MADRID-CHAMARTIN-CLARA CAMP.` ↔ `FUENCARRAL`, sin paradas).
  Un solo número (la doble numeración sigue solo en Chamartín↔Atocha).
- Versiones: `enruta-v43` · `data.js?v=202609013` · `registro.js?v=202609014`
  · `CACHE enruta-rv-v35`.

### 2026-08-31 — Paso 13: PMR con dirección y cantidad en las estaciones (enruta-v42)

Cambio de editor, independiente de la nube.

- El icono ♿ de una estación ahora indica **dirección y cantidad**:
  - `♿↑` (verde) = PMR que **suben** ahí · `♿↓` (azul) = PMR que **bajan** ahí.
  - El **número** solo aparece si son **2 o más** (`♿↓2`). Uno solo → sin número.
  - Una estación puede mostrar los dos (unos suben, otros bajan).
- Helper `pmrEnEstacion(s, nombre, ownerIdx)` → `{suben, bajan}`. Cuenta
  `bajan` recorriendo `s.pmr` + todas las `parada.pmr` cuyo `baja` coincide
  (antes solo miraba `s.pmr`, así que un PMR que subía en una parada no se
  contaba en su bajada). `suben`: PMR dados de alta en esa estación.
- Sustituye `cfg.pmrBaja` / `.pmr-warn`. Estilos `.pmr-tag.baja` / `.sube`.

Versiones: `enruta-v42` · `?v=202609013` · `CACHE enruta-rv-v34`.

### 2026-08-31 — Paso 12: dos números en traslados Chamartín↔Atocha + atajo «Detenido ante…» (enruta-v41)

Cambios de editor, independientes de la nube.

- **(1) Dos números de traslado** en los traslados **Chamartín - Atocha** y
  **Atocha - Chamartín** (composición doble). Nuevo campo
  `s.servicioComercial2` (default '' en `blankServicio` y `normTurno`). En el
  editor, la columna «Nº» del traslado muestra **dos casillas apiladas a media
  altura** (`.svc-man-num-2`) solo para esas dos maniobras; el resto de
  traslados siguen con una. Helper `svcNumCombo(s)` → «1234 / 5678»; usado en
  celda del calendario, lista, título/colapsado del editor y PDF.
- **(2) Atajo de Observaciones** «Punto de parada» → renombrado **«Detenido
  ante…»** y añadido campo **Motivo (opcional)** al final:
  «Detenido ante la [Pantalla/Señal/PK] [nº], se reanuda la marcha con [min]
  min.[ Motivo: …]». Opción del select con label «Pantalla / Señal / PK».

Versiones: `enruta-v41` · `?v=202609012` · `CACHE enruta-rv-v33`.

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
