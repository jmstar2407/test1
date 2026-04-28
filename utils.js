/**
 * ════════════════════════════════════════════════════════════════════
 * MÓDULO: utils.js
 * RESPONSABILIDAD: Utilidades transversales reutilizables en toda la app.
 *
 * FUNCIONES EXPORTADAS / EXPUESTAS EN window:
 *   fmt(val)                     → Formatea número a "RD$ 0.00"
 *   fmtNum(val)                  → Formatea número quitando decimales innecesarios
 *   toast(msg, type, duration)   → Notificación flotante
 *   abrirModal(id)               → Abre un modal y gestiona historial del navegador
 *   cerrarModal(id)              → Cierra un modal
 *   showScreen(name)             → Cambia entre pantallas (loading/auth/selector/app)
 *   showPage(name)               → Cambia entre páginas dentro del app
 *   toggleNavMenu(e)             → Abre/cierra menú de 3 puntos
 *   closeNavMenu()               → Cierra menú de 3 puntos
 *   _syncClearBtn(inputId, btnId)→ Muestra/oculta botón de limpiar input
 *   _startClock()                → Inicia reloj del navbar
 *   selTipoNegocio(ctx, tipo)    → Selecciona tipo de negocio en formularios de auth
 *   PAISES_TEL                   → Array de países con prefijos telefónicos
 *   initPaisSelects()            → Inicializa selectores de país en Config
 *   autoDetectPaisTel()          → Detecta prefijo de país en número de teléfono
 *   updateTelPreview()           → Actualiza preview del teléfono formateado
 * ════════════════════════════════════════════════════════════════════
 */

// ─── FORMATEO DE MONEDA ──────────────────────────────────────────────────────

/**
 * Formatea un número como moneda dominicana.
 * @param {number} val
 * @returns {string} "RD$ 1,234.56"
 */
export function fmt(val) {
  return `RD$ ${(val || 0).toLocaleString('es-DO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

/**
 * Formatea un número eliminando decimales si son .00
 * @param {number} val
 * @returns {number|string}
 */
export function fmtNum(val) {
  const n = parseFloat(val) || 0;
  if (Number.isInteger(n)) return n;
  const r = parseFloat(n.toFixed(2));
  return Number.isInteger(r) ? r : r.toFixed(2);
}

window.fmt    = fmt;
window.fmtNum = fmtNum;

// ─── SISTEMA DE TOAST (NOTIFICACIONES) ──────────────────────────────────────

let _toastTimeout = null;

/**
 * Muestra una notificación flotante.
 * @param {string} msg        Texto del mensaje
 * @param {'success'|'error'|'warning'|'info'} type  Tipo visual
 * @param {number} duration   Duración en ms (default: 3000)
 */
export function toast(msg, type = 'info', duration = 3000) {
  let el = document.getElementById('_toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '_toast';
    el.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);
      background:#1a2135;color:#fff;padding:12px 20px;border-radius:12px;
      font-size:14px;font-weight:600;z-index:99999;opacity:0;
      transition:all 0.3s;pointer-events:none;max-width:90vw;text-align:center;
      border-left:4px solid #00b341;box-shadow:0 8px 24px rgba(0,0,0,0.25);
    `;
    document.body.appendChild(el);
  }
  const colors = {
    success: '#00b341',
    error:   '#e03131',
    warning: '#e67700',
    info:    '#1971c2'
  };
  el.style.borderLeftColor = colors[type] || colors.info;
  el.textContent  = msg;
  el.style.opacity = '1';
  el.style.transform = 'translateX(-50%) translateY(0)';
  el.className = `toast ${type}`;

  if (_toastTimeout) clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(20px)';
  }, duration);
}
window.toast = toast;

// ─── GESTIÓN DE MODALES ──────────────────────────────────────────────────────

const _modalStack = [];
window._modalStack = _modalStack;

/**
 * Abre un modal por ID y registra entrada en el historial del navegador
 * para que el botón "Atrás" lo cierre (en lugar de navegar afuera).
 */
export function abrirModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('visible');
  _modalStack.push(id);
  history.pushState({ modalOpen: id, stackLen: _modalStack.length }, '', window.location.href);
}

/**
 * Cierra un modal por ID y lo elimina del stack.
 */
export function cerrarModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('visible');
  const idx = _modalStack.lastIndexOf(id);
  if (idx !== -1) _modalStack.splice(idx, 1);
}

window.abrirModal  = abrirModal;
window.cerrarModal = cerrarModal;

// Interceptar botón "Atrás" del navegador / gesto en móvil
window.addEventListener('popstate', () => {
  if (_modalStack.length > 0) {
    const topId = _modalStack[_modalStack.length - 1];
    const el = document.getElementById(topId);
    if (el) el.classList.remove('visible');
    _modalStack.pop();
    if (_modalStack.length > 0) {
      history.pushState(
        { modalOpen: _modalStack[_modalStack.length - 1], stackLen: _modalStack.length },
        '', window.location.href
      );
    }
  }
});

// ─── NAVEGACIÓN ENTRE PANTALLAS ─────────────────────────────────────────────

const SCREENS = ['loading-screen', 'auth-screen', 'negocio-selector-screen', 'app'];
const SCREEN_MAP = { loading: 'loading-screen', auth: 'auth-screen', selector: 'negocio-selector-screen', app: 'app' };

/**
 * Cambia la pantalla visible (loading / auth / selector / app).
 * @param {'loading'|'auth'|'selector'|'app'} name
 */
export function showScreen(name) {
  SCREENS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const targetId = SCREEN_MAP[name];
  if (targetId) {
    const el = document.getElementById(targetId);
    if (el) el.style.display = '';
  }
}
window.showScreen = showScreen;

const PAGES = ['pos', 'caja', 'inventario', 'estadisticas', 'config'];

/**
 * Cambia la página dentro del área principal del app.
 * @param {string} name  nombre de la página (pos, caja, inventario, etc.)
 */
export function showPage(name) {
  PAGES.forEach(p => {
    const el = document.getElementById(`page-${p}`);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(`page-${name}`);
  if (target) target.style.display = '';

  // Actualizar botones de nav activos
  document.querySelectorAll('.nav-btn, .mob-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === name);
  });

  // Disparar evento para que cada módulo pueda reaccionar
  window.dispatchEvent(new CustomEvent('micolmapp:page-change', { detail: { page: name } }));
}
window.showPage = showPage;

// ─── MENÚ DE NAVEGACIÓN (3 PUNTOS) ──────────────────────────────────────────

export function toggleNavMenu(e) {
  e.stopPropagation();
  const dropdown = document.getElementById('nav-menu-dropdown');
  if (dropdown) dropdown.classList.toggle('open');
}

export function closeNavMenu() {
  const dropdown = document.getElementById('nav-menu-dropdown');
  if (dropdown) dropdown.classList.remove('open');
}

document.addEventListener('click', () => closeNavMenu());

window.toggleNavMenu = toggleNavMenu;
window.closeNavMenu  = closeNavMenu;

// ─── BOTÓN DE LIMPIAR INPUT ──────────────────────────────────────────────────

/**
 * Sincroniza visibilidad del botón "✕" de limpieza según si el input tiene valor.
 */
export function _syncClearBtn(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!inp || !btn) return;
  btn.style.display = inp.value ? 'block' : 'none';
}
window._syncClearBtn = _syncClearBtn;

// ─── RELOJ DEL NAVBAR ────────────────────────────────────────────────────────

export function _startClock() {
  const el = document.getElementById('nav-datetime');
  if (!el) return;
  const update = () => {
    const now = new Date();
    el.textContent = now.toLocaleString('es-DO', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };
  update();
  setInterval(update, 60_000);
}
window._startClock = _startClock;

// ─── SELECCIÓN TIPO DE NEGOCIO (FORMULARIOS AUTH) ────────────────────────────

/**
 * Maneja los botones de tipo de negocio en los formularios de registro.
 * @param {'reg'|'ns'} ctx  Contexto: 'reg' = formulario auth, 'ns' = modal selector
 * @param {string} tipo     'colmado' | 'restaurante' | 'bebida'
 */
export function selTipoNegocio(ctx, tipo) {
  const container = document.getElementById(`${ctx}-reg-tipo-btns`);
  const hidden    = document.getElementById(`${ctx}-reg-tipo`);
  if (!container || !hidden) return;
  container.querySelectorAll('.tipo-negocio-btn').forEach(btn => {
    btn.classList.toggle('activo', btn.dataset.tipo === tipo);
  });
  hidden.value = tipo;
}
window.selTipoNegocio = selTipoNegocio;

// ─── PAÍSES CON PREFIJOS TELEFÓNICOS ────────────────────────────────────────

export const PAISES_TEL = [
  { code: 'DO', name: 'República Dominicana', dial: '+1-809', flag: '🇩🇴' },
  { code: 'US', name: 'Estados Unidos',        dial: '+1',     flag: '🇺🇸' },
  { code: 'MX', name: 'México',                dial: '+52',    flag: '🇲🇽' },
  { code: 'CO', name: 'Colombia',              dial: '+57',    flag: '🇨🇴' },
  { code: 'VE', name: 'Venezuela',             dial: '+58',    flag: '🇻🇪' },
  { code: 'PR', name: 'Puerto Rico',           dial: '+1-787', flag: '🇵🇷' },
  { code: 'ES', name: 'España',                dial: '+34',    flag: '🇪🇸' },
  { code: 'AR', name: 'Argentina',             dial: '+54',    flag: '🇦🇷' },
  { code: 'CL', name: 'Chile',                 dial: '+56',    flag: '🇨🇱' },
  { code: 'PE', name: 'Perú',                  dial: '+51',    flag: '🇵🇪' },
];
window.PAISES_TEL = PAISES_TEL;

export function initPaisSelects() {
  ['cfg-tel-pais', 'cfg-ws-pais'].forEach(selId => {
    const sel = document.getElementById(selId);
    if (!sel || sel.dataset.init) return;
    sel.dataset.init = '1';
    sel.innerHTML = PAISES_TEL.map(p =>
      `<option value="${p.code}">${p.flag} ${p.name} (${p.dial})</option>`
    ).join('');
  });
}

export function autoDetectPaisTel(tel, selId, previewId) {
  if (!tel) return;
  const sel = document.getElementById(selId);
  if (!sel) return;
  const match = PAISES_TEL.find(p => tel.startsWith(p.dial));
  if (match) sel.value = match.code;
  updateTelPreview(selId, tel, previewId);
}

export function updateTelPreview(selId, val, previewId) {
  const prev = document.getElementById(previewId);
  if (!prev) return;
  const sel = document.getElementById(selId);
  const pais = PAISES_TEL.find(p => p.code === sel?.value);
  const numLimpio = val.replace(/\D/g, '');
  prev.textContent = pais && numLimpio ? `${pais.flag} ${pais.dial} ${numLimpio}` : val || '—';
}

window.initPaisSelects     = initPaisSelects;
window.autoDetectPaisTel   = autoDetectPaisTel;
window.updateTelPreview    = updateTelPreview;

// ─── CARRITO MOBILE FAB ──────────────────────────────────────────────────────

export function mobToggleCarrito() {
  const posRight = document.getElementById('pos-right');
  if (!posRight) return;
  posRight.classList.toggle('mob-visible');
  const fabLabel = document.getElementById('fab-label');
  const fabIcon  = document.getElementById('fab-icon-i');
  const visible  = posRight.classList.contains('mob-visible');
  if (fabLabel) fabLabel.textContent = visible ? 'Ver Productos' : 'Ver Carrito';
  if (fabIcon)  fabIcon.className    = visible ? 'fas fa-store' : 'fas fa-shopping-cart';
}
window.mobToggleCarrito = mobToggleCarrito;

console.log('[utils] Utilidades globales cargadas ✅');
