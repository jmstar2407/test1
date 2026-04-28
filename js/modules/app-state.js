/**
 * ════════════════════════════════════════════════════════════════════
 * MÓDULO: app-state.js
 * RESPONSABILIDAD: Estado global compartido entre todos los módulos.
 *
 * Centraliza las variables de estado de la aplicación que antes
 * estaban declaradas como `let` dentro del script monolítico.
 *
 * PATRÓN: Getters/Setters + window.* para compatibilidad cross-módulo.
 *
 * ESTADO EXPUESTO:
 *   AppState.negocioId       → ID del negocio activo
 *   AppState.negocioData     → Datos del negocio activo
 *   AppState.currentUser     → Usuario autenticado (Firebase User)
 *   AppState.userRole        → Rol del usuario: 'admin' | 'empleado'
 *   AppState.categorias      → Array de categorías del inventario
 *   AppState.productos       → Array de productos del inventario
 *   AppState.cajaActual      → Objeto de caja abierta actual
 *   AppState.config          → Configuración del negocio (ITBIS, NCF, etc.)
 *   AppState.modoPrueba      → Boolean: modo prueba activo
 *   AppState.facturasCache   → Cache de facturas cargadas
 *   AppState.movimientosCache→ Cache de movimientos de caja
 *   AppState.empleadosCache  → Cache de empleados
 * ════════════════════════════════════════════════════════════════════
 */

// ─── ESTADO CENTRAL ──────────────────────────────────────────────────────────

export const AppState = {
  // Autenticación / Negocio
  negocioId:    null,
  negocioData:  null,
  currentUser:  null,
  userRole:     null,

  // Catálogo
  categorias:   [],
  productos:    [],

  // Caja
  cajaActual:   null,

  // Configuración del negocio
  config: {
    itbisPct:     18,
    itbisCliente: false,
    ncfPrefijo:   'B01',
    ncfSeq:       1
  },

  // Modo prueba (no guarda facturas ni descuenta stock)
  modoPrueba: false,

  // Caches de listas
  facturasCache:    [],
  movimientosCache: [],
  empleadosCache:   [],

  // Suscripciones Firestore activas (para cancelarlas al cambiar de negocio)
  unsubscribers:    [],
  unsubCategorias:  null,
  unsubProductos:   {},   // { [categoriaId]: unsubFn }
  unsubConfig:      null,
  unsubEmpleados:   null,
};

// ─── EXPONER EN WINDOW (COMPATIBILIDAD CROSS-MÓDULO) ────────────────────────
// Los módulos que no importan directamente pueden leer/escribir via window.*

// negocioId y _negocioId (alias)
Object.defineProperty(window, 'negocioId', {
  get: () => AppState.negocioId,
  set: v  => { AppState.negocioId = v; },
  configurable: true
});
Object.defineProperty(window, '_negocioId', {
  get: () => AppState.negocioId,
  configurable: true
});

// negocioData
Object.defineProperty(window, 'negocioData', {
  get: () => AppState.negocioData,
  set: v  => { AppState.negocioData = v; },
  configurable: true
});

// currentUser
Object.defineProperty(window, 'currentUser', {
  get: () => AppState.currentUser,
  set: v  => { AppState.currentUser = v; },
  configurable: true
});

// categorias
Object.defineProperty(window, 'categorias', {
  get: () => AppState.categorias,
  set: v  => { AppState.categorias = v; },
  configurable: true
});

// productos
Object.defineProperty(window, 'productos', {
  get: () => AppState.productos,
  set: v  => { AppState.productos = v; },
  configurable: true
});

// cajaActual
Object.defineProperty(window, 'cajaActual', {
  get: () => AppState.cajaActual,
  set: v  => { AppState.cajaActual = v; },
  configurable: true
});

// config
Object.defineProperty(window, 'config', {
  get: () => AppState.config,
  set: v  => { AppState.config = v; },
  configurable: true
});

// modoPrueba
Object.defineProperty(window, 'modoPrueba', {
  get: () => AppState.modoPrueba,
  set: v  => { AppState.modoPrueba = v; },
  configurable: true
});

// ─── FUNCIÓN: LIMPIAR SESIÓN DE NEGOCIO ────────────────────────────────────
// Se llama al cambiar de negocio o cerrar sesión

export function limpiarSesionNegocio() {
  // Cancelar todas las suscripciones Firestore activas
  AppState.unsubscribers.forEach(u => u && u());
  AppState.unsubscribers = [];

  if (AppState.unsubCategorias) {
    AppState.unsubCategorias();
    AppState.unsubCategorias = null;
  }

  Object.values(AppState.unsubProductos).forEach(u => u && u());
  AppState.unsubProductos = {};

  if (AppState.unsubConfig) {
    AppState.unsubConfig();
    AppState.unsubConfig = null;
  }
  if (AppState.unsubEmpleados) {
    AppState.unsubEmpleados();
    AppState.unsubEmpleados = null;
  }

  // Limpiar caches
  AppState.empleadosCache   = [];
  AppState.facturasCache    = [];
  AppState.movimientosCache = [];

  // Limpiar estado de negocio
  AppState.categorias  = [];
  AppState.productos   = [];
  AppState.cajaActual  = null;
  AppState.negocioId   = null;
  AppState.negocioData = null;

  // Limpiar negocio activo en localStorage
  if (AppState.currentUser) {
    try {
      localStorage.removeItem(`negocio_activo_${AppState.currentUser.uid}`);
    } catch(e) {}
  }
}
window.limpiarSesionNegocio = limpiarSesionNegocio;

// ─── MODO PRUEBA ─────────────────────────────────────────────────────────────

export function toggleModoPrueba(activo) {
  AppState.modoPrueba = activo;
  try {
    localStorage.setItem(`modo_prueba_${AppState.negocioId || 'default'}`, activo ? '1' : '0');
  } catch(e) {}
  _aplicarModoPrueba();
}

export function _aplicarModoPrueba() {
  const badge     = document.getElementById('modo-prueba-badge');
  const warn      = document.getElementById('modo-prueba-warning');
  const chk       = document.getElementById('cfg-modo-prueba');
  const brandIcon = document.querySelector('.navbar .brand-icon');

  if (badge)     badge.style.display    = AppState.modoPrueba ? 'flex'  : 'none';
  if (warn)      warn.style.display     = AppState.modoPrueba ? 'block' : 'none';
  if (chk)       chk.checked            = AppState.modoPrueba;
  if (brandIcon) brandIcon.style.background = AppState.modoPrueba
    ? 'linear-gradient(135deg, #f59f00, #e67700)'
    : 'var(--verde)';
}

window.toggleModoPrueba  = toggleModoPrueba;
window._aplicarModoPrueba = _aplicarModoPrueba;

console.log('[app-state] Estado global inicializado ✅');
