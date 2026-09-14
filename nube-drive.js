/* nube-drive.js — Copia en la nube y sincronización multi-dispositivo con
 * Google Drive (EnRuta-RV). Alternativa a nube.js (OneDrive) — SOLO UNA de
 * las dos puede estar vinculada a la vez (ver guardas en vincular() de
 * ambos archivos); son mutuamente excluyentes a propósito, para no
 * duplicar subidas ni complicar qué copia manda.
 *
 * Mismo diseño que nube.js, adaptado a la API de Google Drive:
 *  - Un archivo por día: turno-AAAA-MM-DD.json, en la carpeta privada de la
 *    app (appDataFolder — Drive la da sola con el permiso drive.appdata, no
 *    aparece en el Drive normal del usuario, no hace falta crearla).
 *  - localStorage sigue siendo la fuente de verdad. Capa OPCIONAL encima.
 *
 * Login: OAuth de Google con refresh_token (acceso "offline"), para que sea
 * una vez y no re-pedir sesión como pasa con la sincro de Google Calendar.
 * Google solo da el refresh_token a cambio de un Client Secret, que NO
 * puede vivir en el navegador — por eso hace falta la única pieza de
 * servidor de todo el proyecto: api/drive-callback.js (cambia el "code" por
 * tokens) y api/drive-refresh.js (renueva el access_token en segundo plano,
 * sin que el usuario lo note — equivalente a acquireTokenSilent de MSAL).
 */
(function () {
  'use strict';

  var CLIENT_ID = '574775051169-elhagvcl5mosf3e3mds5gharkivnro31.apps.googleusercontent.com';
  var API_BASE = 'https://enruta-rv.vercel.app/api';
  var REDIRECT_URI = API_BASE + '/drive-callback';
  var SCOPE = 'https://www.googleapis.com/auth/drive.appdata openid email';
  var DRIVE = 'https://www.googleapis.com/drive/v3';
  var DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  var BORRADOS = '_borrados.json';
  var CONFIG = '_config.json';
  var K_NUBE = 'rviryo_nube_drive_v1';
  var SUBIDA_DEBOUNCE = 5000;

  function configurada() { return true; } // sin CLIENT_ID que activar/desactivar, va fijo

  // ── Estado persistente propio ───────────────────────────────────────────
  var st = load();
  function load() {
    try { return JSON.parse(localStorage.getItem(K_NUBE)) || {}; }
    catch (e) { return {}; }
  }
  function persist() {
    try { localStorage.setItem(K_NUBE, JSON.stringify(st)); } catch (e) {}
  }
  function ensureShape() {
    if (!st.fileIds) st.fileIds = {};       // {name: fileId de Drive}
    if (!st.fileHashes) st.fileHashes = {}; // {name: md5Checksum visto}
    if (!st.syncedDay) st.syncedDay = {};
    if (!st.turnoAt) st.turnoAt = {};
    if (!st.turnoHash) st.turnoHash = {};
    if (!st.dayIndex) st.dayIndex = {};
    if (!st.syncedDayAt) st.syncedDayAt = {};
    if (!st.tombstones) st.tombstones = {};
  }
  ensureShape();

  function firma(s) {
    s = (s == null) ? '' : String(s);
    var a = 5381, b = 52711, i = s.length, c;
    while (i) { c = s.charCodeAt(--i); a = (a * 33) ^ c; b = (b * 37) ^ c; }
    return ((a >>> 0).toString(16)) + ((b >>> 0).toString(16));
  }

  // ── Login / token ────────────────────────────────────────────────────────
  var accessToken = null, accessTokenExp = 0;
  var needsReconnect = false;
  var tokenEnCurso = null;

  function getToken() {
    if (tokenEnCurso) return tokenEnCurso;
    if (!st.refreshToken) return Promise.resolve(null);
    if (accessToken && Date.now() < accessTokenExp) return Promise.resolve(accessToken);
    tokenEnCurso = conTimeout(
      fetch(API_BASE + '/drive-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: st.refreshToken })
      }), 15000, 'refresh'
    ).then(function (r) {
      if (!r.ok) {
        needsReconnect = true;
        pintarBanner();
        return null;
      }
      return r.json().then(function (data) {
        accessToken = data.access_token;
        accessTokenExp = Date.now() + ((data.expires_in || 3600) - 60) * 1000;
        needsReconnect = false;
        return accessToken;
      });
    }).catch(function () { needsReconnect = true; pintarBanner(); return null; })
      .then(function (t) { tokenEnCurso = null; return t; });
    return tokenEnCurso;
  }

  function conTimeout(p, ms, etiqueta) {
    return Promise.race([
      p,
      new Promise(function (_, rej) {
        setTimeout(function () { rej(new Error('timeout ' + (etiqueta || ''))); }, ms);
      })
    ]);
  }

  // ── HTTP a Google Drive ──────────────────────────────────────────────────
  function drive(path, opts) {
    opts = opts || {};
    return getToken().then(function (tok) {
      if (!tok) return Promise.reject({ noToken: true });
      var h = opts.headers || {};
      h.Authorization = 'Bearer ' + tok;
      var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var tm = ac ? setTimeout(function () { ac.abort(); }, 25000) : null;
      return fetch(opts.base === 'upload' ? DRIVE_UPLOAD + path : DRIVE + path, {
        method: opts.method || 'GET', headers: h, body: opts.body,
        signal: ac ? ac.signal : undefined
      }).then(function (res) { if (tm) clearTimeout(tm); return res; })
        .catch(function (e) { if (tm) clearTimeout(tm); throw e; });
    });
  }
  function driveJson(path, opts) {
    return drive(path, opts).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) return r.text().then(function (b) { throw new Error('Drive ' + r.status + ': ' + b.slice(0, 200)); });
      if (r.status === 204) return {};
      return r.json();
    });
  }

  function fileName(fecha) { return 'turno-' + fecha + '.json'; }
  function fechaDeNombre(name) {
    var m = /^turno-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
    return m ? m[1] : null;
  }

  // Sube/crea contenido de un archivo por NOMBRE dentro de appDataFolder.
  // Si ya existe (st.fileIds[name]) se actualiza (PATCH media); si no, se
  // crea (POST multipart, único momento en que hace falta mandar metadata).
  function escribirArchivo(name, texto) {
    var id = st.fileIds[name];
    if (id) {
      return drive('/files/' + id + '?uploadType=media', {
        base: 'upload', method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }, body: texto
      });
    }
    var boundary = 'enruta' + Date.now();
    var meta = JSON.stringify({ name: name, parents: ['appDataFolder'] });
    var body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
      '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + texto +
      '\r\n--' + boundary + '--';
    return drive('/files?uploadType=multipart&fields=id,md5Checksum', {
      base: 'upload', method: 'POST',
      headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: body
    }).then(function (r) {
      return r.json ? r.clone().json().then(function (item) {
        if (item && item.id) st.fileIds[name] = item.id;
        return r;
      }).catch(function () { return r; }) : r;
    });
  }
  function leerArchivo(id) {
    return drive('/files/' + id + '?alt=media').then(function (r) {
      if (!r.ok) return null;
      return r.text();
    });
  }

  // ── Sincronización ──────────────────────────────────────────────────────
  var _applying = false;
  var subidaTimer = null;
  var syncEnCurso = false;
  var errorSubida = false;
  var syncIncompleto = false;

  function R() { return window.REGISTRO && window.REGISTRO.nube; }

  // BAJAR: lista los turno-*.json de appDataFolder, trae los que cambiaron
  // (por md5Checksum) y los fusiona en local. SOLO AÑADE/ACTUALIZA — nunca
  // borra turnos locales por ausencia en un listado incompleto.
  function sincronizarBajar() {
    return bajarConfig().then(bajarBorrados).then(aplicarBorrados).then(function () {
      var archivos = [];
      var listadoCompleto = true;
      function pagina(token) {
        var qs = 'spaces=appDataFolder&fields=nextPageToken,files(id,name,md5Checksum)&pageSize=200' +
          (token ? '&pageToken=' + encodeURIComponent(token) : '');
        return driveJson('/files?' + qs).then(function (res) {
          if (!res) { listadoCompleto = false; return; }
          (res.files || []).forEach(function (it) {
            if (fechaDeNombre(it.name)) archivos.push(it);
          });
          if (res.nextPageToken) return pagina(res.nextPageToken);
        }).catch(function () { listadoCompleto = false; });
      }
      return pagina(null).then(function () { return { archivos: archivos, completo: listadoCompleto }; });
    }).then(function (bundle) {
      var archivos = bundle.archivos;
      var listadoCompleto = bundle.completo;
      if (!listadoCompleto) syncIncompleto = true;
      var reg = R();
      if (!reg) return { altas: 0 };
      var nombresRemotos = {};
      var cadena = Promise.resolve();
      var totalAltas = 0;

      archivos.forEach(function (it) {
        nombresRemotos[it.name] = true;
        st.fileIds[it.name] = it.id;
        if (st.fileHashes[it.name] === it.md5Checksum) return; // sin cambios
        cadena = cadena.then(function () {
          return leerArchivo(it.id).then(function (txt) {
            if (!txt) { syncIncompleto = true; return; }
            var data;
            try { data = JSON.parse(txt); }
            catch (e) { syncIncompleto = true; return; }
            if (!data || !Array.isArray(data.turnos)) { syncIncompleto = true; return; }
            var fecha = data.fecha || fechaDeNombre(it.name);
            var remotos = data.turnos || [];
            var res = fusionarDia(fecha, remotos);
            totalAltas += res.altas;
            st.fileHashes[it.name] = it.md5Checksum;
            var canonRem = reg.canon ? reg.canon(fecha, remotos.map(quitarMeta)) : reg.diaJSON(fecha);
            st.syncedDay[fecha] = firma(canonRem);
            st.syncedDayAt[fecha] = Date.now();
            persist();
          }).catch(function () { syncIncompleto = true; });
        });
      });

      if (listadoCompleto) {
        Object.keys(st.fileIds).forEach(function (name) {
          if (nombresRemotos[name]) return;
          var fecha = fechaDeNombre(name);
          if (!fecha) return;
          delete st.fileIds[name];
          delete st.fileHashes[name];
          delete st.syncedDay[fecha];
          delete st.syncedDayAt[fecha];
        });
      }
      persist();
      return cadena.then(function () { return { altas: totalAltas }; });
    });
  }

  // Igual que en nube.js: añade turnos nuevos, actualiza los más recientes
  // de la nube (_cloudAt > local), NUNCA borra un turno local por su cuenta.
  function fusionarDia(fecha, remotos) {
    var reg = R();
    if (!reg) return { altas: 0 };
    var locales = reg.diaTurnos(fecha);
    var localById = {};
    locales.forEach(function (t) { localById[t.id] = t; });
    var upsert = [], altas = 0;
    (remotos || []).forEach(function (rt) {
      if (!rt || !rt.id) return;
      var rAt = rt._cloudAt || 0;
      var lAt = st.turnoAt[rt.id] || 0;
      var clean = quitarMeta(rt);
      if (!localById[rt.id]) { upsert.push(clean); altas++; st.turnoAt[rt.id] = rAt || Date.now(); st.dayIndex[rt.id] = fecha; }
      else if (rAt > lAt) { upsert.push(clean); st.turnoAt[rt.id] = rAt; st.dayIndex[rt.id] = fecha; }
    });
    if (!upsert.length) return { altas: 0 };
    _applying = true;
    try { reg.aplicarDia(upsert, []); } finally { _applying = false; }
    return { altas: altas };
  }

  function unir(remotos, locales) {
    var by = {};
    (remotos || []).forEach(function (t) { if (t && t.id) by[t.id] = t; });
    (locales || []).forEach(function (t) {
      if (!t || !t.id) return;
      var r = by[t.id];
      var rAt = (r && r._cloudAt) || 0;
      var lAt = st.turnoAt[t.id] || 0;
      if (!r || lAt >= rAt) by[t.id] = t;
    });
    Object.keys(by).forEach(function (id) {
      var tomb = st.tombstones[id];
      if (!tomb) return;
      var at = (by[id]._cloudAt) || st.turnoAt[id] || 0;
      if (at <= tomb) delete by[id];
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  function quitarMeta(t) {
    var c = {};
    Object.keys(t).forEach(function (k) { if (k !== '_cloudAt') c[k] = t[k]; });
    return c;
  }

  // SUBIR: por cada día sucio, PUT del archivo (unión con lo remoto antes de
  // escribir — Drive no tiene concurrencia condicional como el If-Match de
  // Graph, así que la unión previa es aquí la única red de seguridad contra
  // pisar un archivo que otro dispositivo tocó entre medias). Día sin
  // turnos → se deja vacío (con lápida) en vez de borrar el archivo.
  function sincronizarSubir() {
    var reg = R();
    if (!reg) return Promise.resolve();
    var fechas = {};
    reg.fechas().forEach(function (f) { fechas[f] = true; });
    Object.keys(st.syncedDay).forEach(function (f) { fechas[f] = true; });
    Object.keys(st.tombstones).forEach(function (id) {
      var f = st.dayIndex[id]; if (f) fechas[f] = true;
    });
    var cadena = Promise.resolve();
    Object.keys(fechas).forEach(function (fecha) {
      var actual = reg.diaJSON(fecha);
      var sincronizado = st.syncedDay[fecha];
      var lapida = Object.keys(st.tombstones).some(function (id) { return st.dayIndex[id] === fecha; });
      if (!lapida && sincronizado != null && firma(actual) === sincronizado) return;
      if (!lapida && actual == null && sincronizado == null) return;
      cadena = cadena.then(function () { return subirDia(fecha, actual); });
    });
    return cadena.then(subirBorrados).then(subirConfig);
  }

  function subirDia(fecha, jsonActual) {
    var reg = R();
    var name = fileName(fecha);
    var id = st.fileIds[name];
    var locales = jsonActual == null ? [] : (JSON.parse(jsonActual).turnos || []);
    var lapidaAqui = Object.keys(st.tombstones).some(function (i) { return st.dayIndex[i] === fecha; });
    if (!locales.length && !lapidaAqui) {
      delete st.syncedDay[fecha]; delete st.syncedDayAt[fecha]; persist();
      return Promise.resolve();
    }
    if (!locales.length && !id) {
      delete st.syncedDay[fecha]; delete st.syncedDayAt[fecha]; persist();
      return Promise.resolve();
    }
    var prep = id
      ? leerArchivo(id).then(function (txt) {
          if (!txt) throw new Error('no-leer-remoto');
          var rem;
          try { rem = JSON.parse(txt); } catch (e) { throw new Error('remoto-truncado'); }
          if (!rem || !Array.isArray(rem.turnos)) throw new Error('remoto-invalido');
          return unir(rem.turnos, locales);
        })
      : Promise.resolve(locales);

    return prep.then(function (turnosFinal) {
      var data = { fecha: fecha, turnos: turnosFinal };
      data.turnos.forEach(function (t) {
        if (!st.turnoAt[t.id]) st.turnoAt[t.id] = Date.now();
        st.dayIndex[t.id] = fecha;
        t._cloudAt = st.turnoAt[t.id];
      });
      var body = JSON.stringify(data, null, 2);
      return escribirArchivo(name, body).then(function (r) {
        if (!r || !r.ok) { errorSubida = true; return; }
        return r.json().then(function (item) {
          if (item && item.id) st.fileIds[name] = item.id;
          if (item && item.md5Checksum) st.fileHashes[name] = item.md5Checksum;
          fusionarDia(fecha, turnosFinal);
          var canonFinal = reg.canon ? reg.canon(fecha, turnosFinal.map(quitarMeta)) : jsonActual;
          st.syncedDay[fecha] = firma(canonFinal);
          st.syncedDayAt[fecha] = Date.now();
          st.ultima = Date.now();
          var enArchivo = {};
          turnosFinal.forEach(function (t) { enArchivo[t.id] = true; });
          Object.keys(st.tombstones).forEach(function (i) {
            if (st.dayIndex[i] === fecha && !enArchivo[i]) delete st.dayIndex[i];
          });
          persist();
        }).catch(function () {}); // PATCH media no siempre devuelve JSON útil; no crítico
      }).catch(function () { /* sin red: se reintenta luego */ });
    }).catch(function () { syncIncompleto = true; });
  }

  // ── Lápidas (borrados propagados) ───────────────────────────────────────
  function onTurnoBorrado(id) {
    if (!st.refreshToken || !id) return;
    st.tombstones[id] = Date.now();
    delete st.turnoHash[id];
    delete st.turnoAt[id];
    persist();
    clearTimeout(subidaTimer);
    subidaTimer = setTimeout(function () { sincronizar(true); }, 1500);
  }
  function archivoCompartidoLeer(name) {
    var id = st.fileIds[name];
    if (id) return leerArchivo(id).then(function (txt) { return { txt: txt, existe: true }; });
    return driveJson('/files?spaces=appDataFolder&fields=files(id,name)&q=' +
      encodeURIComponent("name='" + name + "'")).then(function (res) {
      var f = res && res.files && res.files[0];
      if (!f) return { txt: null, existe: false };
      st.fileIds[name] = f.id;
      return leerArchivo(f.id).then(function (txt) { return { txt: txt, existe: true }; });
    });
  }
  function bajarBorrados() {
    return archivoCompartidoLeer(BORRADOS).then(function (res) {
      if (!res.txt) return;
      var rem;
      try { rem = JSON.parse(res.txt); } catch (e) { syncIncompleto = true; return; }
      if (!rem || typeof rem !== 'object') { syncIncompleto = true; return; }
      Object.keys(rem).forEach(function (id) {
        var ts = rem[id] || 0;
        if (!st.tombstones[id] || ts > st.tombstones[id]) st.tombstones[id] = ts;
      });
      persist();
    }).catch(function () { syncIncompleto = true; });
  }
  function aplicarBorrados() {
    var reg = R();
    if (!reg || !reg.borrarIds) return;
    var quitar = [];
    Object.keys(st.tombstones).forEach(function (id) {
      var lAt = st.turnoAt[id] || 0;
      if (lAt > st.tombstones[id]) return;
      quitar.push(id);
    });
    if (!quitar.length) return;
    _applying = true;
    try { reg.borrarIds(quitar); } finally { _applying = false; }
  }
  var tombFirma = null;
  function subirBorrados() {
    if (!Object.keys(st.tombstones).length) return Promise.resolve();
    var f = firma(JSON.stringify(st.tombstones));
    if (f === tombFirma) return Promise.resolve();
    return archivoCompartidoLeer(BORRADOS).then(function (res) {
      var rem = {};
      if (res.txt) { try { rem = JSON.parse(res.txt) || {}; } catch (e) {} }
      var merged = {};
      Object.keys(rem).forEach(function (id) { merged[id] = rem[id]; });
      Object.keys(st.tombstones).forEach(function (id) {
        if (!merged[id] || st.tombstones[id] > merged[id]) merged[id] = st.tombstones[id];
      });
      st.tombstones = merged;
      return escribirArchivo(BORRADOS, JSON.stringify(merged)).then(function (rr) {
        if (rr && rr.ok) { tombFirma = firma(JSON.stringify(merged)); persist(); }
      });
    }).catch(function () {});
  }

  // ── Configuración (ajustes) ──────────────────────────────────────────────
  function bajarConfig() {
    return archivoCompartidoLeer(CONFIG).then(function (res) {
      if (!res.txt) return;
      var rem;
      try { rem = JSON.parse(res.txt); } catch (e) { syncIncompleto = true; return; }
      if (!rem || !rem.settings || typeof rem.settings !== 'object') { syncIncompleto = true; return; }
      var primeraVez = st.configAt == null;
      if (!primeraVez && !(rem.at > st.configAt)) return;
      var reg = R();
      var gcalKeys = rem.gcal && typeof rem.gcal === 'object' ? Object.keys(rem.gcal).length : 0;
      if (reg && reg.aplicarConfig) {
        _applying = true;
        try {
          reg.aplicarConfig(rem.settings, primeraVez);
          if (gcalKeys && reg.gcalSet) reg.gcalSet(rem.gcal);
        } finally { _applying = false; }
      }
      st.configAt = rem.at || Date.now();
      st.configFirma = firma(JSON.stringify(rem.settings) + '|' + (gcalKeys ? JSON.stringify(rem.gcal) : ''));
      persist();
    }).catch(function () { syncIncompleto = true; });
  }
  function subirConfig() {
    var reg = R();
    if (!reg || !reg.configParaSubir) return Promise.resolve();
    var local = reg.configParaSubir();
    var gcal = reg.gcalGet ? (reg.gcalGet() || {}) : {};
    var gcalKeys = Object.keys(gcal).length;
    var f = firma(JSON.stringify(local) + '|' + (gcalKeys ? JSON.stringify(gcal) : ''));
    if (f === st.configFirma) return Promise.resolve();
    var at = Math.max(Date.now(), (st.configAt || 0) + 1);
    var payload = { at: at, settings: local };
    if (gcalKeys) payload.gcal = gcal;
    return escribirArchivo(CONFIG, JSON.stringify(payload, null, 2)).then(function (r) {
      if (r && r.ok) { st.configAt = at; st.configFirma = f; persist(); }
    }).catch(function () {});
  }

  // ── Ciclo completo ───────────────────────────────────────────────────────
  var syncWatchdog = null;
  function terminarSync() {
    if (syncWatchdog) { clearTimeout(syncWatchdog); syncWatchdog = null; }
    if (!syncIncompleto && !errorSubida) st.ultimoSyncOk = Date.now();
    persist();
    syncEnCurso = false;
    pintarTarjeta();
  }
  function sincronizar(silencioso) {
    if (!st.refreshToken || syncEnCurso) return Promise.resolve();
    syncEnCurso = true;
    errorSubida = false;
    syncIncompleto = false;
    pintarBanner();
    if (syncWatchdog) clearTimeout(syncWatchdog);
    syncWatchdog = setTimeout(function () {
      errorSubida = true;
      terminarSync();
      console.warn('[nube-drive] sync watchdog: forzado fin a los 60 s');
    }, 60000);
    return conTimeout(sincronizarBajar(), 45000, 'bajar').then(function (res) {
      var reg0 = R();
      if (reg0 && reg0.dedupe) reg0.dedupe();
      return conTimeout(sincronizarSubir(), 45000, 'subir').then(function () {
        var reg = R();
        if (reg) reg.reRender();
        if (res && res.altas && !silencioso) {
          reg && reg.aviso(res.altas + ' turno' + (res.altas > 1 ? 's' : '') +
            ' recuperado' + (res.altas > 1 ? 's' : '') + ' de Google Drive.');
        }
      });
    }).catch(function (e) {
      if (e && !e.noToken) console.warn('[nube-drive] sync', e && e.message || e);
    }).then(terminarSync);
  }

  function onTurnosSaved(turnos) {
    if (!st.refreshToken || _applying) return;
    var vivos = {};
    turnos.forEach(function (t) {
      vivos[t.id] = true;
      var now = firma(JSON.stringify(quitarMeta(t)));
      if (st.turnoHash[t.id] !== now) {
        st.turnoAt[t.id] = Date.now();
        st.turnoHash[t.id] = now;
        (t.servicios || []).forEach(function (s) { if (s.fecha) st.dayIndex[t.id] = s.fecha; });
      }
    });
    Object.keys(st.turnoHash).forEach(function (id) { if (!vivos[id]) delete st.turnoHash[id]; });
    Object.keys(st.turnoAt).forEach(function (id) { if (!vivos[id]) delete st.turnoAt[id]; });
    Object.keys(st.dayIndex).forEach(function (id) { if (!vivos[id]) delete st.dayIndex[id]; });
    persist();
    clearTimeout(subidaTimer);
    subidaTimer = setTimeout(function () { sincronizar(true); }, SUBIDA_DEBOUNCE);
  }

  // ── UI ───────────────────────────────────────────────────────────────────
  function pintarBanner() { var reg = R(); if (reg && reg.pintarBanner) reg.pintarBanner(); }
  function pintarTarjeta() { var reg = R(); if (reg && reg.pintarAjustes) reg.pintarAjustes(); }

  function otraVinculada() {
    return !!(window.NUBE && window.NUBE.estaVinculada && window.NUBE.estaVinculada());
  }

  // ── Vinculación (llega la vuelta de Google por el fragmento de la URL) ──
  function procesarVueltaOAuth() {
    var h = location.hash || '';
    var m = /gdrive_refresh=([^&]+)/.exec(h);
    if (m) {
      st.refreshToken = decodeURIComponent(m[1]);
      var me = /gdrive_email=([^&]+)/.exec(h);
      if (me) st.correo = decodeURIComponent(me[1]);
      persist();
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      var reg = R();
      if (reg && reg.trasVincular) reg.trasVincular();
      sincronizar(false);
      return true;
    }
    var me = /gdrive_error=([^&]+)/.exec(h);
    if (me) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      console.warn('[nube-drive] error al vincular:', decodeURIComponent(me[1]));
    }
    return false;
  }

  window.NUBE_DRIVE = {
    disponible: configurada,
    estaVinculada: function () { return !!st.refreshToken; },
    necesitaReconectar: function () { return needsReconnect; },
    sincronizando: function () { return syncEnCurso; },
    correo: function () { return st.correo || ''; },
    ultimaCopia: function () { return st.ultima || 0; },
    aplicando: function () { return _applying; },
    onTurnosSaved: onTurnosSaved,
    onTurnoBorrado: onTurnoBorrado,
    onConfigSaved: function () {
      if (!st.refreshToken || _applying) return;
      clearTimeout(subidaTimer);
      subidaTimer = setTimeout(function () { sincronizar(true); }, SUBIDA_DEBOUNCE);
    },
    estado: function () {
      if (!st.refreshToken) return 'sin';
      if (needsReconnect) return 'reconectar';
      if (syncEnCurso) return 'sync';
      if (errorSubida || syncIncompleto) return 'error';
      return 'ok';
    },
    ultimoSyncOk: function () { return st.ultimoSyncOk || 0; },

    // Vincular (toque real del usuario). Con OneDrive ya vinculado, pide
    // confirmar el cambio primero — solo una nube activa a la vez.
    vincular: function () {
      function ir() {
        var ret = location.origin + location.pathname.replace(/[^/]*$/, '');
        var url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
          client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
          scope: SCOPE, access_type: 'offline', prompt: 'consent', state: ret
        });
        location.href = url;
      }
      if (otraVinculada()) {
        if (window.appModal) {
          appModal.confirm({
            title: 'Cambiar de nube',
            message: 'Ya tienes OneDrive vinculado. Solo puede haber una copia en la nube activa — ¿desvincular OneDrive y usar Google Drive?',
            buttons: [
              { label: 'Cancelar', value: false, kind: 'neutral' },
              { label: 'Cambiar a Drive', value: true, kind: 'primary' }
            ]
          }).then(function (ok) {
            if (!ok) return;
            window.NUBE.desvincular();
            ir();
          });
        }
        return;
      }
      ir();
    },
    reconectar: function () { needsReconnect = false; this.vincular(); },
    sincronizarAhora: function () { return sincronizar(false); },

    // Desvincular: deja de sincronizar, NO borra nada de Drive.
    desvincular: function () {
      st = {}; ensureShape(); persist();
      try { localStorage.removeItem(K_NUBE); } catch (e) {}
      st = {}; ensureShape();
      accessToken = null; accessTokenExp = 0;
      pintarTarjeta(); pintarBanner();
    },

    // Borrar mis datos de la nube: borra todos los turno-*.json de
    // appDataFolder. NO desvincula y NO toca nada en local.
    borrarDatosNube: function () {
      if (!st.refreshToken) return Promise.resolve();
      return driveJson('/files?spaces=appDataFolder&fields=files(id,name)&pageSize=200').then(function (res) {
        var borra = Promise.resolve();
        ((res && res.files) || []).forEach(function (it) {
          if (!fechaDeNombre(it.name) && it.name !== BORRADOS && it.name !== CONFIG) return;
          borra = borra.then(function () {
            return drive('/files/' + it.id, { method: 'DELETE' }).catch(function () {});
          });
        });
        return borra;
      }).then(function () {
        st.fileIds = {}; st.fileHashes = {}; st.syncedDay = {}; st.syncedDayAt = {};
        st.turnoAt = {}; st.turnoHash = {}; st.dayIndex = {}; st.tombstones = {};
        st.configAt = null; st.configFirma = null; st.ultima = 0;
        tombFirma = null;
        persist();
        pintarTarjeta();
      });
    },

    // Arranque: procesa la vuelta de Google si la hay, y si ya está
    // vinculado, sincroniza. Se llama desde registro.js init().
    init: function () {
      procesarVueltaOAuth();
      if (st.refreshToken) sincronizar(false);
    }
  };
})();
