/* app-modal.js — ventanas de confirmación/aviso propias de la app (sustituyen
 * a confirm()/alert() nativos, que bloquean el hilo). registro.js las usa
 * para todos los diálogos de RV (borrar turno, quitar parada, restaurar
 * copia...). Extraído literal de EnRuta/index.html (JS: líneas 1520-1599;
 * CSS: líneas 1497-1516), con el único cambio de inyectar su propio <style>
 * para que sea un archivo suelto y no haga falta tocar tu hoja de estilos.
 *
 * Uso: <script src="app-modal.js"></script> — no necesita nada más.
 *
 * API:
 *   window.appModal.confirm({title, message, buttons:[{label,value,kind}], dismissValue, backdropClose})
 *     → Promise<value> (value del botón pulsado; dismissValue en ESC/click fuera)
 *   window.appModal.alert({title, message, button}) → Promise<void>
 *   kind de cada botón: 'primary' (resaltado y enfocado) | 'danger' (rojo) | 'neutral'
 *
 * CSS: usa las variables --panel,--fg,--border,--panel-2,--accent. Si tu
 * :root ya las define, se usan las tuyas; si no, caen a los valores por
 * defecto de más abajo.
 */
(function () {
  'use strict';

  var css =
    ':where(:root){--panel:#161b22;--fg:#e6edf3;--border:#30363d;--panel-2:#1f242c;--accent:#58a6ff;}' +
    '.modal-overlay{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,.55);padding:20px;opacity:0;pointer-events:none;transition:opacity .15s ease}' +
    '.modal-overlay.open{opacity:1;pointer-events:auto}' +
    '.modal-box{background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:14px;' +
      'max-width:440px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.5);padding:20px 20px 16px;' +
      'transform:translateY(8px) scale(.98);transition:transform .15s ease}' +
    '.modal-overlay.open .modal-box{transform:none}' +
    '.modal-title{font-size:17px;font-weight:700;margin:0 0 8px;line-height:1.25}' +
    '.modal-msg{font-size:14px;line-height:1.5;opacity:.92;white-space:pre-line;margin:0 0 18px}' +
    '.modal-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end}' +
    '.modal-btn{flex:1 1 auto;min-width:130px;padding:11px 14px;border-radius:9px;border:1px solid var(--border);' +
      'background:var(--panel-2);color:var(--fg);font-size:14px;font-weight:600;cursor:pointer;transition:filter .1s ease}' +
    '.modal-btn:hover{filter:brightness(1.12)}' +
    '.modal-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}' +
    '.modal-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}' +
    '.modal-btn.danger{background:#e8201c;border-color:#e8201c;color:#fff}' +
    '.modal-btn.neutral{background:var(--panel-2);color:var(--fg)}' +
    'body.modal-open{overflow:hidden}' +
    '@media (max-width:520px){ .modal-btn{flex-basis:100%} }';
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  var overlay = null, box = null, current = null, queue = [];
  function build() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'presentation');
    box = document.createElement('div');
    box.className = 'modal-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay && current && current.backdropClose) resolveWith(current.dismissValue);
    });
    document.addEventListener('keydown', function (e) {
      if (!current) return;
      if (e.key === 'Escape') { e.preventDefault(); resolveWith(current.dismissValue); }
    });
    document.body.appendChild(overlay);
  }
  function render(opts) {
    box.innerHTML = '';
    var ttl = document.createElement('div'); ttl.className = 'modal-title'; ttl.textContent = opts.title || '';
    var msg = document.createElement('div'); msg.className = 'modal-msg'; msg.textContent = opts.message || '';
    var acts = document.createElement('div'); acts.className = 'modal-actions';
    if (opts.title) box.appendChild(ttl);
    if (opts.message) box.appendChild(msg);
    var focusBtn = null;
    (opts.buttons || []).forEach(function (b) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'modal-btn' + (b.kind ? ' ' + b.kind : '');
      el.textContent = b.label;
      el.addEventListener('click', function () { resolveWith(b.value); });
      acts.appendChild(el);
      if (b.kind === 'primary' && !focusBtn) focusBtn = el;
    });
    if (!focusBtn) focusBtn = acts.querySelector('.modal-btn');
    box.appendChild(acts);
    overlay.classList.add('open');
    document.body.classList.add('modal-open');
    if (focusBtn) { try { focusBtn.focus(); } catch (e) {} }
  }
  function resolveWith(value) {
    if (!current) return;
    var res = current.resolve;
    current = null;
    overlay.classList.remove('open');
    document.body.classList.remove('modal-open');
    try { res(value); } catch (e) {}
    if (queue.length) { var next = queue.shift(); start(next); }
  }
  function start(item) { current = item; build(); render(item.opts); }
  function open(opts) {
    return new Promise(function (resolve) {
      var dv = opts.dismissValue;
      if (typeof dv === 'undefined') {
        var safe = (opts.buttons || []).filter(function (b) { return b.kind !== 'danger'; })[0];
        dv = safe ? safe.value : ((opts.buttons || [])[0] || {}).value;
      }
      var item = { opts: opts, resolve: resolve, backdropClose: !!opts.backdropClose, dismissValue: dv };
      if (current) { queue.push(item); } else { start(item); }
    });
  }
  window.appModal = {
    confirm: function (opts) { return open(opts); },
    alert: function (opts) {
      return open({
        title: opts.title, message: opts.message,
        buttons: [{ label: (opts.button || 'Entendido'), value: true, kind: 'primary' }],
        backdropClose: true
      });
    }
  };
})();
