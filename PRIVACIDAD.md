# Privacidad — EnRuta RV

**Última actualización:** 2026-08-30

EnRuta RV es una aplicación web para el registro personal de viajes de
maquinistas. Funciona entera en tu dispositivo. No hay servidor propio ni base
de datos común.

## Dónde se guardan tus datos

- **En tu dispositivo (siempre):** todos tus turnos y ajustes se guardan en el
  almacenamiento local del navegador (`localStorage`). No salen de ahí salvo
  que tú actives alguna de las opciones de abajo.

- **Copia en archivos en el dispositivo (opcional):** si vinculas una carpeta,
  la app guarda además una copia de cada día como archivo en esa carpeta.

- **Copia en tu OneDrive (opcional):** si vinculas tu cuenta de Microsoft, la
  app guarda una copia de cada día (`turno-AAAA-MM-DD.json`) en la carpeta
  **«EnRuta»** de **tu** OneDrive. Sirve como copia de seguridad y para tener
  los mismos datos en varios dispositivos tuyos.
  - Los datos van directamente entre tu dispositivo y tu OneDrive. **No pasan
    por ningún servidor de EnRuta** (no existe).
  - **Solo tú** tienes acceso a esa carpeta. El desarrollador de EnRuta no
    puede ver, tratar ni borrar tus datos.
  - La app solo accede a su carpeta «EnRuta», no al resto de tu OneDrive.
  - El inicio de sesión lo gestiona Microsoft. EnRuta nunca ve tu contraseña.

- **Sincronización con Google Calendar (opcional, uso avanzado):** si la
  activas, la app lee (solo lectura) los eventos de tu calendario para ayudarte
  a rellenar turnos. El inicio de sesión lo gestiona Google.

## Qué datos hay

Los que tú introduces: turnos, servicios, horas, incidencias, observaciones y,
en Ajustes, tu nombre, teléfono de referencia e ID de empleado (se usan para
generar los informes de incidencia).

## Tus opciones

- **Borrar la copia de la nube:** Ajustes → «Copia en la nube» → «Borrar mis
  datos de la nube». Borra todos los archivos de la carpeta «EnRuta» de tu
  OneDrive y desvincula la cuenta. No toca los datos de tu dispositivo.
- **Desvincular sin borrar:** deja de sincronizar; los archivos ya subidos
  siguen en tu OneDrive.
- **Borrar todo en el dispositivo:** Ajustes → «Borrar todos los datos».
- También puedes borrar la carpeta «EnRuta» directamente desde OneDrive.

## Responsable

EnRuta RV es una herramienta desarrollada por un maquinista para uso entre
compañeros. Cada usuario es responsable de sus propios datos, que residen en su
dispositivo y, si lo activa, en su cuenta personal de OneDrive.
