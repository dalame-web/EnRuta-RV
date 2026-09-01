/* nube.js — Copia en la nube y sincronización multi-dispositivo (EnRuta-RV)
 *
 * Cada maquinista guarda sus turnos en SU propio OneDrive, en la carpeta
 * "EnRuta" (la crea la app, nunca archivos sueltos en la raíz). Un archivo
 * por día: turno-AAAA-MM-DD.json — mismo formato que el espejo local en
 * archivos (writeDayFile de registro.js).
 *
 * localStorage sigue siendo la fuente de verdad. Esto es una capa OPCIONAL
 * encima: sin sesión, la app funciona igual que siempre. Si msal-browser.min.js
 * no cargó (primera vez sin red), este módulo se queda callado.
 *
 * Login: MSAL.js (Microsoft Authentication Library), flujo redirect (el que
 * funciona en móvil/PWA). Token de acceso ~1 h, se renueva solo mientras haya
 * sesión de Microsoft en el navegador (~24 h sin usar la app; pasado eso, un
 * toque en "Reconectar").
 *
 * NO hay servidor. El client ID va escrito abajo (no es secreto: solo
 * identifica la app; cada usuario da su permiso y la app solo toca su carpeta).
 */
(function () {
  'use strict';

  // ── Configuración ────────────────────────────────────────────────────────
  // Client ID de la app registrada en Azure (Entra ID). Público a propósito.
  // Vacío = función desactivada (no sale ni la tarjeta ni el aviso).
  var CLIENT_ID = '1815cec1-b40a-41d6-94fa-136337db1dda';

  var SCOPES = ['Files.ReadWrite', 'User.Read'];
  var FOLDER = 'EnRuta';
  var BORRADOS = '_borrados.json'; // lápidas: { id: ts } — borrados que hay que propagar
  var CONFIG = '_config.json';     // { at: ts, settings: {...} } — ajustes del usuario
  var GRAPH = 'https://graph.microsoft.com/v1.0';
  var K_NUBE = 'rviryo_nube_v1';
  var SUBIDA_DEBOUNCE = 5000;

  function configurada() { return !!CLIENT_ID && !!window.msal; }

  // ── Estado persistente propio (no toca settings ni turnos) ───────────────
  //  { linked, folderId, cuenta, fileEtags:{name:etag}, syncedDay:{fecha:json},
  //    turnoAt:{id:ts}, dayIndex:{id:fecha}, syncedDayAt:{fecha:ts}, ultima }
  var st = load();
  function load() {
    try { return JSON.parse(localStorage.getItem(K_NUBE)) || {}; }
    catch (e) { return {}; }
  }
  function persist() {
    try { localStorage.setItem(K_NUBE, JSON.stringify(st)); } catch (e) {}
  }
  function ensureShape() {
    if (!st.fileEtags) st.fileEtags = {};
    if (!st.syncedDay) st.syncedDay = {};   // {fecha: firma del JSON en la nube}
    if (!st.turnoAt) st.turnoAt = {};       // {id: ts de la última edición}
    if (!st.turnoHash) st.turnoHash = {};   // {id: firma del contenido}
    if (!st.dayIndex) st.dayIndex = {};
    if (!st.syncedDayAt) st.syncedDayAt = {};
    if (!st.tombstones) st.tombstones = {}; // {id: ts} — turnos borrados (lápidas)
  }
  ensureShape();

  // Firma determinista de un texto. Se guarda en vez del JSON entero para que
  // rviryo_nube_v1 no crezca sin límite (una copia de cada turno + cada día
  // llenaba localStorage → save() fallaba → PÉRDIDA DE DATOS).
  // Dos djb2 con semillas distintas → ~53 bits: colisión (= un cambio visto
  // como "sin cambios" y no subido) prácticamente imposible.
  function firma(s) {
    s = (s == null) ? '' : String(s);
    var a = 5381, b = 52711, i = s.length, c;
    while (i) { c = s.charCodeAt(--i); a = (a * 33) ^ c; b = (b * 37) ^ c; }
    return ((a >>> 0).toString(16)) + ((b >>> 0).toString(16));
  }

  // ── MSAL ─────────────────────────────────────────────────────────────────
  var msalApp = null;
  var cuenta = null;           // AccountInfo activa
  var listo = false;           // init() terminó
  var needsReconnect = false;  // token caducado sin sesión → hace falta un toque
  var tokenEnCurso = null;     // guard anti-solapamiento

  function redirectUri() {
    // La página tal cual se sirve (con / final). Debe coincidir con lo
    // registrado en Azure. GitHub Pages: https://dalame-web.github.io/EnRuta-RV/
    var p = location.pathname.replace(/[^/]*$/, '');
    return location.origin + p;
  }

  function initMsal() {
    if (msalApp) return Promise.resolve();
    msalApp = new msal.PublicClientApplication({
      auth: {
        clientId: CLIENT_ID,
        authority: 'https://login.microsoftonline.com/common',
        redirectUri: redirectUri()
      },
      cache: { cacheLocation: 'localStorage', temporaryCacheLocation: 'localStorage' }
    });
    return msalApp.initialize();
  }

  // Token de acceso silencioso. null si hace falta interacción (→ banner).
  function getToken() {
    if (tokenEnCurso) return tokenEnCurso;
    tokenEnCurso = Promise.resolve().then(function () {
      if (!cuenta) return null;
      // Timeout: si acquireTokenSilent se cuelga (iframe bloqueado, red
      // caída) la promesa nunca resolvía y tokenEnCurso quedaba pendiente
      // PARA SIEMPRE, bloqueando toda sincro futura (y el icono girando).
      return conTimeout(
        msalApp.acquireTokenSilent({ scopes: SCOPES, account: cuenta }),
        12000, 'token'
      )
        .then(function (r) { needsReconnect = false; return r.accessToken; })
        .catch(function (e) {
          needsReconnect = true;
          pintarBanner();
          return null;
        });
    }).then(function (t) { tokenEnCurso = null; return t; })
      .catch(function () { tokenEnCurso = null; return null; });
    return tokenEnCurso;
  }

  // Promise.race con un rechazo por tiempo — para que nada se quede colgado.
  function conTimeout(p, ms, etiqueta) {
    return Promise.race([
      p,
      new Promise(function (_, rej) {
        setTimeout(function () { rej(new Error('timeout ' + (etiqueta || ''))); }, ms);
      })
    ]);
  }

  // ── HTTP a Microsoft Graph ──────────────────────────────────────────────
  function graph(path, opts) {
    opts = opts || {};
    return getToken().then(function (tok) {
      if (!tok) return Promise.reject({ noToken: true });
      var h = opts.headers || {};
      h.Authorization = 'Bearer ' + tok;
      if (opts.json !== undefined) {
        h['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(opts.json);
      }
      // AbortController: si la conexión se cae a medias (típico en un tren),
      // fetch no rechaza nunca por su cuenta. Se aborta a los 25 s.
      var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var tm = ac ? setTimeout(function () { ac.abort(); }, 25000) : null;
      return fetch(GRAPH + path, {
        method: opts.method || 'GET',
        headers: h,
        body: opts.body,
        signal: ac ? ac.signal : undefined
      }).then(function (res) { if (tm) clearTimeout(tm); return res; })
        .catch(function (e) { if (tm) clearTimeout(tm); throw e; });
    });
  }
  function graphJson(path, opts) {
    return graph(path, opts).then(function (r) {
      if (r.status === 404) return null;
      if (!r.ok) return r.text().then(function (b) {
        throw new Error('Graph ' + r.status + ': ' + b.slice(0, 200));
      });
      if (r.status === 204) return {};
      return r.json();
    });
  }

  // ── Carpeta EnRuta ──────────────────────────────────────────────────────
  function ensureFolder() {
    if (st.folderId) return Promise.resolve(st.folderId);
    return graphJson('/me/drive/root:/' + FOLDER).then(function (item) {
      if (item && item.id) { st.folderId = item.id; persist(); return item.id; }
      // No existe → crearla. conflictBehavior 'fail' (NUNCA 'replace': si la
      // lectura de arriba falló por un fallo transitorio y la carpeta SÍ
      // existe, 'replace' la borraría con todos los turnos dentro).
      return graph('/me/drive/root/children', {
        method: 'POST',
        json: { name: FOLDER, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }
      }).then(function (r) {
        if (r.ok) return r.json().then(function (nw) {
          st.folderId = nw.id; persist(); return nw.id;
        });
        // 409 u otro: probablemente ya existía → releer.
        return graphJson('/me/drive/root:/' + FOLDER).then(function (it2) {
          if (it2 && it2.id) { st.folderId = it2.id; persist(); return it2.id; }
          throw new Error('no se pudo crear/abrir la carpeta ' + FOLDER);
        });
      });
    });
  }

  function fileName(fecha) { return 'turno-' + fecha + '.json'; }
  function fechaDeNombre(name) {
    var m = /^turno-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
    return m ? m[1] : null;
  }

  // ── Sincronización ──────────────────────────────────────────────────────
  var _applying = false;
  var subidaTimer = null;
  var syncEnCurso = false;

  function R() { return window.REGISTRO && window.REGISTRO.nube; }

  // BAJAR: lista los turno-*.json de la carpeta, trae los que cambiaron y los
  // fusiona en local. SOLO AÑADE / ACTUALIZA — NUNCA borra turnos locales.
  // (Un listado incompleto de OneDrive por un fallo transitorio hacía que la
  //  app creyera que se habían borrado archivos y vaciara esos días en local
  //  → pérdida de datos. Ya no.)
  function sincronizarBajar() {
    return ensureFolder().then(function (fid) {
      // Primero la config (ajustes) y las lápidas de otros dispositivos:
      // aplicar borrados en local ANTES de bajar los días (así no reaparece
      // nada ya borrado).
      return bajarConfig()
        .then(bajarBorrados)
        .then(function () { aplicarBorrados(); return fid; });
    }).then(function (fid) {
      var archivos = [];
      var listadoCompleto = true;
      function pagina(url) {
        return graphJson(url).then(function (res) {
          if (!res) { listadoCompleto = false; return; }
          (res.value || []).forEach(function (it) {
            if (it.file && fechaDeNombre(it.name)) archivos.push(it);
          });
          if (res['@odata.nextLink']) {
            return pagina(res['@odata.nextLink'].replace(GRAPH, ''));
          }
        }).catch(function () { listadoCompleto = false; });
      }
      return pagina('/me/drive/items/' + fid +
        '/children?$select=id,name,eTag,file&$top=200').then(function () {
        return { archivos: archivos, completo: listadoCompleto };
      });
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
        if (st.fileEtags[it.name] === it.eTag) return; // sin cambios
        cadena = cadena.then(function () {
          var etagBody = null;
          return graph('/me/drive/items/' + it.id + '/content').then(function (r) {
            if (!r || !r.ok) { syncIncompleto = true; return null; }
            etagBody = r.headers && r.headers.get && r.headers.get('ETag');
            return r.text();
          }).then(function (txt) {
            // Sin cuerpo, o el corte de red dejó algo a medias → NO se aplica
            // NADA y NO se guarda el eTag: se reintenta en la próxima sincro.
            if (!txt) { syncIncompleto = true; return; }
            var data;
            try { data = JSON.parse(txt); }
            catch (e) { syncIncompleto = true; return; } // JSON truncado
            if (!data || !Array.isArray(data.turnos)) { syncIncompleto = true; return; }
            // Si el archivo cambió entre el listado y esta descarga, el eTag
            // del cuerpo manda; si no lo tenemos, usamos el del listado.
            var etagReal = etagBody || it.eTag;
            var fecha = data.fecha || fechaDeNombre(it.name);
            var remotos = data.turnos || [];
            var res = fusionarDia(fecha, remotos);
            totalAltas += res.altas;
            st.fileEtags[it.name] = etagReal;
            // Firma de lo que HAY en la nube ahora (no de lo que quede en local
            // tras fusionar). Si local tiene turnos que este archivo no trae,
            // el día queda "sucio" y sync-up los sube — un turno creado en un
            // dispositivo llega a la nube aunque otro escribiera el archivo
            // primero. Misma normalización que diaJSON → sin ping-pong.
            var canonRem = reg.canon
              ? reg.canon(fecha, remotos.map(quitarMeta))
              : reg.diaJSON(fecha);
            st.syncedDay[fecha] = firma(canonRem);
            st.syncedDayAt[fecha] = Date.now();
            persist();
          }).catch(function () {
            // Corte de red a media descarga: este archivo se reintenta en la
            // próxima sincro; los demás siguen procesándose.
            syncIncompleto = true;
          });
        });
      });

      // Archivo que ya no está en la carpeta remota: NO se borra NADA en
      // local. Solo se limpia el registro de sincro; si aquí seguimos
      // teniendo turnos de ese día, el próximo sync-up vuelve a crear el
      // archivo (recupera de un borrado accidental).
      // SOLO si el listado se descargó ENTERO — con un listado a medias por
      // mala cobertura no se toca nada del registro de sincro.
      if (listadoCompleto) {
        Object.keys(st.fileEtags).forEach(function (name) {
          if (nombresRemotos[name]) return;
          var fecha = fechaDeNombre(name);
          if (!fecha) return;
          delete st.fileEtags[name];
          delete st.syncedDay[fecha];
          delete st.syncedDayAt[fecha];
        });
      }
      persist();

      return cadena.then(function () { return { altas: totalAltas }; });
    });
  }

  // Fusiona la lista de turnos remotos de un día con lo local, por id de
  // turno. SOLO añade turnos nuevos y actualiza los que en la nube son más
  // recientes (_cloudAt > local). NUNCA borra un turno local.
  // (La propagación de borrados entre dispositivos se hará aparte, con
  //  "lápidas" explícitas — nunca por ausencia.)
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
    try { reg.aplicarDia(upsert, []); }
    finally { _applying = false; }
    return { altas: altas };
  }

  // SUBIR: por cada día sucio (su JSON canónico difiere del último sincronizado)
  // PUT del archivo con If-Match. Día sin turnos → DELETE.
  function sincronizarSubir() {
    var reg = R();
    if (!reg) return Promise.resolve();
    return ensureFolder().then(function () {
      var fechas = {};
      reg.fechas().forEach(function (f) { fechas[f] = true; });
      Object.keys(st.syncedDay).forEach(function (f) { fechas[f] = true; });
      // Días con un borrado pendiente (para vaciar/limpiar su archivo remoto).
      Object.keys(st.tombstones).forEach(function (id) {
        var f = st.dayIndex[id]; if (f) fechas[f] = true;
      });

      var cadena = Promise.resolve();
      Object.keys(fechas).forEach(function (fecha) {
        var actual = reg.diaJSON(fecha); // null si el día ya no tiene turnos
        var sincronizado = st.syncedDay[fecha];
        var lapida = Object.keys(st.tombstones).some(function (id) { return st.dayIndex[id] === fecha; });
        if (!lapida && sincronizado != null && firma(actual) === sincronizado) return; // no sucio
        if (!lapida && actual == null && sincronizado == null) return; // día vacío nunca subido
        cadena = cadena.then(function () { return subirDia(fecha, actual); });
      });
      // Y por último, propagar nuestras lápidas y la config al archivo compartido.
      return cadena.then(subirBorrados).then(subirConfig);
    });
  }

  function subirDia(fecha, jsonActual, esReintento) {
    var reg = R();
    var name = fileName(fecha);
    var etag = st.fileEtags[name];

    var locales = jsonActual == null ? [] : (JSON.parse(jsonActual).turnos || []);

    // Día vacío en local. Solo se propaga como vacío si hay una LÁPIDA que lo
    // justifique (un borrado explícito). Si es un falso vacío (un turno
    // filtrado por _deCache, un discardEmptyEdit, un merge previo...) NO se
    // toca el archivo remoto — conserva su contenido bueno.
    var lapidaAqui = Object.keys(st.tombstones).some(function (id) {
      return st.dayIndex[id] === fecha;
    });
    if (!locales.length && !lapidaAqui) {
      delete st.syncedDay[fecha];
      delete st.syncedDayAt[fecha];
      persist();
      return Promise.resolve();
    }
    if (!locales.length && !etag) {
      // nada local, nada remoto que limpiar
      delete st.syncedDay[fecha]; delete st.syncedDayAt[fecha]; persist();
      return Promise.resolve();
    }

    // Si el archivo ya existe, traer su contenido y UNIR antes de escribir.
    // Así NUNCA se sube un subconjunto que borre del archivo un turno que
    // otro dispositivo puso ahí (o uno que aquí se quedó vacío por error).
    // La unión solo AÑADE / actualiza al más reciente — nunca quita.
    // BLINDAJE: si el archivo existe pero NO se puede leer entero (corte de
    // red), se ABORTA la subida de este día — NUNCA se sube "solo lo local",
    // que podría encoger el archivo. Se reintenta en la próxima sincro.
    var prep = etag
      ? graph('/me/drive/items/' + st.folderId + ':/' + name + ':/content')
          .then(function (rr) {
            if (!rr || !rr.ok) throw new Error('no-leer-remoto');
            return rr.text();
          })
          .then(function (txt) {
            var rem;
            try { rem = JSON.parse(txt); }
            catch (e) { throw new Error('remoto-truncado'); }
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

      var hdr = {};
      if (etag) hdr['If-Match'] = etag;
      else hdr['If-None-Match'] = '*'; // crear solo si no existe

      return graph('/me/drive/items/' + st.folderId + ':/' + name + ':/content', {
        method: 'PUT', headers: hdr, body: body
      }).then(function (r) {
        if (r.status === 412 && !esReintento) {
          // Otro dispositivo escribió este día entre medias. La unión de arriba
          // ya trae lo remoto; solo hace falta el eTag nuevo y reintentar.
          return graphJson('/me/drive/items/' + st.folderId + ':/' + name)
            .then(function (meta) {
              if (meta && meta.eTag) st.fileEtags[name] = meta.eTag;
              else delete st.fileEtags[name]; // el archivo ya no existe → recrear
              return subirDia(fecha, reg.diaJSON(fecha), true);
            });
        }
        if (!r.ok) {
          // 5xx / 4xx (que no sea 412) = error real → se marca para el icono.
          // Sin red (fetch rechaza, va al .catch) NO se marca: es normal en un
          // tren y se reintenta solo.
          errorSubida = true;
          return;
        }
        return r.json().then(function (item) {
          st.fileEtags[name] = item.eTag;
          // Fusionar en local lo que la unión trajera de la nube y guardar la
          // firma de lo que ha quedado escrito → local y nube convergen.
          fusionarDia(fecha, turnosFinal);
          var canonFinal = reg.canon
            ? reg.canon(fecha, turnosFinal.map(quitarMeta))
            : jsonActual;
          st.syncedDay[fecha] = firma(canonFinal);
          st.syncedDayAt[fecha] = Date.now();
          st.ultima = Date.now();
          // Borrado ya propagado a este archivo: soltar el dayIndex para no
          // reintentar la limpieza en cada sincro (la lápida sigue viva en
          // st.tombstones y en _borrados.json).
          var enArchivo = {};
          turnosFinal.forEach(function (t) { enArchivo[t.id] = true; });
          Object.keys(st.tombstones).forEach(function (id) {
            if (st.dayIndex[id] === fecha && !enArchivo[id]) delete st.dayIndex[id];
          });
          persist();
        });
      }).catch(function () { /* sin red: se reintenta luego, sin marcar error */ });
    }).catch(function () {
      // No se pudo leer el archivo remoto entero antes de subir → subida
      // abortada para este día (nunca se sube algo que pueda encogerlo).
      syncIncompleto = true;
    });
  }

  // Unión de dos listas de turnos por id: añade los que falten, se queda con el
  // más reciente (_cloudAt remoto vs turnoAt local) y QUITA los que tienen
  // lápida (borrados) — salvo que se hayan editado después de borrarse.
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
      if (at <= tomb) delete by[id]; // borrado y no reeditado después → fuera
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  // ── Lápidas (borrados que se propagan a todos los dispositivos) ─────────
  // Un turno borrado en un aparato deja una lápida { id: ts }. Se guarda en
  // EnRuta/_borrados.json (compartido). Al sincronizar: se bajan las lápidas
  // de los demás, se aplican en local, y se suben las propias. unir() impide
  // que un turno con lápida vuelva a colarse en un archivo de día.
  function onTurnoBorrado(id) {
    if (!configurada() || !id) return;
    st.tombstones[id] = Date.now();
    delete st.turnoHash[id];
    delete st.turnoAt[id];
    persist();
    if (cuenta) {
      clearTimeout(subidaTimer);
      subidaTimer = setTimeout(function () { sincronizar(true); }, 1500);
    }
  }

  function bajarBorrados() {
    return graph('/me/drive/items/' + st.folderId + ':/' + BORRADOS + ':/content')
      .then(function (r) {
        if (!r) { syncIncompleto = true; return null; }
        if (r.status === 404) return null;      // aún no existe: normal
        if (!r.ok) { syncIncompleto = true; return null; }
        return r.text();
      })
      .then(function (txt) {
        if (!txt) return;
        var rem;
        try { rem = JSON.parse(txt); } catch (e) { syncIncompleto = true; return; }
        if (!rem || typeof rem !== 'object') { syncIncompleto = true; return; }
        Object.keys(rem).forEach(function (id) {
          var ts = rem[id] || 0;
          if (!st.tombstones[id] || ts > st.tombstones[id]) st.tombstones[id] = ts;
        });
        persist();
      })
      .catch(function () { syncIncompleto = true; });
  }

  // Quita de local los turnos con lápida (si no se editaron después de borrar).
  function aplicarBorrados() {
    var reg = R();
    if (!reg || !reg.borrarIds) return;
    var quitar = [];
    Object.keys(st.tombstones).forEach(function (id) {
      var lAt = st.turnoAt[id] || 0;
      if (lAt > st.tombstones[id]) return; // reeditado tras borrar → se conserva
      quitar.push(id);
    });
    if (!quitar.length) return;
    _applying = true;
    try { reg.borrarIds(quitar); } finally { _applying = false; }
  }

  // ── Configuración (ajustes) del usuario ────────────────────────────────
  // Un archivo _config.json compartido con { at, settings }. Al vincular un
  // aparato nuevo (st.configAt sin definir) se trae la config del otro. Luego,
  // gana la última escritura (por `at`).
  function bajarConfig() {
    return graph('/me/drive/items/' + st.folderId + ':/' + CONFIG + ':/content')
      .then(function (r) {
        if (!r) { syncIncompleto = true; return null; }
        if (r.status === 404) return null;
        if (!r.ok) { syncIncompleto = true; return null; }
        return r.text();
      })
      .then(function (txt) {
        if (!txt) return;
        var rem;
        try { rem = JSON.parse(txt); } catch (e) { syncIncompleto = true; return; }
        if (!rem || !rem.settings || typeof rem.settings !== 'object') { syncIncompleto = true; return; }
        var primeraVez = st.configAt == null;
        if (!primeraVez && !(rem.at > st.configAt)) return; // no es más nuevo
        var reg = R();
        var gcalKeys = rem.gcal && typeof rem.gcal === 'object' ? Object.keys(rem.gcal).length : 0;
        if (reg && reg.aplicarConfig) {
          _applying = true;
          try {
            reg.aplicarConfig(rem.settings, primeraVez);
            // Caché del cuadrante (Google Calendar): solo si trae datos.
            // gcalSet ya hace MERGE (nunca borra lo local).
            if (gcalKeys && reg.gcalSet) reg.gcalSet(rem.gcal);
          } finally { _applying = false; }
        }
        st.configAt = rem.at || Date.now();
        st.configFirma = firma(JSON.stringify(rem.settings) + '|' + (gcalKeys ? JSON.stringify(rem.gcal) : ''));
        persist();
      })
      .catch(function () { syncIncompleto = true; });
  }
  function subirConfig() {
    var reg = R();
    if (!reg || !reg.configParaSubir) return Promise.resolve();
    var local = reg.configParaSubir();
    var gcal = reg.gcalGet ? (reg.gcalGet() || {}) : {};
    var gcalKeys = Object.keys(gcal).length;
    var f = firma(JSON.stringify(local) + '|' + (gcalKeys ? JSON.stringify(gcal) : ''));
    if (f === st.configFirma) return Promise.resolve(); // sin cambios
    var at = Math.max(Date.now(), (st.configAt || 0) + 1);
    // Sin datos de cuadrante en este aparato → NO se manda `gcal` (no se pisa
    // el del otro que sí lo tenga).
    var payload = { at: at, settings: local };
    if (gcalKeys) payload.gcal = gcal;
    var body = JSON.stringify(payload, null, 2);
    return graph('/me/drive/items/' + st.folderId + ':/' + CONFIG + ':/content', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body
    }).then(function (r) {
      if (r && r.ok) { st.configAt = at; st.configFirma = f; persist(); }
    }).catch(function () {});
  }

  var tombFirma = null;
  function subirBorrados() {
    if (!Object.keys(st.tombstones).length) return Promise.resolve();
    var f = firma(JSON.stringify(st.tombstones));
    if (f === tombFirma) return Promise.resolve(); // nada nuevo
    var url = '/me/drive/items/' + st.folderId + ':/' + BORRADOS + ':/content';
    return graph(url).then(function (r) {
      return (r && r.ok) ? r.text() : null;
    }).then(function (txt) {
      var rem = {};
      if (txt) { try { rem = JSON.parse(txt) || {}; } catch (e) {} }
      var merged = {};
      Object.keys(rem).forEach(function (id) { merged[id] = rem[id]; });
      Object.keys(st.tombstones).forEach(function (id) {
        if (!merged[id] || st.tombstones[id] > merged[id]) merged[id] = st.tombstones[id];
      });
      st.tombstones = merged;
      return graph(url, { method: 'PUT', json: merged }).then(function (rr) {
        if (rr && rr.ok) { tombFirma = firma(JSON.stringify(merged)); persist(); }
      });
    }).catch(function () {});
  }

  function quitarMeta(t) {
    var c = {};
    Object.keys(t).forEach(function (k) { if (k !== '_cloudAt') c[k] = t[k]; });
    return c;
  }

  // Ciclo completo (bajar + subir), con guard anti-solapamiento.
  var errorSubida = false;
  var syncIncompleto = false; // algún archivo no se pudo leer/aplicar entero
  var syncWatchdog = null;
  function terminarSync() {
    if (syncWatchdog) { clearTimeout(syncWatchdog); syncWatchdog = null; }
    // Solo se marca "copia verificada" si el ciclo entero fue limpio.
    if (!syncIncompleto && !errorSubida) st.ultimoSyncOk = Date.now();
    persist();
    syncEnCurso = false;
    pintarTarjeta();
  }
  function sincronizar(silencioso) {
    if (!cuenta || syncEnCurso) return Promise.resolve();
    syncEnCurso = true;
    errorSubida = false;
    syncIncompleto = false;
    pintarBanner();
    // Red de seguridad: pase lo que pase, el icono deja de girar en 60 s.
    if (syncWatchdog) clearTimeout(syncWatchdog);
    syncWatchdog = setTimeout(function () {
      errorSubida = true;
      terminarSync();
      console.warn('[nube] sync watchdog: forzado fin a los 60 s');
    }, 60000);
    return conTimeout(sincronizarBajar(), 45000, 'bajar').then(function (res) {
      // Juntar turnos duplicados del mismo día que hayan podido aparecer al
      // fusionar (mismo día creado en dos aparatos con id distinto).
      var reg0 = R();
      if (reg0 && reg0.dedupe) reg0.dedupe();
      return conTimeout(sincronizarSubir(), 45000, 'subir').then(function () {
        var reg = R();
        if (reg) reg.reRender();
        if (res && res.altas && !silencioso) {
          reg && reg.aviso(res.altas + ' turno' + (res.altas > 1 ? 's' : '') +
            ' recuperado' + (res.altas > 1 ? 's' : '') + ' de la nube.');
        }
      });
    }).catch(function (e) {
      // Errores de red se tragan (se reintenta); otros a consola.
      if (e && !e.noToken) console.warn('[nube] sync', e && e.message || e);
    }).then(terminarSync);
  }

  // ── Cambios locales → marcar y programar subida ─────────────────────────
  function onTurnosSaved(turnos) {
    if (!cuenta || _applying) return;
    // Detectar qué turnos cambiaron para sellar su hora (_cloudAt local).
    var vivos = {};
    turnos.forEach(function (t) {
      vivos[t.id] = true;
      var now = firma(JSON.stringify(quitarMeta(t)));
      if (st.turnoHash[t.id] !== now) {
        st.turnoAt[t.id] = Date.now();
        st.turnoHash[t.id] = now;
        (t.servicios || []).forEach(function (s) {
          if (s.fecha) st.dayIndex[t.id] = s.fecha;
        });
      }
    });
    // Purga de turnos borrados: sin esto turnoAt/turnoHash/dayIndex crecen
    // para siempre. (Legado: quitar las viejas claves _json_.)
    Object.keys(st.turnoHash).forEach(function (id) { if (!vivos[id]) delete st.turnoHash[id]; });
    Object.keys(st.turnoAt).forEach(function (id) {
      if (id.indexOf('_json_') === 0) { delete st.turnoAt[id]; return; }
      if (!vivos[id]) delete st.turnoAt[id];
    });
    Object.keys(st.dayIndex).forEach(function (id) { if (!vivos[id]) delete st.dayIndex[id]; });
    persist();
    clearTimeout(subidaTimer);
    subidaTimer = setTimeout(function () { sincronizar(true); }, SUBIDA_DEBOUNCE);
  }

  // ── UI: banner "reconectar" + tarjeta de Ajustes ───────────────────────
  function pintarBanner() {
    var reg = R();
    if (reg && reg.pintarBanner) reg.pintarBanner();
  }
  function pintarTarjeta() {
    var reg = R();
    if (reg && reg.pintarAjustes) reg.pintarAjustes();
  }

  // ── API pública para registro.js ───────────────────────────────────────
  window.NUBE = {
    disponible: configurada,
    estaVinculada: function () { return !!cuenta; },
    necesitaReconectar: function () { return needsReconnect; },
    sincronizando: function () { return syncEnCurso; },
    correo: function () { return cuenta ? (cuenta.username || '') : ''; },
    ultimaCopia: function () { return st.ultima || 0; },
    aplicando: function () { return _applying; },
    onTurnosSaved: onTurnosSaved,
    onTurnoBorrado: onTurnoBorrado,
    onConfigSaved: function () {
      if (!cuenta || _applying) return;
      clearTimeout(subidaTimer);
      subidaTimer = setTimeout(function () { sincronizar(true); }, SUBIDA_DEBOUNCE);
    },
    // Estado para el icono: 'sin' | 'reconectar' | 'sync' | 'error' | 'ok'
    estado: function () {
      if (!cuenta) return 'sin';
      if (needsReconnect) return 'reconectar';
      if (syncEnCurso) return 'sync';
      if (errorSubida || syncIncompleto) return 'error'; // descarga a medias → reintentar
      return 'ok';
    },
    // Fecha de la última sincronización VERIFICADA (ciclo entero sin cortes).
    ultimoSyncOk: function () { return st.ultimoSyncOk || 0; },

    // Vincular (toque real del usuario)
    vincular: function () {
      if (!configurada()) return;
      initMsal().then(function () {
        msalApp.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
      });
    },
    // Reconectar tras caducar la sesión (toque real)
    reconectar: function () {
      if (!msalApp) return;
      msalApp.acquireTokenRedirect({ scopes: SCOPES, account: cuenta || undefined });
    },
    sincronizarAhora: function () { return sincronizar(false); },

    // Desvincular: deja de sincronizar, NO borra nada de OneDrive.
    desvincular: function () {
      cuenta = null;
      st = {};
      ensureShape();
      persist();
      try { localStorage.removeItem(K_NUBE); } catch (e) {}
      st = {}; ensureShape();
      if (msalApp) {
        var accs = msalApp.getAllAccounts();
        accs.forEach(function (a) {
          try { msalApp.getTokenCache && msalApp.clearCache && msalApp.clearCache({ account: a }); } catch (e) {}
        });
      }
      pintarTarjeta();
      pintarBanner();
    },

    // Borrar mis datos de la nube: borra todos los turno-*.json de la carpeta
    // EnRuta del OneDrive. NO desvincula y NO toca nada en local. Deja el
    // registro de sincronización a cero, así que la carpeta se queda vacía
    // hasta que el usuario edite un turno o pulse "Sincronizar ahora" (que
    // vuelve a subir todo limpio). Para dejar de sincronizar: "Desvincular".
    borrarDatosNube: function () {
      if (!cuenta) return Promise.resolve();
      return ensureFolder().then(function (fid) {
        return graphJson('/me/drive/items/' + fid + '/children?$select=id,name&$top=200');
      }).then(function (res) {
        var borra = Promise.resolve();
        ((res && res.value) || []).forEach(function (it) {
          // Archivos de día turno-*.json, lápidas _borrados.json y _config.json.
          if (!fechaDeNombre(it.name) && it.name !== BORRADOS && it.name !== CONFIG) return;
          borra = borra.then(function () {
            return graph('/me/drive/items/' + it.id, { method: 'DELETE' }).catch(function () {});
          });
        });
        return borra;
      }).then(function () {
        // Reset del registro de sincro: la carpeta está vacía, todo lo local
        // cuenta como "por subir". Se conservan folderId y cuenta.
        st.fileEtags = {};
        st.syncedDay = {};
        st.syncedDayAt = {};
        st.turnoAt = {};
        st.turnoHash = {};
        st.dayIndex = {};
        st.tombstones = {};
        st.configAt = null;
        st.configFirma = null;
        st.ultima = 0;
        tombFirma = null;
        persist();
        pintarTarjeta();
      });
    },

    // Arranque: init MSAL, procesar vuelta de redirect, y si hay cuenta,
    // sincronizar. Se llama desde registro.js init().
    init: function () {
      if (!configurada()) return;
      initMsal().then(function () {
        return msalApp.handleRedirectPromise();
      }).then(function (resp) {
        if (resp && resp.account) {
          msalApp.setActiveAccount(resp.account);
        }
        var acc = msalApp.getActiveAccount() || msalApp.getAllAccounts()[0] || null;
        if (acc) { cuenta = acc; msalApp.setActiveAccount(acc); }
        listo = true;
        pintarTarjeta();
        if (cuenta) {
          // Sincro al abrir
          sincronizar(false);
        }
        if (resp && resp.account) {
          // Volvemos de vincular: mostrar privacidad la primera vez
          var reg = R();
          if (reg && reg.trasVincular) reg.trasVincular();
        }
      }).catch(function (e) {
        console.warn('[nube] init', e);
        listo = true;
      });
    }
  };

  // Sincro al volver la app a primer plano / flush al irse a segundo plano.
  document.addEventListener('visibilitychange', function () {
    if (!cuenta) return;
    if (document.visibilityState === 'hidden') {
      clearTimeout(subidaTimer);
      sincronizar(true);
    } else {
      sincronizar(true);
    }
  });
})();
