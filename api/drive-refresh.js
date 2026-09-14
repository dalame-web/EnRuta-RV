// api/drive-refresh.js — cambia un refresh_token (guardado en el navegador,
// localStorage) por un access_token nuevo de ~1h. Se llama en segundo plano
// cada vez que hace falta un token y el que había caducó — el usuario nunca
// lo nota, no hay ventana ni toque de por medio (equivalente a lo que hace
// MSAL con acquireTokenSilent para OneDrive).
//
// La app real vive en GitHub Pages, no en este mismo dominio de Vercel —
// hace falta CORS explícito (restringido a los orígenes conocidos, no "*":
// esto mueve un refresh_token, aunque solo dé acceso a la carpeta privada
// de la app en Drive).

var ORIGENES_PERMITIDOS = [
  'https://dalame-web.github.io',
  'https://enruta-rv.vercel.app'
];
var CLIENT_ID = '574775051169-elhagvcl5mosf3e3mds5gharkivnro31.apps.googleusercontent.com';

module.exports = async function handler(req, res) {
  var origin = req.headers.origin;
  if (ORIGENES_PERMITIDOS.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }

  var body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  var refreshToken = body && body.refresh_token;
  if (!refreshToken || typeof refreshToken !== 'string') {
    res.status(400).json({ error: 'falta_refresh_token' });
    return;
  }

  try {
    var params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || '',
      grant_type: 'refresh_token'
    });
    var r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    var data = await r.json();
    if (!r.ok) {
      // invalid_grant = el refresh_token ya no vale (revocado, o caducado si
      // la app se quedó en modo "Prueba" en Google Cloud Console — hay que
      // publicarla en producción para que dure) → el cliente lo interpreta
      // como "hace falta volver a vincular".
      res.status(r.status).json({ error: data.error || 'error_google', detalle: data.error_description || '' });
      return;
    }
    res.status(200).json({ access_token: data.access_token, expires_in: data.expires_in || 3600 });
  } catch (e) {
    res.status(500).json({ error: 'excepcion' });
  }
};
