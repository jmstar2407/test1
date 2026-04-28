/**
 * ════════════════════════════════════════════════════════════════════
 * MÓDULO 2: pos.js — Punto de Venta (POS) y Carrito
 * RESPONSABILIDAD: Todo lo relacionado con el proceso de venta activo.
 *
 * BENEFICIO DE SEPARACIÓN:
 *   Puedes crear versiones del POS para tablet/móvil distintas,
 *   agregar descuentos o cupones, o cambiar la lógica de ITBIS
 *   sin afectar Inventario, Caja ni Estadísticas.
 *
 * FUNCIONES EXPUESTAS EN window:
 *   agregarAlCarrito(prodId)      → Agrega producto al carrito activo
 *   cambiarQty(prodId, delta)     → Incrementa/decrementa cantidad
 *   renderCarrito()               → Re-renderiza el carrito visual
 *   abrirModalFacturar()          → Abre el modal de facturación
 *   confirmarFactura()            → Procesa y guarda la factura
 *   nuevaVenta()                  → Limpia el carrito para nueva venta
 *   seleccionarMetodo(tipo)       → Selecciona método de pago
 *   buscarProductos(texto)        → Filtra productos en el POS
 *   toggleDibujo()                → Mostrar/ocultar pad de notas
 *   limpiarDibujo()               → Limpia el pad de notas
 *   setGridSize(size)             → Cambia tamaño de la cuadrícula
 *   toggleOrdenProductos()        → Alterna orden A-Z / Original
 *   abrirModalVaciarCarrito()     → Confirma vaciar carrito
 *   confirmarVaciarCarrito()      → Vacía el carrito
 *   mobToggleCarrito()            → Alterna carrito en móvil
 *
 * SISTEMA DE MULTI-FACTURA (TABS):
 *   Cada tab representa una factura en curso. Los datos se persisten
 *   en localStorage para sobrevivir recargas.
 *
 * ESCUCHA EL EVENTO:
 *   'micolmapp:negocio-listo'  → Inicializa el POS cuando el negocio está listo
 * ════════════════════════════════════════════════════════════════════
 */

import {
  collection, doc, addDoc, updateDoc, getDoc, getDocs,
  query, where, orderBy, limit, onSnapshot, Timestamp, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { AppState }             from './app-state.js';
import { fmt, toast, abrirModal, cerrarModal } from './utils.js';
import { _fsOp }                from './offline.js';

const getDb = () => window._db;

// ═══════════════════════════════════════════════════════════════════════════
// ESTADO LOCAL DEL POS
// ═══════════════════════════════════════════════════════════════════════════

let metodoPagoSeleccionado    = 'efectivo';
let estadoFacturaSeleccionado = 'pagada';
let categoriaActual           = null;
let gridSize                  = localStorage.getItem('pos_grid_size') === 'pequena' ? 'pequena' : 'grande';
let ordenProductos            = localStorage.getItem('pos_orden_productos') || 'original';
let signaturePad              = null;
let dibujoDataURL             = null;
let facturaActualParaImprimir = null;

// Caché de grids de productos (por categoría) para render diferencial
const _gridCache      = {};
const _gridOrdenCache = {};

// Cola de productos para agregar al carrito (evita race conditions)
let _carritoQueue      = [];
let _carritoProcessing = false;
let _ultimoItemAgregado = null;

// ═══════════════════════════════════════════════════════════════════════════
// SISTEMA MULTI-FACTURA (TABS)
// ═══════════════════════════════════════════════════════════════════════════

let facturasTabs    = [];
let facturaTabActiva = null;

function _guardarDibujoTab(tabId, dataURL) {
  if (!AppState.negocioId || !tabId) return;
  const key = `dibujo_${AppState.negocioId}_${tabId}`;
  try { dataURL ? localStorage.setItem(key, dataURL) : localStorage.removeItem(key); } catch(e) {}
}
function _cargarDibujoTab(tabId) {
  if (!AppState.negocioId || !tabId) return null;
  try { return localStorage.getItem(`dibujo_${AppState.negocioId}_${tabId}`) || null; } catch { return null; }
}
function _eliminarDibujoTab(tabId) {
  if (!AppState.negocioId || !tabId) return;
  try { localStorage.removeItem(`dibujo_${AppState.negocioId}_${tabId}`); } catch(e) {}
}
function _guardarTabsEnStorage() {
  if (!AppState.negocioId) return;
  try {
    const data = facturasTabs.map(t => ({ id: t.id, nombre: t.nombre, carrito: t.carrito, direccion: t.direccion || '' }));
    localStorage.setItem(`tabs_${AppState.negocioId}`, JSON.stringify(data));
    localStorage.setItem(`tab_activa_${AppState.negocioId}`, facturaTabActiva || '');
  } catch(e) {}
}
function _cargarTabsDeStorage() {
  if (!AppState.negocioId) return;
  try {
    const raw = localStorage.getItem(`tabs_${AppState.negocioId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        facturasTabs = parsed.map(t => ({ ...t, dibujoDataURL: _cargarDibujoTab(t.id) }));
      }
    }
    const activa = localStorage.getItem(`tab_activa_${AppState.negocioId}`);
    if (activa && facturasTabs.find(t => t.id === activa)) facturaTabActiva = activa;
    else if (facturasTabs.length) facturaTabActiva = facturasTabs[0].id;
  } catch(e) {}
}

function _crearNuevaTab(nombre) {
  return { id: `tab_${Date.now()}`, nombre: nombre || `Pedido ${facturasTabs.length + 1}`, carrito: [], direccion: '', dibujoDataURL: null };
}

function getCarrito() {
  const tab = _getTabActiva();
  return tab ? tab.carrito : [];
}
function setCarrito(items) {
  const tab = _getTabActiva();
  if (tab) { tab.carrito = items; _guardarTabsEnStorage(); }
}
function _getTabActiva() {
  return facturasTabs.find(t => t.id === facturaTabActiva) || null;
}

// Exponer para uso desde auth y otros módulos
window._getTabActiva       = _getTabActiva;
window._guardarTabsEnStorage = _guardarTabsEnStorage;

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

window.addEventListener('micolmapp:negocio-listo', async () => {
  // Cargar tabs guardadas
  _cargarTabsDeStorage();
  if (!facturasTabs.length) {
    const tab = _crearNuevaTab('Pedido 1');
    facturasTabs.push(tab);
    facturaTabActiva = tab.id;
    _guardarTabsEnStorage();
  }

  // Inicializar Signature Pad
  const canvas = document.getElementById('firmaCanvas');
  if (canvas && window.SignaturePad) {
    signaturePad = new SignaturePad(canvas, { backgroundColor: 'rgb(248,250,255)' });
    signaturePad.addEventListener('endStroke', () => {
      dibujoDataURL = signaturePad.toDataURL('image/png');
      const tab = _getTabActiva();
      if (tab) { tab.dibujoDataURL = dibujoDataURL; _guardarTabsEnStorage(); }
    });
    _resizeCanvas();
  }

  renderFacturasTabs();
  renderCarrito();
});

// ─── CANVAS RESIZE ─────────────────────────────────────────────────────────

function _resizeCanvas() {
  const canvas = document.getElementById('firmaCanvas');
  if (!canvas) return;
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width  = canvas.offsetWidth  * ratio;
  canvas.height = canvas.offsetHeight * ratio;
  canvas.getContext('2d').scale(ratio, ratio);
  if (signaturePad) signaturePad.clear();
}
window.addEventListener('resize', _resizeCanvas);

// ═══════════════════════════════════════════════════════════════════════════
// UNIDADES DETALLABLES (por peso/volumen)
// ═══════════════════════════════════════════════════════════════════════════

const UNIDADES_DETALLABLES = ['libra','libras','lb','kilogramo','kilogramos','kg','kilo','kilos','onza','onzas','oz','litro','litros','lt','l'];

function esUnidadDetallable(unidad) {
  return !!unidad && UNIDADES_DETALLABLES.includes((unidad || '').toLowerCase().trim());
}
function labelUnidad(unidad) {
  const map = { libra:'lb',libras:'lb',lb:'lb',kilogramo:'kg',kilogramos:'kg',kg:'kg',kilo:'kg',kilos:'kg',onza:'oz',onzas:'oz',oz:'oz',litro:'L',litros:'L',lt:'L',l:'L' };
  return map[(unidad||'').toLowerCase().trim()] || unidad;
}
window.esUnidadDetallable = esUnidadDetallable;
window.labelUnidad        = labelUnidad;

// ═══════════════════════════════════════════════════════════════════════════
// CARRITO — AGREGAR / MODIFICAR / RENDER
// ═══════════════════════════════════════════════════════════════════════════

export function agregarAlCarrito(prodId) {
  if (!AppState.cajaActual) { toast('⚠️ La caja no está abierta', 'error'); return; }
  const prod = AppState.productos.find(p => p.id === prodId);
  if (!prod) return;
  if (prod.stockHabilitado !== false && prod.stock <= 0) { toast('Sin stock disponible', 'error'); return; }

  if (esUnidadDetallable(prod.unidad)) {
    const carrito = getCarrito();
    const idx     = carrito.findIndex(i => i.id === prod.id);
    if (idx >= 0) { carrito[idx].qty += 1; }
    else {
      const tieneCombo = prod.comboActivo && prod.comboPrecio && prod.comboUnidades >= 2;
      carrito.push(tieneCombo ? { ...prod, qty: 1 } : { ...prod, qty: 1, _precioBase: prod.precio });
    }
    setCarrito(carrito);
    _ultimoItemAgregado = prod.id;
    renderCarrito();
    return;
  }

  _ultimoItemAgregado = prodId;
  _carritoQueue.push(prodId);
  requestAnimationFrame(_procesarColaCarrito);
}

function _procesarColaCarrito() {
  if (_carritoProcessing || !_carritoQueue.length) return;
  _carritoProcessing = true;
  const prodId = _carritoQueue.shift();
  const prod   = AppState.productos.find(p => p.id === prodId);
  if (prod) _agregarAlCarritoObj(prod);
  _carritoProcessing = false;
  if (_carritoQueue.length) requestAnimationFrame(_procesarColaCarrito);
}

function _agregarAlCarritoObj(prod) {
  const carrito = getCarrito();
  const idx     = carrito.findIndex(i => i.id === prod.id);
  if (idx >= 0) {
    if (prod.stockHabilitado !== false && carrito[idx].qty >= prod.stock) { toast('No hay más stock disponible', 'error'); return; }
    carrito[idx].qty++;
  } else {
    const tieneCombo = prod.comboActivo && prod.comboPrecio && prod.comboUnidades >= 2;
    carrito.push(tieneCombo
      ? { ...prod, qty: 1, _precioInventario: prod.precio }
      : { ...prod, qty: 1, _precioBase: prod.precio, _precioInventario: prod.precio }
    );
  }
  setCarrito(carrito);
  _ultimoItemAgregado = prod.id;
  renderCarrito();
}

export function cambiarQty(prodId, delta) {
  const carrito = getCarrito();
  const idx     = carrito.findIndex(i => i.id === prodId);
  if (idx < 0) return;
  carrito[idx].qty += delta;
  if (carrito[idx].qty <= 0) carrito.splice(idx, 1);
  setCarrito(carrito);
  renderCarrito();
}

export function eliminarItemDetalle(prodId) {
  const carrito = getCarrito();
  const idx     = carrito.findIndex(i => i.id === prodId);
  if (idx >= 0) { carrito.splice(idx, 1); setCarrito(carrito); renderCarrito(); }
}

// Cálculo de precio con combo
function calcularPrecioConCombo(qty, precioUnit, comboPrecio, comboUnits) {
  const combos  = Math.floor(qty / comboUnits);
  const sueltas = qty % comboUnits;
  return (combos * comboPrecio) + (sueltas * precioUnit);
}
window.calcularPrecioConCombo = calcularPrecioConCombo;

// ═══════════════════════════════════════════════════════════════════════════
// RENDER DEL CARRITO
// ═══════════════════════════════════════════════════════════════════════════

export function renderCarrito() {
  renderFacturasTabs();
  const itemsEl = document.getElementById('carrito-items');
  const countEl = document.getElementById('carrito-count');
  const carrito  = getCarrito();
  if (countEl) countEl.textContent = carrito.length;

  const headerNombre = document.getElementById('carrito-header-nombre');
  if (headerNombre) {
    const tab = _getTabActiva();
    headerNombre.textContent = tab ? tab.nombre : 'Carrito';
  }

  if (!itemsEl) return;

  if (!carrito.length) {
    itemsEl.innerHTML = `<div class="carrito-empty"><i class="fas fa-shopping-cart"></i><p>Agrega productos al carrito</p></div>`;
  } else {
    // Render diferencial: preserva nodos existentes
    Array.from(itemsEl.children).forEach(el => { if (!el.classList.contains('carrito-item')) el.remove(); });
    const existingNodes = {};
    itemsEl.querySelectorAll('.carrito-item[data-item-id]').forEach(el => { existingNodes[el.dataset.itemId] = el; });

    const fragment = document.createDocumentFragment();
    carrito.forEach((item, i) => {
      let el = existingNodes[item.id];
      const html = esUnidadDetallable(item.unidad) ? _renderItemDetallable(item) : _renderItemNormal(item);
      if (el) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const newEl = tmp.firstElementChild;
        if (el.outerHTML !== newEl.outerHTML) {
          el.replaceWith(newEl);
          el = newEl;
        }
        fragment.appendChild(el);
      } else {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const newEl = tmp.firstElementChild;
        if (item.id === _ultimoItemAgregado) newEl.classList.add('item-glow');
        fragment.appendChild(newEl);
      }
    });
    itemsEl.innerHTML = '';
    itemsEl.appendChild(fragment);
    _ultimoItemAgregado = null;
  }

  // FAB badge móvil
  const fabBadge = document.getElementById('fab-badge');
  if (fabBadge) fabBadge.textContent = carrito.length;

  _actualizarTotalesCarrito();
}

function _renderItemNormal(item) {
  const pesoNeto = item.pesoNeto ? `<span class="peso-neto-badge">${item.pesoNeto}</span>` : '';
  if (item.comboActivo && item.comboPrecio && item.comboUnidades >= 2) {
    const subtotalReal = calcularPrecioConCombo(item.qty, item.precio, item.comboPrecio, item.comboUnidades);
    return `<div class="carrito-item" data-item-id="${item.id}">
      <div class="img-producto" style="position:relative;">${item.imagen ? `<img src="${item.imagen}" alt="${item.nombre}" onerror="this.outerHTML='<div class=&quot;item-emoji&quot;>📦</div>'">` : `<div class="item-emoji">📦</div>`}${pesoNeto}</div>
      <div class="item-info"><div class="item-nombre">${item.nombre}</div><div class="item-precio">${fmt(item.precio)} c/u · ${item.comboUnidades}x${fmt(item.comboPrecio)}</div><span class="item-subtotal">${fmt(subtotalReal)}</span></div>
      <div class="item-ctrl"><button class="qty-btn minus" onclick="cambiarQty('${item.id}',-1)">−</button><span class="qty-num">${item.qty}</span><button class="qty-btn plus" onclick="cambiarQty('${item.id}',1)">+</button></div>
    </div>`;
  }
  return `<div class="carrito-item" data-item-id="${item.id}">
    <div class="img-producto" style="position:relative;">${item.imagen ? `<img src="${item.imagen}" alt="${item.nombre}" onerror="this.outerHTML='<div class=&quot;item-emoji&quot;>📦</div>'">` : `<div class="item-emoji">📦</div>`}${pesoNeto}</div>
    <div class="item-info"><div class="item-nombre">${item.nombre}</div><div class="item-precio">${fmt(item.precio)} c/u</div><span class="item-subtotal">${fmt(item.precio * item.qty)}</span></div>
    <div class="item-ctrl"><button class="qty-btn minus" onclick="cambiarQty('${item.id}',-1)">−</button><span class="qty-num">${item.qty}</span><button class="qty-btn plus" onclick="cambiarQty('${item.id}',1)">+</button></div>
  </div>`;
}

function _renderItemDetallable(item) {
  const precioBase  = item._precioBase || item.precio;
  const unidadLabel = labelUnidad(item.unidad || '');
  const subtotal    = precioBase * item.qty;
  const qtyDisplay  = Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(2);
  const pesoNeto    = item.pesoNeto ? `<span class="peso-neto-badge">${item.pesoNeto}</span>` : '';
  return `<div class="carrito-item" data-item-id="${item.id}">
    <div class="img-producto" style="position:relative;">${item.imagen ? `<img src="${item.imagen}" alt="${item.nombre}" onerror="this.outerHTML='<div class=&quot;item-emoji&quot;>📦</div>'">` : `<div class="item-emoji" style="width:44px;height:44px;font-size:20px;">📦</div>`}${pesoNeto}</div>
    <div class="item-info" style="flex:1;min-width:0;">
      <div class="item-nombre">${item.nombre}</div>
      <div class="item-precio">${fmt(precioBase)}/${unidadLabel}</div>
      <span class="item-subtotal" id="du-subtotal-${item.id}">${fmt(subtotal)}</span>
    </div>
    <div class="btns-editar-lib">
      <div style="display:flex;gap:4px;">
        <button class="qty-btn minus" onclick="eliminarItemDetalle('${item.id}')" style="background:#fff0f0;color:#e03131;width:36px;height:36px;font-size:16px;" title="Eliminar"><i class="fas fa-trash"></i></button>
        <button onclick="abrirModalEditarDetalle('${item.id}')" style="background:#1971c2;color:white;border:none;border-radius:6px;padding:10px;font-size:12px;font-weight:700;cursor:pointer;"><i class="fas fa-pen"></i> Editar</button>
      </div>
      <span class="item-unidad-cantidad">${qtyDisplay} ${unidadLabel}</span>
    </div>
  </div>`;
}

function _actualizarTotalesCarrito() {
  const carrito      = getCarrito();
  const itbisCliente = AppState.config.itbisCliente;
  const itbisPct     = AppState.config.itbisPct / 100;

  let subtotal = 0;
  carrito.forEach(item => {
    if (item.comboActivo && item.comboPrecio && item.comboUnidades >= 2) {
      subtotal += calcularPrecioConCombo(item.qty, item.precio, item.comboPrecio, item.comboUnidades);
    } else {
      subtotal += (item._precioBase || item.precio) * item.qty;
    }
  });

  const itbis = itbisCliente ? subtotal * itbisPct : 0;
  const total  = subtotal + itbis;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('cart-subtotal', fmt(subtotal));
  set('cart-itbis',    fmt(itbis));
  set('cart-total',    fmt(total));
  const itbisRow = document.getElementById('cart-itbis-row');
  if (itbisRow) itbisRow.style.display = itbisCliente ? '' : 'none';
}

// ═══════════════════════════════════════════════════════════════════════════
// TABS (MULTI-FACTURA)
// ═══════════════════════════════════════════════════════════════════════════

export function renderFacturasTabs() {
  const bar = document.getElementById('facturas-tabs-bar');
  if (!bar) return;
  bar.innerHTML = facturasTabs.map(tab => {
    const isActiva = tab.id === facturaTabActiva;
    const count    = tab.carrito.reduce((s, i) => s + i.qty, 0);
    return `<div class="factura-tab ${isActiva ? 'activa' : ''}" onclick="seleccionarTab('${tab.id}')">
      <span class="tab-nombre">${tab.nombre}</span>
      ${count > 0 ? `<span class="tab-badge">${count}</span>` : ''}
      <button class="tab-close" onclick="event.stopPropagation();confirmarCerrarTab('${tab.id}')">✕</button>
    </div>`;
  }).join('') + `<button class="factura-tab nueva-tab-btn" onclick="agregarNuevaTab()" title="Nueva factura"><i class="fas fa-plus"></i></button>`;
}

window.renderFacturasTabs = renderFacturasTabs;

window.seleccionarTab = (tabId) => {
  const tab = facturasTabs.find(t => t.id === tabId);
  if (!tab) return;
  // Guardar dibujo de la tab actual
  const tabActual = _getTabActiva();
  if (tabActual && signaturePad) { tabActual.dibujoDataURL = signaturePad.isEmpty() ? null : signaturePad.toDataURL(); }

  facturaTabActiva = tabId;
  _guardarTabsEnStorage();

  // Restaurar dibujo de la nueva tab
  if (signaturePad) {
    signaturePad.clear();
    if (tab.dibujoDataURL) signaturePad.fromDataURL(tab.dibujoDataURL);
  }
  const dirInput = document.getElementById('pos-direccion-cliente');
  if (dirInput) dirInput.value = tab.direccion || '';

  renderCarrito();
};

window.agregarNuevaTab = () => {
  const tab = _crearNuevaTab();
  facturasTabs.push(tab);
  facturaTabActiva = tab.id;
  _guardarTabsEnStorage();
  renderFacturasTabs();
  renderCarrito();
};

window.confirmarCerrarTab = (tabId) => {
  const tab = facturasTabs.find(t => t.id === tabId);
  if (!tab) return;
  const msgEl = document.getElementById('modal-cerrar-tab-msg');
  if (msgEl) msgEl.textContent = `¿Eliminar el pedido "${tab.nombre}"?`;
  const btnEl = document.getElementById('btn-confirmar-cerrar-tab');
  if (btnEl) btnEl.onclick = () => { _cerrarTab(tabId); cerrarModal('modal-cerrar-tab'); };
  abrirModal('modal-cerrar-tab');
};

function _cerrarTab(tabId) {
  _eliminarDibujoTab(tabId);
  facturasTabs = facturasTabs.filter(t => t.id !== tabId);
  if (!facturasTabs.length) {
    const tab = _crearNuevaTab('Pedido 1');
    facturasTabs.push(tab);
  }
  if (facturaTabActiva === tabId) facturaTabActiva = facturasTabs[0].id;
  _guardarTabsEnStorage();
  if (signaturePad) signaturePad.clear();
  renderFacturasTabs();
  renderCarrito();
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL FACTURAR
// ═══════════════════════════════════════════════════════════════════════════

export function abrirModalFacturar() {
  const carrito = getCarrito();
  if (!carrito.length) { toast('El carrito está vacío', 'error'); return; }
  if (!AppState.cajaActual) { toast('⚠️ La caja no está abierta', 'error'); return; }

  const itbisCliente = AppState.config.itbisCliente;
  const itbisPct     = AppState.config.itbisPct;
  let subtotal = 0;
  const itemsHtml = carrito.map(item => {
    const sub = item.comboActivo && item.comboPrecio && item.comboUnidades >= 2
      ? calcularPrecioConCombo(item.qty, item.precio, item.comboPrecio, item.comboUnidades)
      : (item._precioBase || item.precio) * item.qty;
    subtotal += sub;
    return `<div class="mf-item-row">
      <span class="mf-col-prod">${item.nombre}</span>
      <span class="mf-col-precio">${fmt(item._precioBase || item.precio)}</span>
      <span class="mf-col-cant">${item.qty}</span>
      <span class="mf-col-sub">${fmt(sub)}</span>
    </div>`;
  }).join('');

  const itbis = itbisCliente ? subtotal * (itbisPct / 100) : 0;
  const total  = subtotal + itbis;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };
  set('factura-items-lista', itemsHtml);
  set('mfact-subtotal',  fmt(subtotal));
  set('mfact-itbis',     fmt(itbis));
  set('mfact-total',     fmt(total));
  const itbisRow = document.getElementById('mfact-itbis-row');
  if (itbisRow) itbisRow.style.display = itbisCliente ? '' : 'none';

  seleccionarMetodo('efectivo');
  abrirModal('modal-facturar');
}

export function seleccionarMetodo(tipo) {
  metodoPagoSeleccionado = tipo;
  document.querySelectorAll('.mpago-btn').forEach(btn => btn.classList.remove('selected'));
  const btn = [...document.querySelectorAll('.mpago-btn')].find(b => b.onclick?.toString().includes(`'${tipo}'`));
  if (btn) btn.classList.add('selected');

  ['efectivo-section','transferencia-section','tarjeta-section','mixto-section'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('visible');
  });
  const sec = document.getElementById(`${tipo}-section`);
  if (sec) sec.classList.add('visible');
}

window.agregarAlCarrito      = agregarAlCarrito;
window.cambiarQty            = cambiarQty;
window.eliminarItemDetalle   = eliminarItemDetalle;
window.renderCarrito         = renderCarrito;
window.abrirModalFacturar    = abrirModalFacturar;
window.seleccionarMetodo     = seleccionarMetodo;

// ═══════════════════════════════════════════════════════════════════════════
// VACIAR CARRITO
// ═══════════════════════════════════════════════════════════════════════════

window.abrirModalVaciarCarrito = () => abrirModal('modal-vaciar-carrito');
window.confirmarVaciarCarrito  = () => {
  setCarrito([]);
  const tab = _getTabActiva();
  if (tab) { tab.direccion = ''; tab.dibujoDataURL = null; _guardarTabsEnStorage(); }
  if (signaturePad) signaturePad.clear();
  const dirInput = document.getElementById('pos-direccion-cliente');
  if (dirInput) dirInput.value = '';
  renderCarrito();
  cerrarModal('modal-vaciar-carrito');
};

// ═══════════════════════════════════════════════════════════════════════════
// CONFIRMAR FACTURA
// ═══════════════════════════════════════════════════════════════════════════

window.confirmarFactura = async (esPendiente = false) => {
  const carrito = getCarrito();
  if (!carrito.length || !AppState.cajaActual || !AppState.negocioId) return;

  if (AppState.modoPrueba) {
    toast('🧪 Modo prueba: factura simulada (no se guarda)', 'warning', 4000);
    cerrarModal('modal-facturar');
    return;
  }

  const db  = getDb();
  const tab = _getTabActiva();

  // Calcular totales
  const itbisCliente = AppState.config.itbisCliente;
  const itbisPct     = AppState.config.itbisPct;
  let subtotal = 0;
  const items = carrito.map(item => {
    const precioBase = item._precioBase || item.precio;
    const sub = item.comboActivo && item.comboPrecio && item.comboUnidades >= 2
      ? calcularPrecioConCombo(item.qty, item.precio, item.comboPrecio, item.comboUnidades)
      : precioBase * item.qty;
    subtotal += sub;
    return { ...item, subtotal: sub };
  });
  const itbis = itbisCliente ? subtotal * (itbisPct / 100) : 0;
  const total  = subtotal + itbis;

  // Número de factura
  const ncfSeq = AppState.config.ncfSeq || 1;
  const numero  = ncfSeq;
  const ncf     = `${AppState.config.ncfPrefijo || 'B01'}${String(ncfSeq).padStart(8, '0')}`;

  const facturaData = {
    numero, ncf,
    items, subtotal, itbis, itbisPct, total,
    metodoPago:       metodoPagoSeleccionado,
    estado:           esPendiente ? 'pendiente' : 'pagada',
    cajaId:           AppState.cajaActual.id,
    empleadoNombre:   AppState.currentUser?.email || '—',
    fecha:            serverTimestamp(),
    direccionCliente: tab?.direccion || '',
    dibujoNota:       tab?.dibujoDataURL || null,
    montoRecibido:    parseFloat(document.getElementById('monto-recibido')?.value) || total,
  };

  try {
    const factRef = await _fsOp(() => addDoc(collection(db, 'negocios', AppState.negocioId, 'facturas'), facturaData));

    // Actualizar secuencia NCF
    await _fsOp(() => updateDoc(doc(db, 'negocios', AppState.negocioId, 'configuraciones', 'general'), { ncfSeq: ncfSeq + 1 }));
    AppState.config.ncfSeq = ncfSeq + 1;

    // Descontar stock
    if (!esPendiente) {
      const batch = writeBatch(db);
      items.forEach(item => {
        if (item.stockHabilitado !== false && item.categoriaId) {
          const prodRef = doc(db, 'negocios', AppState.negocioId, 'categorias', item.categoriaId, 'productos', item.id);
          batch.update(prodRef, { stock: Math.max(0, (item.stock || 0) - item.qty) });
          // Actualizar stock local
          const p = AppState.productos.find(pr => pr.id === item.id);
          if (p) p.stock = Math.max(0, (p.stock || 0) - item.qty);
        }
      });
      await _fsOp(() => batch.commit());
    }

    cerrarModal('modal-facturar');
    facturaActualParaImprimir = { ...facturaData, id: factRef.id, fecha: { toDate: () => new Date() } };
    _mostrarTicket(facturaActualParaImprimir);
    toast(esPendiente ? '⏳ Factura guardada como pago pendiente' : '✅ Factura procesada exitosamente', 'success', 4000);
  } catch(e) {
    toast('Error al procesar la factura: ' + (e.message || 'Error desconocido'), 'error', 5000);
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// NUEVA VENTA (limpiar carrito tras factura)
// ═══════════════════════════════════════════════════════════════════════════

window.nuevaVenta = () => {
  cerrarModal('modal-ticket');
  const tab = _getTabActiva();
  if (tab) { tab.carrito = []; tab.direccion = ''; tab.dibujoDataURL = null; _guardarTabsEnStorage(); }
  if (signaturePad) signaturePad.clear();
  const dirInput = document.getElementById('pos-direccion-cliente');
  if (dirInput) dirInput.value = '';
  renderFacturasTabs();
  renderCarrito();
};

// ═══════════════════════════════════════════════════════════════════════════
// TICKET / IMPRESIÓN
// ═══════════════════════════════════════════════════════════════════════════

function _mostrarTicket(factura) {
  const body = document.getElementById('modal-ticket-body');
  if (body) body.innerHTML = _generarHTMLTicket(factura);
  abrirModal('modal-ticket');
}

function _generarHTMLTicket(factura) {
  const fecha       = factura.fecha?.toDate ? factura.fecha.toDate() : new Date();
  const neg         = AppState.negocioData;
  const metodoLabel = { efectivo:'Efectivo', transferencia:'Transferencia', tarjeta:'Tarjeta', mixto:'Mixto' }[factura.metodoPago] || factura.metodoPago;

  const itemsHtml = (factura.items || []).map(i => {
    const base = i._precioBase || i.precio;
    const sub  = i.subtotal ?? (base * i.qty);
    const qty  = i.qty;
    let qtyStr = `Cant.: ${qty} ud${qty !== 1 ? 's' : ''} x ${base.toFixed(2)}`;
    if (i.unidad && esUnidadDetallable(i.unidad)) qtyStr = `${parseFloat(qty).toFixed(2)} ${labelUnidad(i.unidad)} x ${fmt(base)}`;
    return `<div style="padding:2px 8px 2px 4px;border-bottom:1px dashed #e0e0e0;">
      <div style="display:flex;justify-content:space-between;">
        <span style="font-weight:700;font-size:12px;">${i.nombre}</span>
        <span style="font-family:monospace;font-size:12px;font-weight:700;">${fmt(sub)}</span>
      </div>
      <div style="font-size:12px;color:#000;">${qtyStr}</div>
    </div>`;
  }).join('');

  return `<div class="ticket">
    <div class="ticket-header">
      <div style="font-size:16px;font-weight:800;">${neg?.nombre || 'Colmado'}</div>
      <div>${neg?.direccion || ''}</div><div>${neg?.telefono || ''}</div>
      ${neg?.rnc ? `<div>RNC: ${neg.rnc}</div>` : ''}
      <div style="margin-top:6px;">━━━━━━━━━━━━━━━━━━━━━━</div>
      <div>Factura: ${factura.numero}</div>${factura.ncf ? `<div>NCF: ${factura.ncf}</div>` : ''}
      <div>${fecha.toLocaleString('es-DO')}</div>
      ${factura.direccionCliente ? `<div style="margin-top:4px;"><strong>Dirección:</strong><br>${factura.direccionCliente}</div>` : ''}
    </div>
    <div style="margin:6px 4px 0;">${itemsHtml}</div>
    <div class="ticket-total">
      <div class="ticket-row"><span>Subtotal</span><span>${fmt(factura.subtotal)}</span></div>
      ${factura.itbis > 0 ? `<div class="ticket-row"><span>ITBIS (${factura.itbisPct}%)</span><span>${fmt(factura.itbis)}</span></div>` : ''}
      <div class="ticket-row" style="font-size:16px;"><span>TOTAL</span><span>${fmt(factura.total)}</span></div>
      <div class="ticket-row"><span>Método</span><span>${metodoLabel}</span></div>
    </div>
    ${factura.dibujoNota ? `<div style="margin-top:12px;border-top:1px dashed #ccc;padding-top:8px;"><strong>Nota:</strong><br><img src="${factura.dibujoNota}" style="max-width:100%;border:1px solid #ddd;border-radius:8px;margin-top:6px;"></div>` : ''}
    <div style="text-align:center;margin-top:12px;font-size:11px;">¡Gracias por su compra!</div>
  </div>`;
}

window.imprimirTicket = () => _imprimirContenido(document.getElementById('modal-ticket-body')?.innerHTML);

function _imprimirContenido(content) {
  const estilos = `body{font-family:monospace;font-size:12px;max-width:300px;margin:0 auto;}.ticket-row{display:flex;justify-content:space-between;margin-bottom:4px;}.ticket-header{text-align:center;border-bottom:1px dashed #ccc;padding-bottom:8px;margin-bottom:8px;}.ticket-total{border-top:1px dashed #ccc;padding-top:6px;margin-top:6px;font-weight:700;}`;
  let iframe = document.getElementById('_print_iframe_hidden');
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = '_print_iframe_hidden';
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
    document.body.appendChild(iframe);
  }
  const iDoc = iframe.contentWindow.document;
  iDoc.open();
  iDoc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${estilos}</style></head><body>${content}</body></html>`);
  iDoc.close();
  setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); }, 300);
}

// ═══════════════════════════════════════════════════════════════════════════
// DIBUJO / NOTA
// ═══════════════════════════════════════════════════════════════════════════

window.toggleDibujo = () => {
  const container = document.getElementById('dibujo-container');
  const icon      = document.getElementById('icon-toggle-dibujo');
  if (!container) return;
  const visible = container.classList.toggle('visible');
  if (icon) icon.className = visible ? 'fas fa-arrow-down' : 'fas fa-arrow-up';
  if (visible) { setTimeout(_resizeCanvas, 50); }
};

window.limpiarDibujo = () => {
  if (signaturePad) signaturePad.clear();
  dibujoDataURL = null;
  const tab = _getTabActiva();
  if (tab) { tab.dibujoDataURL = null; _guardarTabsEnStorage(); }
};

// ═══════════════════════════════════════════════════════════════════════════
// BÚSQUEDA Y GRID DE PRODUCTOS
// ═══════════════════════════════════════════════════════════════════════════

window.buscarProductos = (texto) => {
  const area = document.getElementById('pos-productos-area');
  if (!area) return;
  if (!texto.trim()) {
    if (categoriaActual) _mostrarGrid(categoriaActual);
    return;
  }
  const q       = texto.toLowerCase();
  const results = AppState.productos.filter(p =>
    p.nombre?.toLowerCase().includes(q) ||
    p.codigoBarras?.includes(q)
  );
  area.innerHTML = results.length
    ? results.map(p => _renderProdCard(p)).join('')
    : `<div style="text-align:center;padding:40px;color:#aab4c8;"><i class="fas fa-search" style="font-size:2rem;display:block;margin-bottom:8px;"></i>Sin resultados</div>`;
};

function _renderProdCard(prod) {
  const disponible = prod.stockHabilitado === false || prod.stock > 0;
  return `<div class="prod-card ${!disponible ? 'sin-stock' : ''}" onclick="agregarAlCarrito('${prod.id}')" style="cursor:pointer;">
    ${prod.imagen ? `<img src="${prod.imagen}" alt="${prod.nombre}" class="prod-card-img">` : `<div class="prod-card-emoji">📦</div>`}
    <div class="prod-card-nombre">${prod.nombre}</div>
    <div class="prod-card-precio">${fmt(prod.precio)}</div>
    ${!disponible ? `<div class="prod-card-agotado">AGOTADO</div>` : ''}
  </div>`;
}

function _mostrarGrid(catId) {
  const area = document.getElementById('pos-productos-area');
  if (!area) return;
  const prods = AppState.productos
    .filter(p => p.categoriaId === catId)
    .sort((a, b) => ordenProductos === 'az'
      ? a.nombre.localeCompare(b.nombre)
      : (a.orden || 9999) - (b.orden || 9999)
    );
  area.innerHTML = prods.map(p => _renderProdCard(p)).join('');
}

window.renderCategoriasPos = () => {
  const lista = document.getElementById('pos-categorias-lista');
  if (!lista) return;
  lista.innerHTML = AppState.categorias.map(cat => `
    <div class="pos-cat-item ${categoriaActual === cat.id ? 'activa' : ''}" onclick="seleccionarCatPos('${cat.id}')">
      ${cat.imagen ? `<img src="${cat.imagen}" class="pos-cat-img">` : `<span class="pos-cat-emoji">${cat.emoji || '📦'}</span>`}
      <span class="pos-cat-nombre">${cat.nombre}</span>
    </div>`).join('');
};

window.seleccionarCatPos = (catId) => {
  categoriaActual = catId;
  window.renderCategoriasPos();
  _mostrarGrid(catId);
};

// ═══════════════════════════════════════════════════════════════════════════
// TAMAÑO DE GRID Y ORDEN
// ═══════════════════════════════════════════════════════════════════════════

window.setGridSize = (size) => {
  gridSize = size;
  localStorage.setItem('pos_grid_size', size);
  const area = document.getElementById('pos-productos-area');
  if (area) { area.classList.toggle('grid-grande', size === 'grande'); area.classList.toggle('grid-pequena', size === 'pequena'); }
};

window.toggleOrdenProductos = () => {
  ordenProductos = ordenProductos === 'az' ? 'original' : 'az';
  localStorage.setItem('pos_orden_productos', ordenProductos);
  const btn = document.getElementById('btn-orden-az');
  if (btn) btn.classList.toggle('active', ordenProductos === 'az');
  if (categoriaActual) _mostrarGrid(categoriaActual);
};

// ═══════════════════════════════════════════════════════════════════════════
// ESCÁNER DE CÓDIGO DE BARRAS
// ═══════════════════════════════════════════════════════════════════════════

window.abrirScaner = () => {
  document.getElementById('scanner-input').value = '';
  abrirModal('modal-scanner');
  setTimeout(() => document.getElementById('scanner-input')?.focus(), 300);
};

window.buscarPorBarcode = () => {
  const codigo = document.getElementById('scanner-input')?.value.trim();
  if (!codigo) return;
  const prod = AppState.productos.find(p => p.codigoBarras === codigo);
  if (prod) { agregarAlCarrito(prod.id); cerrarModal('modal-scanner'); }
  else toast('Producto no encontrado con ese código', 'error');
};

console.log('[pos] Módulo POS cargado ✅');
