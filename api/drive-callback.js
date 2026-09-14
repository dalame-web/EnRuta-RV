// api/drive-callback.js — único paso que necesita un servidor de verdad: el
// intercambio del "code" de Google por un refresh_token (Google no lo da
// nunca a una app puramente cliente, hace falta el Client Secret, que no
// puede vivir en el navegador). Vercel lo publica solo como
// https://enruta-rv.vercel.app/api/drive-callback en cuanto este archivo
// está en el repo — sin crear ni conectar nada aparte.
//
// El refresh_token vuelve al navegador en el FRAGMENTO (#) de la URL de
// redirección, nunca en la query string ni guardado aquí: los fragmentos no
// se mandan a ningún servidor, así que es el sitio seguro para pasarlo del
// servidor sin estado a localStorage del navegador (nube-drive.js lo lee y
// lo borra de la URL al vuelo).
//
// El Client Secret vive SOLO en la variable de entorno de Vercel
// GOOGLE_DRIVE_CLIENT_SECRET — nunca en este código ni en el repo.

var CLIENT_ID = '574775051169-elhagvcl5mosf3e3mds5gharkivnro31.apps.googleusercontent.com';
var REDIRECT_URI = 'https://enruta-rv.vercel.app/api/drive-callback';

// A dónde volver tras vincular — SIEMPRE una de estas dos, nunca lo que
// venga en `state` sin validar (evita que alguien use este endpoint como
// redirector abierto hacia cualquier sitio).
var RETORNOS_PERMITIDOS = [
  'https://dalame-web.github.io/EnRuta-RV/',
  'https://enruta-rv.vercel.app/'
];

function retornoValido(state) {
  return RETORNOS_PERMITIDOS.indexOf(state) !== -1 ? state : RETORNOS_PERMITIDOS[0];
}

module.exports = async function handler(req, res) {
  var state = typeof req.query.state === 'string' ? req.query.state : '';
  var retorno = retornoValido(state);

  if (req.query.error) {
    res.writeHead(302, { Location: retorno + '#gdrive_error=' + encodeURIComponent(String(req.query.error)) });
    res.end();
    return;
  }
  var code = req.query.code;
  if (!code || typeof code !== 'string') {
    res.status(400).send('Falta el parámetro code.');
    return;
  }

  try {
    var params = new URLSearchParams({
      code: code,
      client_id: CLIENT_ID,
      client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || '',
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code'
    });
    var r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    var data = await r.json();
    if (!r.ok || !data.refresh_token) {
      // Sin refresh_token: normalmente porque Google ya había dado consentimiento
      // antes y no repite el refresh_token salvo con prompt=consent (que el
      // cliente ya pide siempre al iniciar el enlace) — o un fallo real.
      var motivo = (data && (data.error_description || data.error)) || 'sin_refresh_token';
      res.writeHead(302, { Location: retorno + '#gdrive_error=' + encodeURIComponent(motivo) });
      res.end();
      return;
    }
    res.writeHead(302, { Location: retorno + '#gdrive_refresh=' + encodeURIComponent(data.refresh_token) });
    res.end();
  } catch (e) {
    res.writeHead(302, { Location: retorno + '#gdrive_error=' + encodeURIComponent('excepcion') });
    res.end();
  }
};
