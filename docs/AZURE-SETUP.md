# Registrar EnRuta en Azure (para la copia en OneDrive)

Esto se hace **una sola vez**. Al final tendrás un código (*Application client
ID*) que hay que pegar en `nube.js`. No cuesta dinero, no hace falta tarjeta.

Puedes hacerlo con **cualquier cuenta Microsoft** (personal o de empresa). Si
usas la de empresa y te dice que necesita permiso de un administrador, hazlo
con una personal — funciona igual.

---

## Pasos

1. Entra en **https://entra.microsoft.com** (o portal.azure.com → busca
   "Microsoft Entra ID"). Inicia sesión.

2. Menú izquierdo: **Identidad → Aplicaciones → Registros de aplicaciones**
   (*App registrations*). Botón **"+ Nuevo registro"** (*New registration*).

3. Rellena:
   - **Nombre:** `EnRuta`
   - **Tipos de cuenta admitidos:** marca
     **"Cuentas en cualquier directorio organizativo y cuentas personales de
     Microsoft"** (la 3ª opción). Así entran tanto las cuentas de empresa como
     las personales.
   - **URI de redirección:** en el desplegable elige **"Aplicación de una sola
     página (SPA)"** y escribe:
     `https://dalame-web.github.io/EnRuta-RV/`
   - Pulsa **Registrar**.

4. En la página de la app que se abre, copia el valor de
   **"Id. de aplicación (cliente)"** (*Application (client) ID*) — es un código
   tipo `12345678-abcd-1234-abcd-1234567890ab`.
   **→ Ese código es lo que tienes que pasarme.**

5. Menú izquierdo de la app: **Autenticación** (*Authentication*).
   - En **"Aplicación de una sola página (SPA)"**, pulsa **"Agregar URI"** y
     añade también, para poder probar en el ordenador:
     `http://localhost:8781/`
   - Guarda.

6. Menú izquierdo: **Permisos de API** (*API permissions*).
   - **"+ Agregar un permiso"** → **Microsoft Graph** → **Permisos delegados**.
   - Busca y marca estos cuatro:
     - `Files.ReadWrite.AppFolder`
     - `Files.ReadWrite`
     - `offline_access`
     - `User.Read`
   - **"Agregar permisos"**.
   - (No hace falta "Conceder consentimiento de administrador" — cada usuario
     dará su permiso al vincular. Si tú lo pulsas con tu cuenta y puedes, mejor.)

7. Ya está. Mándame el **Id. de aplicación (cliente)** del paso 4.

---

## Qué es este código y por qué es seguro que sea público

El *client ID* solo identifica a la app ante Microsoft. **No es una
contraseña.** No da acceso a nada por sí solo: cada maquinista tiene que
iniciar sesión con su cuenta y dar permiso, y la app solo podrá tocar **su
propia carpeta** de OneDrive (`Aplicaciones/EnRuta/`). Por eso puede ir escrito
en el código de la app sin problema.
