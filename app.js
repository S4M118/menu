/* =========================================================
   Carta · Consulta de precios
   Vanilla JS · Firebase (Firestore) + copia local en localStorage
   ========================================================= */

(function () {
  'use strict';

  /* ---------- Configuración ---------- */

  var STORAGE_KEY = 'carta_productos_v1';
  var CURRENCY = 'COP';
  var LOCALE = 'es-CO';
  var DOUBLE_TAP_MS = 320;

  /* ---------- Referencias del DOM ---------- */

  var el = {
    title: document.getElementById('appTitle'),
    lockBtn: document.getElementById('lockBtn'),
    lockOpen: document.querySelector('.lock-btn .icon-open'),
    lockClosed: document.querySelector('.lock-btn .icon-closed'),
    search: document.getElementById('searchInput'),
    clearBtn: document.getElementById('clearBtn'),
    list: document.getElementById('productList'),
    allSection: document.getElementById('allSection'),
    meta: document.getElementById('resultMeta'),
    empty: document.getElementById('emptyState'),
    emptyTitle: document.getElementById('emptyTitle'),
    emptyHint: document.getElementById('emptyHint'),
    addBtn: document.getElementById('addBtn'),
    adminDialog: document.getElementById('adminDialog'),
    adminConfirmBtn: document.getElementById('adminConfirmBtn'),
    adminCancelBtn: document.getElementById('adminCancelBtn'),
    deleteDialog: document.getElementById('deleteDialog'),
    deleteName: document.getElementById('deleteProductName'),
    deleteConfirmBtn: document.getElementById('deleteConfirmBtn'),
    deleteCancelBtn: document.getElementById('deleteCancelBtn'),
    dialog: document.getElementById('productDialog'),
    form: document.getElementById('productForm'),
    dialogTitle: document.getElementById('dialogTitle'),
    nameInput: document.getElementById('nameInput'),
    priceInput: document.getElementById('priceInput'),
    iconInput: document.getElementById('iconInput'),
    descInput: document.getElementById('descInput'),
    nameError: document.getElementById('nameError'),
    priceError: document.getElementById('priceError'),
    cancelBtn: document.getElementById('cancelBtn'),
    toast: document.getElementById('toast')
  };

  /* ---------- Estado ---------- */

  var products = [];
  var cloud = null;
  var estadoNube = null;
  var adminMode = false;
  var editingId = null;
  var pendingDeleteId = null;
  var highlightId = null;
  var toastTimer = null;
  var lastTitleTap = 0;

  /* ---------- Utilidades ---------- */

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function normalize(str) {
    return String(str)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  var priceFormatter = new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: CURRENCY,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });

  function formatPrice(value) {
    return priceFormatter.format(value);
  }

  /* ---------- Iconos de producto ---------- */

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICON_KEYS = ['fish', 'meat', 'soup', 'drink', 'dish'];

  /* Asignación automática por palabras clave (el orden importa) */
  var ICON_RULES = [
    { key: 'drink', words: ['jugo', 'limonada', 'limon', 'agua', 'gaseosa', 'refresco', 'soda',
      'cerveza', 'cafe', 'te', 'malteada', 'batido', 'smoothie', 'bebida', 'leche', 'vino', 'ron',
      'mora', 'maracuya', 'lulo', 'pina', 'sandia', 'fresa', 'mango', 'naranja', 'manzana'] },
    { key: 'soup', words: ['sopa', 'caldo', 'sancocho', 'mondongo', 'ajiaco', 'fideos', 'crema',
      'menudo', 'olla', 'puchero'] },
    { key: 'fish', words: ['trucha', 'pescado', 'salmon', 'camaron', 'pescadilla', 'mojarra',
      'tilapia', 'ceviche', 'pulpo', 'calamar', 'atun', 'sardina', 'merluza', 'langosta', 'gambas'] },
    { key: 'meat', words: ['res', 'carne', 'cerdo', 'pollo', 'ternera', 'cordero', 'chorizo',
      'jamon', 'hamburguesa', 'bistec', 'chuleta', 'costilla', 'parrilla', 'lomo', 'salchicha',
      'pechuga', 'pavo', 'cecina', 'longaniza', 'alitas'] }
  ];

  function tokenize(text) {
    return normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
  }

  function autoIcon(name) {
    var tokens = tokenize(name);
    for (var i = 0; i < ICON_RULES.length; i++) {
      var words = ICON_RULES[i].words;
      for (var j = 0; j < tokens.length; j++) {
        if (words.indexOf(tokens[j]) !== -1) return ICON_RULES[i].key;
      }
    }
    return 'dish';
  }

  function iconOf(item) {
    if (item.icon && ICON_KEYS.indexOf(item.icon) !== -1) return item.icon;
    return autoIcon(item.name);
  }

  function createGlyph(key, className) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#icon-' + key);
    svg.appendChild(use);
    return svg;
  }

  /* `hidden` no es propiedad de SVGElement: usar siempre el atributo */
  function setHidden(node, hidden) {
    if (!node) return;
    if (hidden) node.setAttribute('hidden', '');
    else node.removeAttribute('hidden');
  }

  function showToast(message, type) {
    window.clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.className = 'toast' + (type ? ' ' + type : '');
    el.toast.hidden = false;
    toastTimer = window.setTimeout(function () {
      el.toast.hidden = true;
    }, 2600);
  }

  /* ---------- Persistencia ---------- */

  function sanitizeItems(raw) {
    if (!Array.isArray(raw)) return [];

    var clean = [];
    for (var i = 0; i < raw.length; i++) {
      var item = raw[i];
      if (!item || typeof item !== 'object') continue;

      var name = typeof item.name === 'string'
        ? item.name.trim()
        : (typeof item.nombre === 'string' ? item.nombre.trim() : '');
      var price = typeof item.price === 'number'
        ? item.price
        : parseFloat(item.price !== undefined ? item.price : item.precio);

      if (!name || !isFinite(price) || price < 0) continue;

      var iconSource = typeof item.icon === 'string' ? item.icon : item.icono;
      var icon = typeof iconSource === 'string' && ICON_KEYS.indexOf(iconSource) !== -1
        ? iconSource
        : 'auto';
      var descSource = typeof item.desc === 'string' ? item.desc : item.descripcion;

      clean.push({
        id: typeof item.id === 'string' && item.id ? item.id : uid(),
        name: name.slice(0, 80),
        price: Math.round(price),
        icon: icon,
        desc: typeof descSource === 'string' ? descSource.slice(0, 140) : ''
      });
    }
    return clean;
  }

  function loadProducts() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      var items = Array.isArray(parsed) ? parsed : (parsed && parsed.products) || [];
      return sanitizeItems(items);
    } catch (err) {
      console.error('No se pudo leer la carta:', err);
      showToast('No se pudo leer la carta guardada', 'error');
      return [];
    }
  }

  function saveProducts() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
      return true;
    } catch (err) {
      console.error('No se pudo guardar la carta:', err);
      showToast('No se pudo guardar: almacenamiento lleno o bloqueado', 'error');
      return false;
    }
  }

  /* ---------- Render ---------- */

  function getFiltered() {
    var query = normalize(el.search.value);
    if (!query) return products.slice();

    return products.filter(function (item) {
      return normalize(item.name).indexOf(query) !== -1;
    });
  }

  function sortByName(items) {
    return items.sort(function (a, b) {
      return a.name.localeCompare(b.name, LOCALE, { sensitivity: 'base' });
    });
  }

  function createIcon(pathD, strokeWidth) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', strokeWidth || '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  function createItemNode(item) {
    var li = document.createElement('li');
    li.className = 'product-item';
    li.dataset.id = item.id;
    if (item.id === highlightId) li.classList.add('is-highlight');

    var iconTile = document.createElement('span');
    iconTile.className = 'item-icon';
    iconTile.setAttribute('aria-hidden', 'true');
    iconTile.appendChild(createGlyph(iconOf(item), 'p-icon'));
    li.appendChild(iconTile);

    var info = document.createElement('div');
    info.className = 'product-info';

    var name = document.createElement('span');
    name.className = 'product-name';
    name.textContent = item.name;

    var price = document.createElement('span');
    price.className = 'product-price';
    price.textContent = formatPrice(item.price);

    info.appendChild(name);

    if (item.desc) {
      var desc = document.createElement('span');
      desc.className = 'product-desc';
      desc.textContent = item.desc;
      info.appendChild(desc);
    }

    info.appendChild(price);
    li.appendChild(info);

    var actions = document.createElement('div');
    actions.className = 'item-actions';

    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'action-btn admin-only';
    editBtn.setAttribute('aria-label', 'Editar ' + item.name);
    editBtn.appendChild(createIcon('M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z'));
    editBtn.addEventListener('click', function () { openDialog(item.id); });

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'action-btn danger admin-only';
    deleteBtn.setAttribute('aria-label', 'Eliminar ' + item.name);
    deleteBtn.appendChild(createIcon('M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13'));
    deleteBtn.addEventListener('click', function () { requestDelete(item.id); });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    li.appendChild(actions);

    return li;
  }

  function fillList(listEl, items) {
    listEl.textContent = '';
    for (var i = 0; i < items.length; i++) {
      listEl.appendChild(createItemNode(items[i]));
    }
  }

  function render() {
    var filtered = sortByName(getFiltered());
    var query = el.search.value.trim();

    var isEmpty = products.length === 0;
    var noMatches = !isEmpty && filtered.length === 0;

    fillList(el.list, filtered);
    el.allSection.hidden = isEmpty || noMatches;

    el.empty.hidden = !(isEmpty || noMatches);
    if (isEmpty) {
      el.emptyTitle.textContent = 'No hay productos en la carta';
      el.emptyHint.textContent = adminMode
        ? 'Pulsa el botón «Añadir» para crear el primer producto.'
        : 'Activa el candado para añadir productos.';
    } else if (noMatches) {
      el.emptyTitle.textContent = 'Sin resultados';
      el.emptyHint.textContent = 'Ningún producto coincide con «' + query + '».';
    }

    if (isEmpty) {
      el.meta.textContent = '';
    } else if (query) {
      el.meta.textContent = filtered.length === 1
        ? '1 resultado'
        : filtered.length + ' resultados';
    } else {
      el.meta.textContent = products.length === 1
        ? '1 producto'
        : products.length + ' productos';
    }

    el.clearBtn.hidden = query.length === 0;
  }

  /* ---------- Diálogos ---------- */

  function openModal(dlg) {
    dlg.setAttribute('data-opened-at', String(Date.now()));
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  /* El clic sintetizado que sigue al toque que abrió el diálogo no debe cerrarlo */
  function isBackdropClick(event, dlg) {
    var openedAt = parseInt(dlg.getAttribute('data-opened-at') || '0', 10);
    if (openedAt && Date.now() - openedAt < 400) return false;
    var rect = dlg.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right ||
           event.clientY < rect.top || event.clientY > rect.bottom;
  }

  function closeModal(dlg) {
    if (typeof dlg.close === 'function' && dlg.open) dlg.close();
    else dlg.removeAttribute('open');
  }

  function anyDialogOpen() {
    return el.dialog.open || el.adminDialog.open || el.deleteDialog.open;
  }

  function findProduct(id) {
    for (var i = 0; i < products.length; i++) {
      if (products[i].id === id) return products[i];
    }
    return null;
  }

  /* ---------- Modo edición ---------- */

  function setAdminMode(enabled) {
    adminMode = enabled;
    document.body.classList.toggle('admin-mode', adminMode);

    var label = adminMode ? 'Salir de administración' : 'Administrar carta';
    el.lockBtn.setAttribute('aria-pressed', String(adminMode));
    el.lockBtn.setAttribute('aria-label', label);
    el.lockBtn.setAttribute('title', label);

    setHidden(el.lockOpen, adminMode);
    setHidden(el.lockClosed, !adminMode);
    el.addBtn.hidden = !adminMode;

    if (adminMode) {
      showToast('Modo administración activado');
    } else if (el.dialog.open) {
      closeDialog();
    }
    render();
  }

  /* El aviso previo es la única puerta de entrada al modo edición */
  function requestAdmin() {
    if (adminMode) {
      setAdminMode(false);
      return;
    }
    openModal(el.adminDialog);
  }

  /* ---------- CRUD ---------- */

  function openDialog(id) {
    editingId = id || null;
    var item = null;

    if (editingId) {
      for (var i = 0; i < products.length; i++) {
        if (products[i].id === editingId) { item = products[i]; break; }
      }
      if (!item) return;
      el.dialogTitle.textContent = 'Editar producto';
      el.nameInput.value = item.name;
      el.priceInput.value = String(item.price);
      el.iconInput.value = item.icon || 'auto';
      el.descInput.value = item.desc || '';
    } else {
      el.dialogTitle.textContent = 'Añadir producto';
      el.form.reset();
      el.iconInput.value = 'auto';
      el.descInput.value = '';
    }

    clearFieldErrors();
    openModal(el.dialog);
    el.nameInput.focus();
  }

  function closeDialog() {
    closeModal(el.dialog);
    editingId = null;
    clearFieldErrors();
  }

  function clearFieldErrors() {
    el.nameError.hidden = true;
    el.priceError.hidden = true;
    el.nameInput.removeAttribute('aria-invalid');
    el.priceInput.removeAttribute('aria-invalid');
  }

  function handleSubmit(event) {
    event.preventDefault();
    clearFieldErrors();

    var name = el.nameInput.value.trim();
    var price = parseFloat(el.priceInput.value);
    var valid = true;

    if (!name) {
      el.nameError.hidden = false;
      el.nameInput.setAttribute('aria-invalid', 'true');
      valid = false;
    }
    if (!isFinite(price) || price < 0) {
      el.priceError.hidden = false;
      el.priceInput.setAttribute('aria-invalid', 'true');
      valid = false;
    }
    if (!valid) return;

    price = Math.round(price);

    var icon = ICON_KEYS.indexOf(el.iconInput.value) !== -1 ? el.iconInput.value : 'auto';
    var desc = el.descInput.value.trim().slice(0, 140);

    var datosProducto = {
      name: name.slice(0, 80),
      price: price,
      icon: icon,
      desc: desc
    };

    var esNuevo = !editingId;
    var idGuardado = editingId;

    if (editingId) {
      var existing = findProduct(editingId);
      if (!existing) {
        showToast('No se pudo actualizar: el producto ya no existe', 'error');
        closeDialog();
        return;
      }
      existing.name = datosProducto.name;
      existing.price = datosProducto.price;
      existing.icon = datosProducto.icon;
      existing.desc = datosProducto.desc;
      highlightId = editingId;
      showToast('Producto actualizado', 'success');
    } else {
      var newItem = {
        id: uid(),
        name: datosProducto.name,
        price: datosProducto.price,
        icon: datosProducto.icon,
        desc: datosProducto.desc
      };
      products.push(newItem);
      idGuardado = newItem.id;
      highlightId = newItem.id;
      showToast('Producto añadido', 'success');
    }

    saveProducts();
    closeDialog();
    render();
    sincronizarGuardado(esNuevo, datosProducto, idGuardado);
    window.setTimeout(function () {
      highlightId = null;
      var nodes = document.querySelectorAll('.product-item.is-highlight');
      for (var n = 0; n < nodes.length; n++) nodes[n].classList.remove('is-highlight');
    }, 1600);
  }

  /* Copia local primero; si hay nube, se envía en segundo plano */
  function sincronizarGuardado(esNuevo, datos, idLocal) {
    if (!cloud) return;

    if (esNuevo) {
      cloud.crear(datos).then(function (idReal) {
        var local = findProduct(idLocal);
        if (local && idReal) {
          local.id = idReal;
          saveProducts();
          render();
        }
      }).catch(function (err) {
        console.warn('No se pudo sincronizar el producto:', err);
        showToast('Guardado solo en este dispositivo (sin conexión)', 'error');
      });
    } else {
      cloud.actualizar(idLocal, datos).catch(function (err) {
        console.warn('No se pudo sincronizar la actualización:', err);
        showToast('Cambio guardado solo en este dispositivo', 'error');
      });
    }
  }

  /* Muestra el nombre del producto antes de borrar */
  function requestDelete(id) {
    var item = findProduct(id);
    if (!item) return;
    pendingDeleteId = id;
    el.deleteName.textContent = '«' + item.name + '»';
    openModal(el.deleteDialog);
  }

  function removeProduct(id) {
    var item = findProduct(id);
    if (!item) return;

    products = products.filter(function (p) { return p.id !== id; });
    saveProducts();
    render();

    if (cloud) {
      cloud.borrar(id).catch(function (err) {
        console.warn('No se pudo sincronizar el borrado:', err);
        showToast('Eliminado solo en este dispositivo (sin conexión)', 'error');
      });
    }
    showToast('«' + item.name + '» eliminado');
  }

  /* ---------- Eventos ---------- */

  el.search.addEventListener('input', render);

  el.clearBtn.addEventListener('click', function () {
    el.search.value = '';
    el.search.focus();
    render();
  });

  el.lockBtn.addEventListener('click', requestAdmin);

  el.title.addEventListener('pointerup', function () {
    var now = Date.now();
    if (now - lastTitleTap < DOUBLE_TAP_MS) {
      lastTitleTap = 0;
      requestAdmin();
    } else {
      lastTitleTap = now;
    }
  });

  el.adminConfirmBtn.addEventListener('click', function () {
    closeModal(el.adminDialog);
    setAdminMode(true);
  });

  el.adminCancelBtn.addEventListener('click', function () {
    closeModal(el.adminDialog);
  });

  el.deleteCancelBtn.addEventListener('click', function () {
    pendingDeleteId = null;
    closeModal(el.deleteDialog);
  });

  el.deleteConfirmBtn.addEventListener('click', function () {
    var id = pendingDeleteId;
    pendingDeleteId = null;
    closeModal(el.deleteDialog);
    if (id) removeProduct(id);
  });

  el.addBtn.addEventListener('click', function () { openDialog(null); });
  el.cancelBtn.addEventListener('click', closeDialog);
  el.form.addEventListener('submit', handleSubmit);

  /* Clic fuera del contenido: cierra cada diálogo */
  el.dialog.addEventListener('click', function (event) {
    if (isBackdropClick(event, el.dialog)) closeDialog();
  });

  el.adminDialog.addEventListener('click', function (event) {
    if (isBackdropClick(event, el.adminDialog)) closeModal(el.adminDialog);
  });

  el.deleteDialog.addEventListener('click', function (event) {
    if (isBackdropClick(event, el.deleteDialog)) {
      pendingDeleteId = null;
      closeModal(el.deleteDialog);
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === '/' && document.activeElement !== el.search && !anyDialogOpen()) {
      event.preventDefault();
      el.search.focus();
    }
  });

  /* ---------- Inicio ---------- */

  products = loadProducts();
  render();

  /* Firebase en vivo: la copia local se actualiza sola con cada cambio */
  function arrancarNube() {
    if (!window.CartaCloud || typeof window.CartaCloud.conectar !== 'function') return;

    window.CartaCloud.conectar({
      semilla: products.slice(),
      onCambio: function (items) {
        products = sanitizeItems(items);
        saveProducts();
        render();
      },
      onEstado: function (estado) {
        if (estado === estadoNube) return;
        estadoNube = estado;
        if (estado === 'sincronizado' || estado === 'sembrada') {
          showToast('Carta sincronizada con Firebase', 'success');
        } else if (estado === 'error') {
          showToast('Sin sincronización: trabajando con la copia local', 'error');
        }
      }
    }).then(function (api) {
      cloud = api || null;
    });
  }

  arrancarNube();

  window.addEventListener('storage', function (event) {
    if (event.key === STORAGE_KEY) {
      products = loadProducts();
      render();
    }
  });
})();
