/**
 * ════════════════════════════════════════════════════════════════════
 * MÓDULO: virtual-keyboard.js
 * RESPONSABILIDAD: Teclado numérico virtual para el POS (input de cantidades,
 *                  precios y edición de ítems en el carrito).
 *
 * FUNCIONES EXPUESTAS EN window:
 *   abrirModalEditarDetalle(prodId) → Abre el modal de edición de ítem detallable
 *   confirmarEditarDetalle()        → Aplica los cambios del modal de edición
 *   vkPress(val)                    → Maneja pulsación de tecla del teclado virtual
 *   vkBack()                        → Tecla de borrar (backspace)
 *   vkClear()                       → Limpia el input activo
 *   initVirtualKeyboard()           → Inicializa listeners del teclado virtual
 * ════════════════════════════════════════════════════════════════════
 */

import { AppState }    from './app-state.js';
import { fmt, toast, abrirModal, cerrarModal } from './utils.js';

// ─── ESTADO LOCAL ────────────────────────────────────────────────────────────

let _vkTarget    = null;   // input actualmente enfocado por el VK
let _vkProdId    = null;   // producto siendo editado
let _vkMode      = 'qty';  // 'qty' | 'precio' | 'descuento'
let _vkDecimals  = false;  // si el punto ya fue usado

// ─── INICIALIZACIÓN ──────────────────────────────────────────────────────────

export function initVirtualKeyboard() {
  // Delegar eventos de click en inputs del POS que disparen el VK
  document.addEventListener('focusin', (e) => {
    const target = e.target;
    if (!target.matches('.vk-input')) return;
    _vkTarget   = target;
    _vkProdId   = target.dataset.prodId || null;
    _vkMode     = target.dataset.vkMode || 'qty';
    _vkDecimals = (target.value || '').includes('.');
    _mostrarVK();
  });

  document.addEventListener('focusout', (e) => {
    // Pequeño delay para no cerrar si hacen click en botón del VK
    setTimeout(() => {
      const activeEl = document.activeElement;
      const vkEl     = document.getElementById('virtual-keyboard');
      if (vkEl && !vkEl.contains(activeEl) && activeEl !== _vkTarget) {
        _ocultarVK();
      }
    }, 150);
  });
}
window.initVirtualKeyboard = initVirtualKeyboard;
document.addEventListener('DOMContentLoaded', initVirtualKeyboard);

// ─── MOSTRAR / OCULTAR VK ────────────────────────────────────────────────────

function _mostrarVK() {
  const vk = document.getElementById('virtual-keyboard');
  if (vk) vk.classList.add('visible');
}

function _ocultarVK() {
  const vk = document.getElementById('virtual-keyboard');
  if (vk) vk.classList.remove('visible');
  _vkTarget   = null;
  _vkDecimals = false;
}

// ─── PULSACIÓN DE TECLA ──────────────────────────────────────────────────────

export function vkPress(val) {
  if (!_vkTarget) return;

  const current = _vkTarget.value;

  if (val === '.') {
    if (_vkDecimals) return;
    _vkDecimals    = true;
    _vkTarget.value = current + '.';
  } else {
    // Limitar longitud
    const cleaned = current.replace('.', '');
    if (cleaned.length >= 8) return;
    _vkTarget.value = current + val;
  }

  // Disparar evento change/input para que los listeners reaccionen
  _vkTarget.dispatchEvent(new Event('input', { bubbles: true }));
  _vkTarget.dispatchEvent(new Event('change', { bubbles: true }));
}
window.vkPress = vkPress;

export function vkBack() {
  if (!_vkTarget) return;
  const val = _vkTarget.value;
  if (val.slice(-1) === '.') _vkDecimals = false;
  _vkTarget.value = val.slice(0, -1);
  _vkTarget.dispatchEvent(new Event('input', { bubbles: true }));
}
window.vkBack = vkBack;

export function vkClear() {
  if (!_vkTarget) return;
  _vkTarget.value = '';
  _vkDecimals = false;
  _vkTarget.dispatchEvent(new Event('input', { bubbles: true }));
}
window.vkClear = vkClear;

// ─── CONFIRMACIÓN DESDE EL VK ────────────────────────────────────────────────

window.vkConfirm = () => {
  if (_vkMode === 'editar-detalle') {
    confirmarEditarDetalle();
  }
  _ocultarVK();
};

// ─── MODAL EDITAR ÍTEM DETALLABLE (libras, kg, etc.) ────────────────────────

export function abrirModalEditarDetalle(prodId) {
  const carrito  = window._getTabActiva ? (window._getTabActiva()?.carrito || []) : [];
  const item     = carrito.find(i => i.id === prodId);
  if (!item) return;

  _vkProdId  = prodId;

  const precioBase = item._precioBase || item.precio;
  const unidLabel  = window.labelUnidad ? window.labelUnidad(item.unidad || '') : (item.unidad || '');

  // Rellenar modal
  _setFieldVal('edit-det-nombre',    item.nombre);
  _setFieldVal('edit-det-precio',    precioBase);
  _setFieldVal('edit-det-cantidad',  item.qty);
  _setFieldVal('edit-det-unidad',    unidLabel);

  const prev = document.getElementById('edit-det-subtotal');
  if (prev) prev.textContent = fmt(precioBase * item.qty);

  // Actualizar subtotal en tiempo real al cambiar qty o precio
  ['edit-det-cantidad', 'edit-det-precio'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.removeEventListener('input', _updateEditSubtotal);
    el.addEventListener('input', _updateEditSubtotal);
  });

  abrirModal('modal-editar-detalle');
}
window.abrirModalEditarDetalle = abrirModalEditarDetalle;

function _updateEditSubtotal() {
  const qty    = parseFloat(document.getElementById('edit-det-cantidad')?.value) || 0;
  const precio = parseFloat(document.getElementById('edit-det-precio')?.value)   || 0;
  const prev   = document.getElementById('edit-det-subtotal');
  if (prev) prev.textContent = fmt(qty * precio);
}

export function confirmarEditarDetalle() {
  const qty    = parseFloat(document.getElementById('edit-det-cantidad')?.value);
  const precio = parseFloat(document.getElementById('edit-det-precio')?.value);

  if (isNaN(qty) || qty <= 0) {
    toast('La cantidad debe ser mayor a 0', 'error');
    return;
  }
  if (isNaN(precio) || precio < 0) {
    toast('El precio no puede ser negativo', 'error');
    return;
  }

  // Actualizar carrito
  const tab = window._getTabActiva ? window._getTabActiva() : null;
  if (!tab) return;
  const idx = tab.carrito.findIndex(i => i.id === _vkProdId);
  if (idx >= 0) {
    tab.carrito[idx].qty        = qty;
    tab.carrito[idx]._precioBase = precio;
    tab.carrito[idx].precio     = precio;
    if (window._guardarTabsEnStorage) window._guardarTabsEnStorage();
    if (window.renderCarrito)         window.renderCarrito();
  }

  cerrarModal('modal-editar-detalle');
  toast('Ítem actualizado ✅', 'success');
}
window.confirmarEditarDetalle = confirmarEditarDetalle;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function _setFieldVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val ?? '';
}

// ─── RENDER DEL TECLADO VIRTUAL (si no está en el HTML) ───────────────────────

function _ensureVKExistsInDOM() {
  if (document.getElementById('virtual-keyboard')) return;
  const vk = document.createElement('div');
  vk.id    = 'virtual-keyboard';
  vk.className = 'virtual-keyboard';
  vk.innerHTML = `
    <div class="vk-row">
      <button class="vk-btn" onclick="vkPress('7')">7</button>
      <button class="vk-btn" onclick="vkPress('8')">8</button>
      <button class="vk-btn" onclick="vkPress('9')">9</button>
      <button class="vk-btn vk-back" onclick="vkBack()">⌫</button>
    </div>
    <div class="vk-row">
      <button class="vk-btn" onclick="vkPress('4')">4</button>
      <button class="vk-btn" onclick="vkPress('5')">5</button>
      <button class="vk-btn" onclick="vkPress('6')">6</button>
      <button class="vk-btn vk-clear" onclick="vkClear()">C</button>
    </div>
    <div class="vk-row">
      <button class="vk-btn" onclick="vkPress('1')">1</button>
      <button class="vk-btn" onclick="vkPress('2')">2</button>
      <button class="vk-btn" onclick="vkPress('3')">3</button>
      <button class="vk-btn vk-confirm" onclick="vkConfirm()">✓</button>
    </div>
    <div class="vk-row">
      <button class="vk-btn vk-punto" onclick="vkPress('.')">.</button>
      <button class="vk-btn vk-cero" onclick="vkPress('0')">0</button>
      <button class="vk-btn vk-doble-cero" onclick="vkPress('0');vkPress('0')">00</button>
    </div>
  `;
  document.body.appendChild(vk);
}

document.addEventListener('DOMContentLoaded', _ensureVKExistsInDOM);

console.log('[virtual-keyboard] Teclado virtual cargado ✅');
