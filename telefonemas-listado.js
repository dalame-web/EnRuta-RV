/* telefonemas-listado.js — pestaña "Telefonemas": listado de consulta del
 * catálogo completo (Libro de Telefonemas). Solo lectura: no crea ni
 * modifica s.telefonemas[], no depende del estado interno de registro.js.
 * Lee el catálogo de window.TELEFONEMAS (fuente de verdad expuesta por
 * registro.js) y lo pinta con createElement.
 */
(function () {
  'use strict';

  // Copia mínima de la homónima en registro.js — no merece compartir un
  // fichero de utilidades por una función de 10 líneas.
  function appendConNegritas(container, texto) {
    String(texto || '').split(/\*(.+?)\*/).forEach(function (parte, i) {
      if (!parte) return;
      if (i % 2 === 1) {
        var b = document.createElement('b'); b.textContent = parte;
        container.appendChild(b);
      } else {
        container.appendChild(document.createTextNode(parte));
      }
    });
  }

  // Hueco tal y como aparece en el documento: línea de blanco ("___"), y si
  // el original trae una aclaración entre paréntesis junto al hueco, se
  // reproduce literal (no se sustituye por una etiqueta propia).
  function campoTexto(p) {
    return p.hint ? '___ (' + p.hint + ')' : '___';
  }

  function buildFrase(container, partes) {
    (partes || []).forEach(function (p) {
      if (p.t === 'text') {
        container.appendChild(document.createTextNode(p.v));
      } else if (p.t === 'campo') {
        var ph = document.createElement('span');
        ph.className = 'tel-list-placeholder';
        ph.textContent = campoTexto(p);
        container.appendChild(ph);
      } else if (p.t === 'opcional') {
        var opt = document.createElement('span');
        opt.className = 'tel-list-optional';
        opt.textContent = '[' + String(p.v || '') + ']';
        container.appendChild(opt);
      }
    });
  }

  function fraseTextoPlano(partes) {
    return (partes || []).map(function (p) {
      if (p.t === 'text') return p.v;
      if (p.t === 'campo') return campoTexto(p);
      if (p.t === 'opcional') return p.v;
      return '';
    }).join('');
  }

  function buildCard(categoria, variante, state) {
    var card = document.createElement('div');
    card.className = 'tel-list-card color-' + (variante.color || categoria.color || 'rc');

    var searchText = [
      variante.codigo, variante.nombre, categoria.catLabel,
      fraseTextoPlano(variante.partes)
    ].join(' ').toLowerCase();
    card.dataset.search = searchText;

    var head = document.createElement('div'); head.className = 'tel-list-card-head';
    var titleWrap = document.createElement('div'); titleWrap.className = 'tel-list-card-title-wrap';
    var code = document.createElement('span'); code.className = 'tel-list-card-code'; code.textContent = variante.codigo;
    titleWrap.appendChild(code);
    if (variante.nombre) {
      var dash = document.createElement('span'); dash.className = 'tel-list-card-dash'; dash.textContent = '—';
      titleWrap.appendChild(dash);
      var sub = document.createElement('span'); sub.className = 'tel-list-card-subtitle'; sub.textContent = variante.nombre;
      titleWrap.appendChild(sub);
    }
    head.appendChild(titleWrap);
    var cat = document.createElement('span'); cat.className = 'tel-list-card-cat'; cat.textContent = categoria.catLabel;
    head.appendChild(cat);
    card.appendChild(head);

    var body = document.createElement('div'); body.className = 'tel-list-card-body';
    if (variante.guia) {
      var cometido = document.createElement('div'); cometido.className = 'tel-list-card-name';
      appendConNegritas(cometido, variante.guia);
      body.appendChild(cometido);
    }

    var frase = document.createElement('div'); frase.className = 'tel-list-frase';
    buildFrase(frase, variante.partes);
    body.appendChild(frase);

    if (variante.enlace) {
      var enlace = document.createElement('div'); enlace.className = 'tel-list-link';
      var enlaceIcon = document.createElement('span'); enlaceIcon.textContent = '🔗 ';
      enlace.appendChild(enlaceIcon);
      enlace.appendChild(document.createTextNode(variante.enlace));
      body.appendChild(enlace);
    }

    var hasDetail = (variante.advertencias && variante.advertencias.length) || variante.viaBanalizada;
    if (hasDetail) {
      var detail = document.createElement('div'); detail.className = 'tel-list-detail';
      if (variante.viaBanalizada) {
        var via = document.createElement('div'); via.className = 'tel-list-via';
        via.textContent = 'En vía doble banalizada, se indica la vía (I, II, etc.) por la que circula el tren.';
        detail.appendChild(via);
      }
      if (variante.advertencias && variante.advertencias.length) {
        var adv = document.createElement('div'); adv.className = 'tel-list-advertencias';
        var advTitle = document.createElement('b'); advTitle.textContent = 'Advertencias';
        adv.appendChild(advTitle);
        var ul = document.createElement('ul');
        variante.advertencias.forEach(function (texto) {
          var li = document.createElement('li');
          appendConNegritas(li, texto);
          ul.appendChild(li);
        });
        adv.appendChild(ul);
        detail.appendChild(adv);
      }
      body.appendChild(detail);
      card.addEventListener('click', function () {
        var wasExpanded = card.classList.contains('expanded');
        if (state.expanded && state.expanded !== card) state.expanded.classList.remove('expanded');
        card.classList.toggle('expanded', !wasExpanded);
        state.expanded = wasExpanded ? null : card;
      });
    }

    card.appendChild(body);
    return card;
  }

  function render(container) {
    if (!container) return;
    var catalogo = window.TELEFONEMAS || [];
    container.innerHTML = '';

    var sticky = document.createElement('div'); sticky.className = 'tel-list-sticky';
    container.appendChild(sticky);

    var search = document.createElement('input');
    search.type = 'text';
    search.className = 'tel-list-search';
    search.placeholder = 'Buscar por código o palabra clave…';
    sticky.appendChild(search);

    var nav = document.createElement('div'); nav.className = 'tel-list-nav';
    sticky.appendChild(nav);
    // Rueda del ratón en desktop mueve verticalmente por defecto — sin esto,
    // la fila de chips (overflow-x, sin scrollbar visible) es inalcanzable
    // sin touch/trackpad horizontal.
    nav.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        nav.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });

    var empty = document.createElement('div');
    empty.className = 'tel-list-empty';
    empty.textContent = 'Sin resultados.';
    empty.style.display = 'none';
    container.appendChild(empty);

    var sections = [];
    var state = { expanded: null };

    catalogo.forEach(function (categoria) {
      var navBtn = document.createElement('button');
      navBtn.type = 'button';
      navBtn.className = 'tel-list-nav-btn';
      navBtn.textContent = categoria.cat + ' · ' + categoria.catLabel;
      nav.appendChild(navBtn);

      var section = document.createElement('div'); section.className = 'tel-list-section';
      var title = document.createElement('div'); title.className = 'tel-list-section-title';
      title.textContent = categoria.cat + ' — ' + categoria.catLabel;
      section.appendChild(title);

      var grid = document.createElement('div'); grid.className = 'tel-list-grid';
      var cards = (categoria.variantes || []).map(function (variante) {
        var card = buildCard(categoria, variante, state);
        grid.appendChild(card);
        return card;
      });
      section.appendChild(grid);
      container.appendChild(section);
      sections.push({ el: section, cards: cards });

      navBtn.addEventListener('click', function () {
        // scrollIntoView no sabe restar la altura de las barras fijas
        // (tabs de la app + buscador/chips sticky) — sin esto, la sección
        // queda tapada justo debajo de ellas. Se calcula en cada click
        // porque la altura cambia según el breakpoint.
        var tabsEl = document.querySelector('.tabs');
        var offset = (tabsEl ? tabsEl.offsetHeight : 0) + sticky.offsetHeight + 8;
        var top = section.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: top, behavior: 'smooth' });
      });
    });

    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      var totalVisible = 0;
      sections.forEach(function (s) {
        var sectionVisible = 0;
        s.cards.forEach(function (card) {
          var match = !q || card.dataset.search.indexOf(q) !== -1;
          card.style.display = match ? '' : 'none';
          if (match) sectionVisible++;
        });
        s.el.style.display = sectionVisible ? '' : 'none';
        totalVisible += sectionVisible;
      });
      empty.style.display = totalVisible ? 'none' : 'block';
    });
  }

  window.TELEFONEMAS_LISTADO = { render: render };
})();
