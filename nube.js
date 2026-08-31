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
    if (!st.syncedDay) st.syncedDay = {};
    if (!st.turnoAt) st.turnoAt = {};
    if (!st.dayIndex) st.dayIndex = {};
    if (!st.syncedDayAt) st.syncedDayAt = {};
  }
  ensureShape();

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
      return msalApp.acquireTokenSilent({ scopes: SCOPES, account: cuenta })
        .then(function (r) { needsReconnect = false; return r.accessToken; })
        .catch(function (e) {
          // InteractionRequiredAuthError, o iframe bloqueado por cookies de
          // terceros → hace falta un toque real del usuario.
          needsReconnect = true;
          pintarBanner();
          return null;
        });
    }).then(function (t) { tokenEnCurso = null; return t; });
    return tokenEnCurso;
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
      return fetch(GRAPH + path, {
        method: opts.method || 'GET',
        headers: h,
        body: opts.body
      });
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
      // No existe → crearla
      return graphJson('/me/drive/root/children', {
        method: 'POST',
        json: { name: FOLDER, folder: {}, '@microsoft.graph.conflictBehavior': 'replace' }
      }).then(function (nw) {
        st.folderId = nw.id; persist(); return nw.id;
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
  // fusiona en local. Detecta borrados (archivo que ya no está).
  function sincronizarBajar() {
    return ensureFolder().then(function (fid) {
      var archivos = [];
      function pagina(url) {
        return graphJson(url).then(function (res) {
          if (!res) return;
          (res.value || []).forEach(function (it) {
            if (it.file && fechaDeNombre(it.name)) archivos.push(it);
          });
          if (res['@odata.nextLink']) {
            return pagina(res['@odata.nextLink'].replace(GRAPH, ''));
          }
        });
      }
      return pagina('/me/drive/items/' + fid +
        '/children?$select=id,name,eTag,file&$top=200').then(function () {
        return archivos;
      });
    }).then(function (archivos) {
      var reg = R();
      if (!reg) return { altas: 0 };
      var nombresRemotos = {};
      var cadena = Promise.resolve();
      var totalAltas = 0;

      archivos.forEach(function (it) {
        nombresRemotos[it.name] = true;
        if (st.fileEtags[it.name] === it.eTag) return; // sin cambios
        cadena = cadena.then(function () {
          return graph('/me/drive/items/' + it.id + '/content').then(function (r) {
            if (!r.ok) return;
            return r.text();
          }).then(function (txt) {
            if (!txt) return;
            var data;
            try { data = JSON.parse(txt); } catch (e) { return; }
            var fecha = data.fecha || fechaDeNombre(it.name);
            var remotos = data.turnos || [];
            var res = fusionarDia(fecha, remotos, true);
            totalAltas += res.altas;
            st.fileEtags[it.name] = it.eTag;
            st.syncedDay[fecha] = reg.diaJSON(fecha) || '';
            st.syncedDayAt[fecha] = Date.now();
            persist();
          });
        });
      });

      // Archivos borrados en remoto → borrar esos días en local (si no están
      // sucios localmente).
      Object.keys(st.fileEtags).forEach(function (name) {
        if (nombresRemotos[name]) return;
        var fecha = fechaDeNombre(name);
        if (!fecha) return;
        cadena = cadena.then(function () {
          var sucio = reg.diaJSON(fecha) !== (st.syncedDay[fecha] || null);
          if (!sucio) {
            fusionarDia(fecha, [], true);
          }
          delete st.fileEtags[name];
          delete st.syncedDay[fecha];
          delete st.syncedDayAt[fecha];
          persist();
        });
      });

      return cadena.then(function () { return { altas: totalAltas }; });
    });
  }

  // Fusiona la lista de turnos remotos de un día con lo local, por id de
  // turno. Devuelve {altas}. borrarAusentes=true → un turno local de ese día
  // que no viene en la lista remota y no se ha tocado desde la última sincro
  // se borra (lo borró otro dispositivo).
  function fusionarDia(fecha, remotos, borrarAusentes) {
    var reg = R();
    if (!reg) return { altas: 0 };
    var locales = reg.diaTurnos(fecha); // copia de los turnos locales de ese día
    var localById = {};
    locales.forEach(function (t) { localById[t.id] = t; });
    var remoteById = {};
    var upsert = [], removeIds = [], altas = 0;

    remotos.forEach(function (rt) {
      if (!rt || !rt.id) return;
      remoteById[rt.id] = true;
      var rAt = rt._cloudAt || 0;
      var lAt = st.turnoAt[rt.id] || 0;
      var clean = quitarMeta(rt);
      if (!localById[rt.id]) { upsert.push(clean); altas++; st.turnoAt[rt.id] = rAt || Date.now(); st.dayIndex[rt.id] = fecha; }
      else if (rAt > lAt) { upsert.push(clean); st.turnoAt[rt.id] = rAt; st.dayIndex[rt.id] = fecha; }
    });

    if (borrarAusentes) {
      var corte = st.syncedDayAt[fecha] || 0;
      locales.forEach(function (lt) {
        if (remoteById[lt.id]) return;
        var lAt = st.turnoAt[lt.id] || 0;
        if (lAt <= corte) { removeIds.push(lt.id); delete st.turnoAt[lt.id]; delete st.dayIndex[lt.id]; }
      });
    }

    if (!upsert.length && !removeIds.length) return { altas: 0 };
    _applying = true;
    try { reg.aplicarDia(upsert, removeIds); }
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

      var cadena = Promise.resolve();
      Object.keys(fechas).forEach(function (fecha) {
        var actual = reg.diaJSON(fecha); // null si el día ya no tiene turnos
        var sincronizado = st.syncedDay[fecha];
        if (actual === (sincronizado || null)) return; // no sucio
        cadena = cadena.then(function () { return subirDia(fecha, actual); });
      });
      return cadena;
    });
  }

  function subirDia(fecha, jsonActual, esReintento) {
    var reg = R();
    var name = fileName(fecha);
    var etag = st.fileEtags[name];

    // Día vacío → borrar el archivo remoto
    if (jsonActual == null) {
      var hdrDel = etag ? { 'If-Match': etag } : {};
      return graph('/me/drive/items/' + st.folderId + ':/' + name + ':', {
        method: 'DELETE', headers: hdrDel
      }).then(function (r) {
        if (r.ok || r.status === 404) {
          delete st.fileEtags[name];
          delete st.syncedDay[fecha];
          delete st.syncedDayAt[fecha];
          persist();
        }
      }).catch(function () {});
    }

    // Inyectar _cloudAt de cada turno (desde nuestro registro local)
    var data = JSON.parse(jsonActual);
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
        // Otro dispositivo escribió este día entre medias → bajar, re-fusionar
        // y reintentar UNA vez.
        return graph('/me/drive/items/' + st.folderId + ':/' + name + ':/content')
          .then(function (rr) { return rr.ok ? rr.text() : null; })
          .then(function (txt) {
            if (txt) {
              try {
                var rem = JSON.parse(txt);
                fusionarDia(fecha, rem.turnos || [], false);
              } catch (e) {}
            }
            // refrescar etag
            return graphJson('/me/drive/items/' + st.folderId + ':/' + name);
          })
          .then(function (meta) {
            if (meta && meta.eTag) st.fileEtags[name] = meta.eTag;
            return subirDia(fecha, reg.diaJSON(fecha), true);
          });
      }
      if (!r.ok) return; // sin red u otro error → se reintenta en la próxima
      return r.json().then(function (item) {
        st.fileEtags[name] = item.eTag;
        st.syncedDay[fecha] = jsonActual;
        st.syncedDayAt[fecha] = Date.now();
        st.ultima = Date.now();
        persist();
      });
    }).catch(function () { /* sin red: se reintenta luego */ });
  }

  function quitarMeta(t) {
    var c = {};
    Object.keys(t).forEach(function (k) { if (k !== '_cloudAt') c[k] = t[k]; });
    return c;
  }

  // Ciclo completo (bajar + subir), con guard anti-solapamiento.
  function sincronizar(silencioso) {
    if (!cuenta || syncEnCurso) return Promise.resolve();
    syncEnCurso = true;
    pintarBanner();
    return sincronizarBajar().then(function (res) {
      return sincronizarSubir().then(function () {
        var reg = R();
        if (reg) reg.reRender();
        if (res && res.altas && !silencioso) {
          reg && reg.aviso(res.altas + ' turno' + (res.altas > 1 ? 's' : '') +
            ' recuperado' + (res.altas > 1 ? 's' : '') + ' de la nube.');
        }
      });
    }).catch(function (e) {
      // Errores de red se tragan (se reintenta); otros a consola.
      if (e && !e.noToken) console.warn('[nube] sync', e);
    }).then(function () {
      syncEnCurso = false;
      pintarTarjeta();
    });
  }

  // ── Cambios locales → marcar y programar subida ─────────────────────────
  function onTurnosSaved(turnos) {
    if (!cuenta || _applying) return;
    // Detectar qué turnos cambiaron para sellar su hora (_cloudAt local).
    turnos.forEach(function (t) {
      var prev = st.turnoAt['_json_' + t.id];
      var now = JSON.stringify(quitarMeta(t));
      if (prev !== now) {
        st.turnoAt[t.id] = Date.now();
        st.turnoAt['_json_' + t.id] = now;
        (t.servicios || []).forEach(function (s) {
          if (s.fecha) st.dayIndex[t.id] = s.fecha;
        });
      }
    });
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
    // y luego desvincula. NO borra nada en local.
    borrarDatosNube: function () {
      if (!cuenta) return Promise.resolve();
      return ensureFolder().then(function (fid) {
        return graphJson('/me/drive/items/' + fid + '/children?$select=id,name&$top=200');
      }).then(function (res) {
        var borra = Promise.resolve();
        ((res && res.value) || []).forEach(function (it) {
          if (!fechaDeNombre(it.name)) return;
          borra = borra.then(function () {
            return graph('/me/drive/items/' + it.id, { method: 'DELETE' }).catch(function () {});
          });
        });
        return borra;
      }).then(function () {
        window.NUBE.desvincular();
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
