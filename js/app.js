import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, collectionGroup, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot, Timestamp, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyB7cX3O8Nkhg5XYsuH1UIn0ZDyxoxLzTB4",
  authDomain: "colmapp-4aaa4.firebaseapp.com",
  projectId: "colmapp-4aaa4",
  storageBucket: "colmapp-4aaa4.firebasestorage.app",
  messagingSenderId: "767529335752",
  appId: "1:767529335752:web:5967b10a0e0da050f91efd",
  measurementId: "G-22YKHGWTMH"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// â”€â”€ FIRESTORE con persistencia IndexedDB multi-pestaÃ±a (API moderna Firebase 10) â”€â”€
// persistentMultipleTabManager: todas las pestaÃ±as comparten el mismo cachÃ© IndexedDB
// onSnapshot sirve datos offline sin lecturas a red; escrituras se encolan offline
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

const storage = getStorage(app);

// â”€â”€ AUTH PERSISTENCE: mantener sesiÃ³n entre recargas sin consulta extra â”€â”€
setPersistence(auth, browserLocalPersistence).catch(() => {});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SISTEMA OFFLINE COMPLETO â€” Cola de imÃ¡genes pendientes + indicadores
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â”€â”€ Helper: ejecuta una operaciÃ³n Firestore con timeout offline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Si no hay internet, Firestore encola la op internamente y resuelve
// INMEDIATAMENTE desde el cachÃ© local. Si hay red, resuelve con el servidor.
// Esto evita que los botones queden colgados con el spinner.
async function _fsOp(fn, timeoutMs = 4000) {
  if (!navigator.onLine) {
    // Sin red: ejecutar sin esperar confirmaciÃ³n del servidor
    // Firestore offline encola la escritura y la resuelve del cachÃ©
    try {
      const result = await Promise.race([
        fn(),
        new Promise(res => setTimeout(() => res({ id: 'offline_' + Date.now() }), 800))
      ]);
      return result;
    } catch(e) {
      // Offline: ignorar error de red, devolver ID local
      return { id: 'offline_' + Date.now() };
    }
  }
  // Con red: ejecutar normalmente
  return await fn();
}

// â”€â”€ Cola de imÃ¡genes pendientes (base64 guardadas localmente hasta tener red) â”€â”€
const OFFLINE_IMG_QUEUE_KEY = 'offline_img_queue_v1';

function _getImgQueue() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_IMG_QUEUE_KEY) || '[]'); } catch { return []; }
}
function _saveImgQueue(queue) {
  try { localStorage.setItem(OFFLINE_IMG_QUEUE_KEY, JSON.stringify(queue)); } catch(e) { console.warn('No se pudo guardar cola de imÃ¡genes:', e); }
}
function _addToImgQueue(entry) {
  const queue = _getImgQueue();
  // Reemplazar si ya existe el mismo path
  const idx = queue.findIndex(e => e.path === entry.path);
  if (idx >= 0) queue[idx] = entry; else queue.push(entry);
  _saveImgQueue(queue);
  _actualizarBadgePendientes();
}
function _removeFromImgQueue(path) {
  const queue = _getImgQueue().filter(e => e.path !== path);
  _saveImgQueue(queue);
  _actualizarBadgePendientes();
}
// Actualiza el firestorePath de una entrada en la cola (Ãºtil cuando se crea un doc nuevo y se conoce su ID despuÃ©s)
function _actualizarFirestoreEnCola(dataUrlOrPath, firestorePath, field) {
  const queue = _getImgQueue();
  // Buscar por dataUrl (cuando no tenemos el path exacto)
  const idx = queue.findIndex(e => e.dataUrl === dataUrlOrPath || e.path === dataUrlOrPath);
  if (idx >= 0) {
    queue[idx].firestorePath = firestorePath;
    queue[idx].field = field || 'imagen';
    _saveImgQueue(queue);
  }
}

// â”€â”€ Actualizar badge de operaciones pendientes â”€â”€
function _actualizarBadgePendientes() {
  const queue = _getImgQueue();
  const badge = document.getElementById('offline-badge');
  if (!badge) return;
  const offline = !navigator.onLine;
  if (offline) {
    badge.style.display = 'flex';
    badge.innerHTML = '<i class="fas fa-wifi-slash"></i> SIN CONEXIÃ“N';
  } else if (queue.length > 0) {
    badge.style.display = 'flex';
    badge.style.background = '#e67700';
    badge.innerHTML = `<i class="fas fa-sync fa-spin"></i> Sincronizando ${queue.length} imagen${queue.length > 1 ? 'es' : ''}...`;
  } else {
    badge.style.display = 'none';
    badge.style.background = '#e03131';
  }
}

// â”€â”€ Sincronizar imÃ¡genes pendientes cuando vuelve la conexiÃ³n â”€â”€
async function _sincronizarImagenesPendientes() {
  const queue = _getImgQueue();
  if (!queue.length) return;
  console.log(`[Offline] Sincronizando ${queue.length} imagen(es) pendiente(s)...`);
  _actualizarBadgePendientes();

  for (const entry of [...queue]) {
    try {
      const imgRef = ref(storage, entry.path);
      await uploadString(imgRef, entry.dataUrl, 'data_url');
      const downloadURL = await getDownloadURL(imgRef);
      // Actualizar el documento en Firestore con la URL real
      if (entry.firestorePath && entry.field) {
        const parts = entry.firestorePath.split('/');
        let docRef;
        if (parts.length === 2) docRef = doc(db, parts[0], parts[1]);
        else if (parts.length === 4) docRef = doc(db, parts[0], parts[1], parts[2], parts[3]);
        else if (parts.length === 6) docRef = doc(db, parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
        if (docRef) await updateDoc(docRef, { [entry.field]: downloadURL });
      }
      _removeFromImgQueue(entry.path);
      console.log(`[Offline] Imagen sincronizada: ${entry.path}`);
    } catch(e) {
      console.warn(`[Offline] Error sincronizando imagen ${entry.path}:`, e);
    }
  }
  _actualizarBadgePendientes();
  const remaining = _getImgQueue().length;
  if (remaining === 0) {
    toast('âœ… Datos sincronizados con Firebase', 'success', 3000);
  }
}

// â”€â”€ INDICADOR OFFLINE/ONLINE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function _actualizarBadgeOffline() {
  _actualizarBadgePendientes();
}
window.addEventListener('online', async () => {
  _actualizarBadgePendientes();
  // Esperar un momento para que Firebase se reconecte
  setTimeout(async () => {
    await _sincronizarImagenesPendientes();
  }, 2000);
});
window.addEventListener('offline', _actualizarBadgeOffline);
_actualizarBadgeOffline(); // estado inicial

let negocioId = null;
let negocioData = null;
let currentUser = null;
let userRole = null;
let categorias = [];
let productos = [];

// Exponer al scope global para exportar/importar inventario
Object.defineProperty(window, '_db', { get: () => db, configurable: true });
Object.defineProperty(window, '_negocioId', { get: () => negocioId, configurable: true });
Object.defineProperty(window, 'categorias', { get: () => categorias, set: v => { categorias = v; }, configurable: true });
Object.defineProperty(window, 'productos', { get: () => productos, set: v => { productos = v; }, configurable: true });

let _invStats = { total: 0, unidades: 0, dinero: 0, porCategoria: {} }; // cachÃ© de estadÃ­sticas, se recalcula solo cuando productos cambia
let cajaActual = null;
let config = { itbisPct: 18, itbisCliente: false, ncfPrefijo: 'B01', ncfSeq: 1 }; // itbisCliente arranca false hasta que Firebase confirme el valor real
let modoPrueba = false; // Modo de prueba: no guarda facturas ni descuenta stock

window.toggleModoPrueba = (activo) => {
  modoPrueba = activo;
  // Guardar en localStorage para persistir por sesiÃ³n
  try { localStorage.setItem(`modo_prueba_${negocioId || 'default'}`, activo ? '1' : '0'); } catch(e) {}
  _aplicarModoPrueba();
};

function _aplicarModoPrueba() {
  const badge  = document.getElementById('modo-prueba-badge');
  const warn   = document.getElementById('modo-prueba-warning');
  const chk    = document.getElementById('cfg-modo-prueba');
  if (badge) badge.style.display = modoPrueba ? 'flex' : 'none';
  if (warn)  warn.style.display  = modoPrueba ? 'block' : 'none';
  if (chk)   chk.checked = modoPrueba;
  // Cambiar color del navbar brand icon para indicar modo prueba
  const brandIcon = document.querySelector('.navbar .brand-icon');
  if (brandIcon) {
    brandIcon.style.background = modoPrueba
      ? 'linear-gradient(135deg, #f59f00, #e67700)'
      : 'var(--verde)';
  }
}

let facturasPendientes = [];
let facturasCache = [];
let movimientosCache = [];
let empleadosCache = [];
let metodoPagoSeleccionado = 'efectivo';
let estadoFacturaSeleccionado = 'pagada';
let categoriaActual = null;
let gridSize = localStorage.getItem('pos_grid_size') === 'pequena' ? 'pequena' : 'grande';
let ordenProductos = localStorage.getItem('pos_orden_productos') || 'original'; // 'original' | 'az'
let invViewGrid = true;
let chartVentas = null, chartProductos = null, chartMetodos = null;
let unsubscribers = [];
let productoEnEdicion = null;
let facturaActualParaImprimir = null;
let unsubCategorias = null;
let _unsubProductos = {}; // suscripciones en tiempo real por categorÃ­a
let _unsubConfig = null;  // suscripciÃ³n en tiempo real de configuraciÃ³n
let _unsubEmpleados = null; // suscripciÃ³n en tiempo real de empleados

// NUEVAS VARIABLES PARA DIBUJO
let signaturePad = null;
let dibujoDataURL = null;

// NUEVAS VARIABLES PARA INVENTARIO
let inventarioCategoriaActual = null;
let inventarioBusquedaActual = '';
let modoOrdenActivo = false;

// ==================== SISTEMA MULTI-FACTURA ====================
// Cada factura: { id, nombre, carrito[], direccion, dibujoDataURL }
let facturasTabs = [];
let facturaTabActiva = null;

// Guarda el dibujo de UNA tab en su propia clave (separado del JSON principal)
function _guardarDibujoTab(tabId, dataURL) {
  if (!negocioId || !tabId) return;
  const key = `dibujo_${negocioId}_${tabId}`;
  try {
    if (dataURL) {
      localStorage.setItem(key, dataURL);
    } else {
      localStorage.removeItem(key);
    }
  } catch (e) {
    console.warn('No se pudo guardar el dibujo en localStorage:', e);
  }
}

// Carga el dibujo de una tab desde su propia clave
function _cargarDibujoTab(tabId) {
  if (!negocioId || !tabId) return null;
  try {
    return localStorage.getItem(`dibujo_${negocioId}_${tabId}`) || null;
  } catch (e) { return null; }
}

// Elimina el dibujo guardado de una tab (al cerrarla)
function _eliminarDibujoTab(tabId) {
  if (!negocioId || !tabId) return;
  try { localStorage.removeItem(`dibujo_${negocioId}_${tabId}`); } catch (e) { }
}

function _guardarTabsEnStorage() {
  if (!negocioId) return;
  try {
    // Guardar tabs SIN el dibujoDataURL (eso va en claves separadas)
    const data = facturasTabs.map(t => ({
      id: t.id,
      nombre: t.nombre,
      carrito: t.carrito,
      direccion: t.direccion || ''
    }));
    localStorage.setItem(`tabs_${negocioId}`, JSON.stringify(data));
    localStorage.setItem(`tab_activa_${negocioId}`, facturaTabActiva || '');
  } catch (e) { }
}

function _cargarTabsDeStorage() {
  if (!negocioId) return;
  try {
    const raw = localStorage.getItem(`tabs_${negocioId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        // Cargar cada tab y recuperar su dibujo desde su clave propia
        facturasTabs = parsed.map(t => ({
          ...t,
          dibujoDataURL: _cargarDibujoTab(t.id)
        }));
      }
    }
    const activa = localStorage.getItem(`tab_activa_${negocioId}`);
    if (activa && facturasTabs.find(t => t.id === activa)) {
      facturaTabActiva = activa;
    } else if (facturasTabs.length) {
      facturaTabActiva = facturasTabs[0].id;
    }
  } catch (e) { }
}

function _crearNuevaTab(nombre) {
  const id = 'tab_' + Date.now();
  const n = nombre || `Factura ${facturasTabs.length + 1}`;
  facturasTabs.push({ id, nombre: n, carrito: [], direccion: '', dibujoDataURL: null });
  return id;
}

function _getTabActiva() {
  return facturasTabs.find(t => t.id === facturaTabActiva) || null;
}

// Getter/setter del carrito que ahora apunta a la tab activa
function getCarrito() {
  return _getTabActiva()?.carrito || [];
}
function setCarrito(arr) {
  const tab = _getTabActiva();
  if (tab) { tab.carrito = arr; _guardarTabsEnStorage(); }
}

function renderFacturasTabs() {
  const bar = document.getElementById('facturas-tabs-bar');
  if (!bar) return;
  bar.innerHTML = facturasTabs.map(t => {
    const count = t.carrito.length; // cantidad de productos distintos, no suma de unidades
    const activa = t.id === facturaTabActiva;
    return `<button class="factura-tab${activa ? ' activa' : ''}" onclick="seleccionarTab('${t.id}')">
      <span>${t.nombre}</span>
      ${count > 0 ? `<span class="tab-badge">${count}</span>` : ''}
      ${facturasTabs.length > 1 ? `<span class="tab-close" onclick="event.stopPropagation();cerrarTab('${t.id}')" title="Cerrar" role="button" tabindex="0"><i class="fas fa-times"></i></span>` : ''}
    </button>`;
  }).join('') + `<button class="btn-nueva-factura-tab" onclick="nuevaFacturaTab()" title="Nueva factura">+</button>`;
  _actualizarBotonesScroll();
}

function _actualizarBotonesScroll() {
  const bar = document.getElementById('facturas-tabs-bar');
  const btnL = document.getElementById('tabs-scroll-left');
  const btnR = document.getElementById('tabs-scroll-right');
  if (!bar || !btnL || !btnR) return;
  const overflow = bar.scrollWidth > bar.clientWidth + 2;
  btnL.classList.toggle('visible', overflow);
  btnR.classList.toggle('visible', overflow);
}

window.scrollTabs = (dir) => {
  const bar = document.getElementById('facturas-tabs-bar');
  if (!bar) return;
  bar.scrollBy({ left: dir * 120, behavior: 'smooth' });
};

// Actualizar botones al hacer scroll manual en la barra
document.addEventListener('DOMContentLoaded', () => {
  const bar = document.getElementById('facturas-tabs-bar');
  if (bar) bar.addEventListener('scroll', _actualizarBotonesScroll);
});

window.seleccionarTab = (id) => {
  // Guardar estado actual antes de cambiar
  const tabAnterior = _getTabActiva();
  if (tabAnterior) {
    const dirInput = document.getElementById('pos-direccion-cliente');
    if (dirInput) tabAnterior.direccion = dirInput.value;
    // Guardar dibujo actual con clave propia de esa tab
    const dataAnterior = (signaturePad && !signaturePad.isEmpty()) ? signaturePad.toDataURL() : null;
    tabAnterior.dibujoDataURL = dataAnterior;
    _guardarDibujoTab(tabAnterior.id, dataAnterior);
  }
  facturaTabActiva = id;
  _guardarTabsEnStorage();
  renderFacturasTabs();
  renderCarrito();
  // Restaurar estado de la nueva tab
  const tab = _getTabActiva();
  const dirInput = document.getElementById('pos-direccion-cliente');
  if (dirInput && tab) dirInput.value = tab.direccion || '';
  // Actualizar visibilidad del botÃ³n "x" de direcciÃ³n
  _syncClearBtn('pos-direccion-cliente', 'pos-dir-clear');
  // Restaurar dibujo de la nueva tab
  dibujoDataURL = tab?.dibujoDataURL || null;
  if (signaturePad) {
    signaturePad.clear();
    if (dibujoDataURL) {
      signaturePad.fromDataURL(dibujoDataURL);
    }
  }
  _actualizarBtnLimpiar();
  // Scroll a la tab activa
  setTimeout(() => {
    const bar = document.getElementById('facturas-tabs-bar');
    const tabActEl = bar?.querySelector('.factura-tab.activa');
    if (tabActEl) tabActEl.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, 50);
};

window.nuevaFacturaTab = () => {
  // Guardar dibujo de la tab actual con su clave propia
  const tabAnterior = _getTabActiva();
  if (tabAnterior && signaturePad) {
    const dataAnterior = signaturePad.isEmpty() ? null : signaturePad.toDataURL();
    tabAnterior.dibujoDataURL = dataAnterior;
    _guardarDibujoTab(tabAnterior.id, dataAnterior);
  }
  const id = _crearNuevaTab();
  facturaTabActiva = id;
  _guardarTabsEnStorage();
  renderFacturasTabs();
  renderCarrito();
  const dirInput = document.getElementById('pos-direccion-cliente');
  if (dirInput) dirInput.value = '';
  _syncClearBtn('pos-direccion-cliente', 'pos-dir-clear');
  // Nueva tab empieza sin dibujo
  dibujoDataURL = null;
  if (signaturePad) signaturePad.clear();
  _actualizarBtnLimpiar();
};

let _tabPendienteCerrar = null;

window.cerrarTab = (id) => {
  const tab = facturasTabs.find(t => t.id === id);
  if (!tab) return;
  _tabPendienteCerrar = id;
  const qty = tab.carrito.length; // cantidad de productos distintos
  const msg = document.getElementById('modal-cerrar-tab-msg');
  if (qty > 0) {
    msg.innerHTML = `Â¿Eliminar <strong>"${tab.nombre}"</strong>?<br><span style="color:#888;font-size:13px;">Se perderÃ¡n los ${qty} producto${qty !== 1 ? 's' : ''} en el carrito.</span>`;
  } else {
    msg.innerHTML = `Â¿Cerrar <strong>"${tab.nombre}"</strong>?<br><span style="color:#888;font-size:13px;">El carrito estÃ¡ vacÃ­o.</span>`;
  }
  abrirModal('modal-cerrar-tab');
};

window.confirmarCerrarTab = () => {
  const id = _tabPendienteCerrar;
  if (!id) return;
  _tabPendienteCerrar = null;
  cerrarModal('modal-cerrar-tab');
  _eliminarDibujoTab(id); // limpiar clave de dibujo
  facturasTabs = facturasTabs.filter(t => t.id !== id);
  if (!facturasTabs.length) _crearNuevaTab('Factura 1');
  if (facturaTabActiva === id) facturaTabActiva = facturasTabs[0].id;
  _guardarTabsEnStorage();
  renderFacturasTabs();
  renderCarrito();
  const tabNueva = _getTabActiva();
  const dirInput = document.getElementById('pos-direccion-cliente');
  if (dirInput && tabNueva) dirInput.value = tabNueva.direccion || '';
  _syncClearBtn('pos-direccion-cliente', 'pos-dir-clear');
  // Restaurar dibujo de la tab que quedÃ³ activa
  dibujoDataURL = tabNueva?.dibujoDataURL || null;
  if (signaturePad) {
    signaturePad.clear();
    if (dibujoDataURL) signaturePad.fromDataURL(dibujoDataURL);
  }
  _actualizarBtnLimpiar();
};

// Retrocompatibilidad: variable carrito apunta a la tab activa
Object.defineProperty(window, 'carrito', {
  get() { return getCarrito(); },
  set(v) { setCarrito(v); }
});

// Actualizar botones scroll al cambiar tamaÃ±o de ventana
window.addEventListener('resize', _actualizarBotonesScroll);

// ==================== NAV MENU ====================
window.toggleNavMenu = (e) => {
  e.stopPropagation();
  const dd = document.getElementById('nav-menu-dropdown');
  dd.classList.toggle('open');
};
window.closeNavMenu = () => {
  const dd = document.getElementById('nav-menu-dropdown');
  if (dd) dd.classList.remove('open');
};
// Cerrar al hacer clic fuera
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('nav-menu-wrap');
  if (wrap && !wrap.contains(e.target)) closeNavMenu();
});

// ==================== TECLADO VIRTUAL TOGGLE ====================
(function () {
  const STORAGE_KEY = 'vk_enabled';
  window._vkEnabled = localStorage.getItem(STORAGE_KEY) !== 'false'; // default ON

  function updateBtn() {
    const btn = document.getElementById('btn-vk-toggle');
    if (!btn) return;
    if (window._vkEnabled) {
      btn.classList.add('active');
      btn.title = 'Teclado virtual: ACTIVO (clic para desactivar)';
    } else {
      btn.classList.remove('active');
      btn.title = 'Teclado virtual: INACTIVO (clic para activar)';
    }
  }

  // Parchear vkbOpen: esperar a que virtualKeyboard.js lo defina y luego envolverlo
  function patchVkbOpen() {
    // Si ya estÃ¡ parchado, salir
    if (window._vkbOpenOriginal) return;
    if (typeof window.vkbClose !== 'function') return; // aÃºn no cargÃ³ el mÃ³dulo

    // En este punto el mÃ³dulo ya cargÃ³ â€” buscamos vkbOpen dentro del closure
    // La forma mÃ¡s directa: sobreescribir attachVkbToInput para que los nuevos
    // listeners respeten la bandera, y ademÃ¡s parchamos vkbOpen si estÃ¡ expuesto.
    // Como vkbOpen NO estÃ¡ expuesta globalmente, usamos otro truco:
    // guardamos el attachVkbToInput original y lo envolvemos.
    const origAttach = window.attachVkbToInput;
    window.attachVkbToInput = function (inputId) {
      if (!window._vkEnabled) return; // no conectar si estÃ¡ desactivado
      origAttach(inputId);
    };

    // Para los inputs YA conectados (pos-buscar, pos-direccion-cliente),
    // bloqueamos el teclado interceptando el focus/touchstart en la fase de captura
    ['pos-buscar', 'pos-direccion-cliente'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('focus', (e) => {
        if (!window._vkEnabled) {
          // Cerrar el teclado si llegara a abrirse
          if (typeof window.vkbClose === 'function') window.vkbClose();
        }
      }, true); // captura = antes que el listener del mÃ³dulo
      el.addEventListener('touchstart', (e) => {
        if (!window._vkEnabled) {
          if (typeof window.vkbClose === 'function') window.vkbClose();
        }
      }, { capture: true, passive: true });
    });

    window._vkbOpenOriginal = true; // marcado como parchado
  }

  window.toggleVirtualKeyboard = function () {
    window._vkEnabled = !window._vkEnabled;
    localStorage.setItem(STORAGE_KEY, window._vkEnabled);
    updateBtn();
    // Si se desactiva, cerrar el teclado si estÃ¡ abierto
    if (!window._vkEnabled && typeof window.vkbClose === 'function') {
      window.vkbClose();
    }
  };

  // Aplicar botÃ³n y parche cuando el DOM estÃ© listo
  function init() {
    updateBtn();
    patchVkbOpen();
    // Reintentar el parche por si virtualKeyboard.js carga despuÃ©s
    if (!window._vkbOpenOriginal) {
      setTimeout(() => { patchVkbOpen(); updateBtn(); }, 200);
      setTimeout(() => { patchVkbOpen(); updateBtn(); }, 800);
      setTimeout(() => { patchVkbOpen(); updateBtn(); }, 2000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.addEventListener('load', init);
})();

function updateDatetime() {
  const now = new Date();
  const opts = { timeZone: 'America/Santo_Domingo', hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' };
  const dateOpts = { timeZone: 'America/Santo_Domingo', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
  const el = document.getElementById('nav-datetime');
  if (el) el.innerHTML = `${now.toLocaleDateString('es-DO', dateOpts)}<br>${now.toLocaleTimeString('es-DO', opts)}`;
}
setInterval(updateDatetime, 1000);
updateDatetime();

// ==================== AUTH ====================
window.authTab = (tab) => {
  document.getElementById('auth-login').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('auth-registro').style.display = tab === 'registro' ? 'block' : 'none';
  document.querySelectorAll('.auth-tab').forEach((b, i) => b.classList.toggle('active', (i === 0) === (tab === 'login')));
};

window.login = async () => {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (!email || !pass) { showAuthMsg('Completa todos los campos', 'error'); return; }
  try {
    showAuthMsg('Iniciando sesiÃ³n...', 'success');
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    showAuthMsg('Credenciales incorrectas. Verifica tu email y contraseÃ±a.', 'error');
  }
};

// ==================== SELECTOR TIPO NEGOCIO ====================
window.selTipoNegocio = (prefix, tipo) => {
  const container = document.getElementById(`${prefix}-reg-tipo-btns`);
  const hidden = document.getElementById(`${prefix}-reg-tipo`);
  if (!container || !hidden) return;
  hidden.value = tipo;
  const colores = {
    colmado:    { border: '#1971c2', bg: '#eff6ff', color: '#1971c2' },
    restaurante:{ border: '#e67700', bg: '#fff9db', color: '#e67700' },
    bebida:     { border: '#2f9e44', bg: '#ebfbee', color: '#2f9e44' },
  };
  container.querySelectorAll('.tipo-negocio-btn').forEach(btn => {
    const t = btn.dataset.tipo;
    const activo = t === tipo;
    const c = activo ? colores[t] : null;
    btn.style.border    = activo ? `2px solid ${c.border}` : '2px solid #e2e8f0';
    btn.style.background = activo ? c.bg : '#f8f9ff';
    btn.style.color      = activo ? c.color : '#4a5568';
  });
};

// Registrar primer negocio (desde pantalla de auth, usuario nuevo)
window.registrar = async () => {
  const nombre = document.getElementById('reg-nombre').value.trim();
  const tipo = document.getElementById('reg-tipo').value || 'colmado';
  const rnc = document.getElementById('reg-rnc').value.trim();
  const direccion = document.getElementById('reg-direccion').value.trim();
  const telefono = document.getElementById('reg-telefono').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-pass').value;
  if (!nombre || !email || !pass) { showAuthMsg('Nombre, email y contraseÃ±a son requeridos', 'error'); return; }
  if (pass.length < 6) { showAuthMsg('La contraseÃ±a debe tener mÃ­nimo 6 caracteres', 'error'); return; }
  try {
    showAuthMsg('Registrando negocio...', 'success');
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid = cred.user.uid;
    // Crear negocio con ID Ãºnico (no el UID del usuario para soportar mÃºltiples negocios)
    const negRef = await addDoc(collection(db, 'negocios'), {
      nombre, tipo, rnc, direccion, telefono,
      propietarioUid: uid,
      administradores: [uid],
      plan: 'basico',
      creadoEn: serverTimestamp()
    });
    const negId = negRef.id;
    await setDoc(doc(db, 'negocios', negId, 'configuraciones', 'general'), { itbisPct: 18, itbisCliente: true, ncfPrefijo: 'B01', ncfSeq: 1 });
    await setDoc(doc(db, 'negocios', negId, 'empleados', uid), { nombre: 'Administrador', email, rol: 'admin', uid, activo: true, creadoEn: serverTimestamp() });
    // Registrar este negocio en el perfil del usuario
    await setDoc(doc(db, 'usuarios', uid), { email, negociosAdmin: [negId], creadoEn: serverTimestamp() }, { merge: true });
    showAuthMsg('Registro exitoso. Inicia sesiÃ³n.', 'success');
    authTab('login');
  } catch (e) {
    let msg = 'Error al registrar. ';
    if (e.code === 'auth/email-already-in-use') msg += 'Ese email ya estÃ¡ registrado.';
    else msg += e.message;
    showAuthMsg(msg, 'error');
  }
};

// Logout total: desconecta completamente de Firebase Auth
window.logoutTotal = async () => {
  _limpiarSesionNegocio();
  await signOut(auth);
};

// Logout de negocio: vuelve al selector sin cerrar sesiÃ³n Firebase
window.cambiarNegocio = () => {
  _limpiarSesionNegocio();
  if (currentUser) mostrarSelectorNegocios(currentUser);
};

// Alias legacy por si algÃºn lugar llama logout()
window.logout = window.logoutTotal;

function _limpiarSesionNegocio() {
  unsubscribers.forEach(u => u && u());
  unsubscribers = [];
  if (unsubCategorias) { unsubCategorias(); unsubCategorias = null; }
  // Cancelar todas las suscripciones de productos por categorÃ­a
  Object.values(_unsubProductos).forEach(u => u && u());
  _unsubProductos = {};
  // Cancelar suscripciones de config y empleados
  if (_unsubConfig) { _unsubConfig(); _unsubConfig = null; }
  if (_unsubEmpleados) { _unsubEmpleados(); _unsubEmpleados = null; }
  empleadosCache = [];
  // Limpiar cachÃ© de grids DOM
  Object.keys(_gridCache).forEach(k => delete _gridCache[k]);
  categoriaActual = null;
  negocioId = null;
  negocioData = null;
  // Limpiar el negocio activo en cache
  if (currentUser) localStorage.removeItem(`negocio_activo_${currentUser.uid}`);
}

function showAuthMsg(msg, type) {
  const el = document.getElementById('auth-msg');
  el.className = `auth-msg ${type}`;
  el.textContent = msg;
}

// ==================== SCREENS ====================
function showScreen(screen) {
  document.getElementById('loading-screen').style.display = screen === 'loading' ? 'flex' : 'none';
  document.getElementById('auth-screen').style.display = screen === 'auth' ? 'flex' : 'none';
  document.getElementById('negocio-selector-screen').style.display = screen === 'selector' ? 'flex' : 'none';
  document.getElementById('app').style.display = screen === 'app' ? 'flex' : 'none';
}

// ==================== SELECTOR DE NEGOCIOS ====================
async function mostrarSelectorNegocios(user) {
  showScreen('selector');
  const lista = document.getElementById('ns-lista');
  lista.innerHTML = `<div style="text-align:center;padding:20px;color:#aab4c8;"><i class="fas fa-spinner fa-spin"></i> Cargando negocios...</div>`;
  document.getElementById('ns-bienvenida').textContent = `Bienvenido, ${user.email}`;
  try {
    // Buscar todos los negocios donde el usuario es admin/empleado
    const negociosIds = await _obtenerNegociosDelUsuario(user);
    if (!negociosIds.length) {
      // Si offline, buscar en cachÃ© local
      if (!navigator.onLine) {
        lista.innerHTML = `<div style="text-align:center;padding:20px;color:#e67700;"><i class="fas fa-wifi-slash" style="font-size:2rem;display:block;margin-bottom:8px;"></i><strong>Sin conexiÃ³n</strong><br><span style="font-size:13px;">Inicia sesiÃ³n con internet al menos una vez para usar el modo offline.</span></div>`;
      } else {
        lista.innerHTML = `<div style="text-align:center;padding:20px;color:#aab4c8;"><i class="fas fa-store-slash" style="font-size:2rem;display:block;margin-bottom:8px;"></i>No tienes ningÃºn negocio registrado.<br>Agrega tu primer negocio.</div>`;
      }
      return;
    }
    // Obtener datos de cada negocio (Firestore los sirve desde cachÃ© offline)
    const negocios = await Promise.all(negociosIds.map(async id => {
      try {
        const snap = await getDoc(doc(db, 'negocios', id));
        if (snap.exists()) {
          // Actualizar cachÃ© local
          try { localStorage.setItem(`negocio_data_${id}`, JSON.stringify(snap.data())); } catch(e) {}
          return { id, ...snap.data() };
        }
        // Fallback a cachÃ© local
        const cached = localStorage.getItem(`negocio_data_${id}`);
        return cached ? { id, ...JSON.parse(cached) } : null;
      } catch(e) {
        const cached = localStorage.getItem(`negocio_data_${id}`);
        return cached ? { id, ...JSON.parse(cached) } : null;
      }
    }));
    const negociosValidos = negocios.filter(Boolean);
    const offlineBanner = !navigator.onLine ? `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#664d03;"><i class="fas fa-wifi-slash"></i> <strong>Modo offline</strong> â€” Los cambios se sincronizarÃ¡n al volver la conexiÃ³n</div>` : '';
    lista.innerHTML = offlineBanner + negociosValidos.map(neg => `
      <div onclick="entrarAlNegocio('${neg.id}')" style="
        display:flex;align-items:center;gap:14px;
        background:#f8f9ff;border:2px solid #e2e8f0;border-radius:14px;
        padding:16px 18px;cursor:pointer;transition:all 0.18s;
      " onmouseover="this.style.borderColor='#1971c2';this.style.background='#eff6ff'"
         onmouseout="this.style.borderColor='#e2e8f0';this.style.background='#f8f9ff'">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,#1971c2,#1864ab);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">ðŸª</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:15px;color:#1a2135;">${neg.nombre || 'Sin nombre'}</div>
          <div style="font-size:12px;color:#718096;margin-top:2px;">${neg.direccion || ''}</div>
        </div>
        <i class="fas fa-chevron-right" style="color:#a0aec0;font-size:14px;"></i>
      </div>`).join('');
  } catch (e) {
    lista.innerHTML = `<div style="color:#e03131;text-align:center;padding:16px;">Error al cargar negocios: ${e.message}</div>`;
  }
}

async function _obtenerNegociosDelUsuario(user) {
  const ids = new Set();
  // 1. Buscar en colecciÃ³n "usuarios" (fuente principal)
  try {
    const userSnap = await getDoc(doc(db, 'usuarios', user.uid));
    if (userSnap.exists()) {
      (userSnap.data().negociosAdmin || []).forEach(id => ids.add(id));
    }
  } catch (e) { /* continuar */ }
  // 2. Buscar negocios donde sea propietario (legacy: ID = UID del propietario)
  try {
    const legacySnap = await getDoc(doc(db, 'negocios', user.uid));
    if (legacySnap.exists()) ids.add(user.uid);
  } catch (e) { /* continuar */ }
  // 3. Buscar usando collectionGroup: todos los docs "empleados" con este uid
  try {
    const empQuery = query(collectionGroup(db, 'empleados'), where('uid', '==', user.uid));
    const empSnap = await getDocs(empQuery);
    empSnap.forEach(d => {
      // El path es: negocios/{negocioId}/empleados/{uid}
      const negId = d.ref.parent.parent.id;
      if (negId) ids.add(negId);
    });
  } catch (e) { /* continuar â€” puede requerir Ã­ndice en Firestore */ }
  // 4. Cache local como Ãºltimo recurso
  try {
    const cachedNeg = localStorage.getItem(`negocio_${user.uid}`);
    if (cachedNeg) ids.add(cachedNeg);
  } catch (e) { /* continuar */ }
  return [...ids];
}

window.entrarAlNegocio = async (negId) => {
  showScreen('loading');
  try {
    // Firestore con persistentLocalCache sirve datos desde cachÃ© offline automÃ¡ticamente
    const negSnap = await getDoc(doc(db, 'negocios', negId));
    if (!negSnap.exists()) {
      // Intentar cargar desde cachÃ© local si estamos offline
      const cachedNeg = localStorage.getItem(`negocio_data_${negId}`);
      if (cachedNeg) {
        negocioId = negId;
        negocioData = JSON.parse(cachedNeg);
        userRole = localStorage.getItem(`negocio_role_${negId}_${currentUser.uid}`) || 'admin';
        localStorage.setItem(`negocio_activo_${currentUser.uid}`, negId);
        await initApp();
        if (!navigator.onLine) toast('ðŸ“± Modo offline â€” datos del cachÃ© local', 'warning', 3000);
        return;
      }
      toast('Negocio no encontrado', 'error'); showScreen('selector'); return;
    }
    negocioId = negId;
    negocioData = negSnap.data();
    // Guardar en cachÃ© local para modo offline
    try { localStorage.setItem(`negocio_data_${negId}`, JSON.stringify(negocioData)); } catch(e) {}
    const empSnap = await getDoc(doc(db, 'negocios', negocioId, 'empleados', currentUser.uid));
    if (empSnap.exists()) { userRole = empSnap.data().rol; }
    else { userRole = negocioData.propietarioUid === currentUser.uid ? 'admin' : 'empleado'; }
    try { localStorage.setItem(`negocio_role_${negId}_${currentUser.uid}`, userRole); } catch(e) {}
    // Recordar el negocio activo
    localStorage.setItem(`negocio_activo_${currentUser.uid}`, negId);
    localStorage.setItem(`negocio_${currentUser.uid}`, negId);
    await initApp();
    if (!navigator.onLine) toast('ðŸ“± Modo offline â€” los cambios se sincronizarÃ¡n al volver la conexiÃ³n', 'warning', 4000);
  } catch (e) {
    // Si falla por offline, intentar con cachÃ© local
    if (!navigator.onLine || e.code === 'unavailable') {
      const cachedNeg = localStorage.getItem(`negocio_data_${negId}`);
      if (cachedNeg) {
        negocioId = negId;
        negocioData = JSON.parse(cachedNeg);
        userRole = localStorage.getItem(`negocio_role_${negId}_${currentUser.uid}`) || 'admin';
        localStorage.setItem(`negocio_activo_${currentUser.uid}`, negId);
        try { await initApp(); } catch(e2) { console.error(e2); }
        toast('ðŸ“± Modo offline â€” funcionando con datos locales', 'warning', 4000);
        return;
      }
    }
    toast('Error al entrar al negocio: ' + e.message, 'error');
    showScreen('selector');
  }
};

// Abrir modal para agregar nuevo negocio desde el selector
window.abrirAgregarNegocio = () => {
  ['ns-reg-nombre','ns-reg-rnc','ns-reg-direccion','ns-reg-telefono'].forEach(id => document.getElementById(id).value = '');
  selTipoNegocio('ns', 'colmado'); // resetear tipo al abrir
  document.getElementById('ns-reg-msg').textContent = '';
  document.getElementById('ns-modal-nuevo').style.display = 'flex';
  _modalStack.push('ns-modal-nuevo');
  history.pushState({ modalOpen: 'ns-modal-nuevo', stackLen: _modalStack.length }, '', window.location.href);
};
window.cerrarAgregarNegocio = () => {
  document.getElementById('ns-modal-nuevo').style.display = 'none';
  const idx = _modalStack.lastIndexOf('ns-modal-nuevo');
  if (idx !== -1) _modalStack.splice(idx, 1);
};

window.registrarNuevoNegocio = async () => {
  const nombre = document.getElementById('ns-reg-nombre').value.trim();
  const tipo = document.getElementById('ns-reg-tipo').value || 'colmado';
  const rnc = document.getElementById('ns-reg-rnc').value.trim();
  const direccion = document.getElementById('ns-reg-direccion').value.trim();
  const telefono = document.getElementById('ns-reg-telefono').value.trim();
  const msgEl = document.getElementById('ns-reg-msg');
  if (!nombre) { msgEl.style.color = '#e03131'; msgEl.textContent = 'El nombre del negocio es requerido'; return; }
  msgEl.style.color = '#1971c2'; msgEl.textContent = 'Creando negocio...';
  try {
    const uid = currentUser.uid;
    const negRef = await addDoc(collection(db, 'negocios'), {
      nombre, tipo, rnc, direccion, telefono,
      propietarioUid: uid,
      administradores: [uid],
      plan: 'basico',
      creadoEn: serverTimestamp()
    });
    const negId = negRef.id;
    await setDoc(doc(db, 'negocios', negId, 'configuraciones', 'general'), { itbisPct: 18, itbisCliente: true, ncfPrefijo: 'B01', ncfSeq: 1 });
    await setDoc(doc(db, 'negocios', negId, 'empleados', uid), { nombre: 'Administrador', email: currentUser.email, rol: 'admin', uid, activo: true, creadoEn: serverTimestamp() });
    // Agregar a la lista de negocios del usuario
    const userRef = doc(db, 'usuarios', uid);
    const userSnap = await getDoc(userRef);
    const listaActual = userSnap.exists() ? (userSnap.data().negociosAdmin || []) : [];
    if (!listaActual.includes(negId)) {
      await setDoc(userRef, { email: currentUser.email, negociosAdmin: [...listaActual, negId] }, { merge: true });
    }
    msgEl.style.color = '#00b341'; msgEl.textContent = 'Â¡Negocio creado!';
    setTimeout(() => {
      cerrarAgregarNegocio();
      mostrarSelectorNegocios(currentUser);
    }, 800);
  } catch (e) {
    msgEl.style.color = '#e03131'; msgEl.textContent = 'Error: ' + e.message;
  }
};

// ==================== AUTH STATE ====================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    // Verificar si habÃ­a un negocio activo en sesiÃ³n anterior
    const negActivo = localStorage.getItem(`negocio_activo_${user.uid}`);
    if (negActivo) {
      // Intentar entrar directamente al negocio activo
      await entrarAlNegocio(negActivo);
    } else {
      await mostrarSelectorNegocios(user);
    }
  } else {
    currentUser = null;
    negocioId = null;
    negocioData = null;
    showScreen('auth');
  }
});

async function initApp() {
  showScreen('loading');

  // â”€â”€ CONFIG: onSnapshot sirve desde cachÃ© offline, actualiza en vivo si hay red â”€â”€
  if (_unsubConfig) { _unsubConfig(); _unsubConfig = null; }
  _unsubConfig = onSnapshot(
    doc(db, 'negocios', negocioId, 'configuraciones', 'general'),
    (snap) => {
      if (snap.exists()) {
        config = { itbisPct: 18, itbisCliente: true, ncfPrefijo: 'B01', ncfSeq: 1, ...snap.data() };
        // Reflejar en UI de config si ya estÃ¡ montada
        const el = document.getElementById('cfg-itbis-pct');
        if (el) el.value = config.itbisPct ?? 18;
      }
    },
    () => {} // ignorar error â€” usar config default
  );

  // â”€â”€ EMPLEADOS: onSnapshot mantiene empleadosCache siempre actualizado â”€â”€â”€â”€â”€
  if (_unsubEmpleados) { _unsubEmpleados(); _unsubEmpleados = null; }
  _unsubEmpleados = onSnapshot(
    collection(db, 'negocios', negocioId, 'empleados'),
    (snap) => {
      empleadosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Si la pÃ¡gina de config ya estÃ¡ visible, re-renderizar lista de empleados
      if (document.getElementById('page-config')?.classList.contains('active')) {
        renderEmpleados();
      }
    },
    () => {} // ignorar error offline
  );

  document.getElementById('nav-negocio-nombre').textContent = negocioData.nombre || 'Mi Colmado';
  buildNavbar();
  // Restaurar modo prueba desde localStorage
  try {
    const savedModo = localStorage.getItem(`modo_prueba_${negocioId}`);
    if (savedModo !== null) modoPrueba = savedModo === '1';
  } catch(e) {}
  _aplicarModoPrueba();

  suscribirCaja();
  suscribirInventario();

  // Inicializar sistema multi-factura
  _cargarTabsDeStorage();
  if (!facturasTabs.length) { _crearNuevaTab('Factura 1'); facturaTabActiva = facturasTabs[0].id; }
  if (!facturaTabActiva) facturaTabActiva = facturasTabs[0].id;

  // Restaurar dibujo de la tab activa al cargar
  const tabInicial = _getTabActiva();
  if (tabInicial?.dibujoDataURL) { dibujoDataURL = tabInicial.dibujoDataURL; }

  inicializarSignaturePad();
  // Restaurar estado del panel de dibujo DESPUÃ‰S de inicializar el pad y cargar el dibujo
  restaurarEstadoDibujo();
  // Actualizar color del botÃ³n limpiar segÃºn si hay dibujo guardado
  _actualizarBtnLimpiar();

  // Restaurar botones de grid segÃºn preferencia guardada
  const bg = document.getElementById('btn-grid-grande');
  const bp = document.getElementById('btn-grid-peq');
  if (bg) bg.classList.toggle('active', gridSize === 'grande');
  if (bp) bp.classList.toggle('active', gridSize === 'pequena');

  showScreen('app');
  showPage('pos');
  // Sincronizar imÃ¡genes pendientes si hay conexiÃ³n
  if (navigator.onLine) {
    setTimeout(_sincronizarImagenesPendientes, 3000);
  }

  // Restaurar direcciÃ³n del cliente de la tab activa al refrescar
  const dirInputInit = document.getElementById('pos-direccion-cliente');
  if (dirInputInit && tabInicial?.direccion) {
    dirInputInit.value = tabInicial.direccion;
    const dirClearBtn = document.getElementById('pos-dir-clear');
    if (dirClearBtn) dirClearBtn.style.display = tabInicial.direccion ? 'flex' : 'none';
  }
  _syncClearBtn('pos-direccion-cliente', 'pos-dir-clear');
  _syncClearBtn('pos-buscar', 'pos-buscar-clear');

  // Verificar si hay pedido entrante en la URL
  setTimeout(() => { manejarPedidoEntrante(); }, 800);
}

// ==================== NAVBAR ====================
function buildNavbar() {
  // Mostrar email del usuario en el menÃº
  const emailEl = document.getElementById('nav-email-txt');
  if (emailEl && currentUser) emailEl.textContent = currentUser.email;
  const btns = document.getElementById('nav-buttons');
  const pages = [
    { id: 'pos', label: 'FacturaciÃ³n', icon: 'fa-cash-register', roles: ['admin', 'empleado'] },
    { id: 'caja', label: 'Caja', icon: 'fa-cash-register', roles: ['admin', 'empleado'] },
    { id: 'facturas', label: 'Facturas', icon: 'fa-file-invoice', roles: ['admin', 'empleado'] },
    { id: 'inventario', label: 'Inventario', icon: 'fa-boxes', roles: ['admin'] },
    { id: 'estadisticas', label: 'Contab.', icon: 'fa-chart-line', roles: ['admin'] },
    { id: 'config', label: 'Config.', icon: 'fa-cog', roles: ['admin'] },
  ];
  const visiblePages = pages.filter(p => p.roles.includes(userRole));
  const abierta = !!cajaActual;

  // Desktop nav buttons
  btns.innerHTML = visiblePages.map(p => {
    if (p.id === 'caja') {
      const dot = `<span class="caja-status-dot ${abierta ? 'abierta' : 'cerrada'}"></span>`;
      return `<div style="position:relative;display:inline-flex;align-items:center;"><button class="nav-btn" id="navbtn-${p.id}" onclick="showPage('${p.id}')"><i class="fas ${p.icon}"></i> ${p.label}</button>${dot}</div>`;
    }
    return `<button class="nav-btn" id="navbtn-${p.id}" onclick="showPage('${p.id}')"><i class="fas ${p.icon}"></i> ${p.label}</button>`;
  }).join('');

  // Mobile bottom nav
  const mobNav = document.getElementById('mobile-bottom-nav');
  if (mobNav) {
    const pagesHtml = visiblePages.map(p => {
      const dot = p.id === 'caja'
        ? `<span class="mob-caja-dot ${abierta ? 'abierta' : 'cerrada'}"></span>` : '';
      return `<button class="mob-nav-btn" id="mob-navbtn-${p.id}" onclick="showPage('${p.id}')">
        ${dot}<i class="fas ${p.icon}"></i><span>${p.label}</span>
      </button>`;
    }).join('');
    // Slot para el botÃ³n de menÃº (3 puntos) â€” el elemento real se mueve aquÃ­ con CSS
    mobNav.innerHTML = pagesHtml + '<div class="mob-nav-menu-slot" id="mob-nav-menu-slot"></div>';
    // Mover el nav-menu-wrap al slot del bottom nav en mÃ³vil
    const menuWrap = document.getElementById('nav-menu-wrap');
    const slot = document.getElementById('mob-nav-menu-slot');
    if (menuWrap && slot) slot.appendChild(menuWrap);
  }
}

window.showPage = (pageId) => {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.mob-nav-btn').forEach(b => b.classList.remove('active'));
  const page = document.getElementById(`page-${pageId}`);
  if (page) page.classList.add('active');
  const btn = document.getElementById(`navbtn-${pageId}`);
  if (btn) btn.classList.add('active');
  const mobBtn = document.getElementById(`mob-navbtn-${pageId}`);
  if (mobBtn) mobBtn.classList.add('active');
  // FAB solo visible en la secciÃ³n de facturaciÃ³n (POS)
  document.body.classList.toggle('en-pos', pageId === 'pos');
  if (window._actualizarVisibilidadFab) window._actualizarVisibilidadFab();
  if (pageId === 'estadisticas') { estadisticasHoy(); }
  if (pageId === 'inventario') { renderInventario(); populateCatSelects(); }
  if (pageId === 'config') { renderConfig(); renderEmpleados(); }
  if (pageId === 'facturas') { cargarFacturas(); }
  if (pageId === 'caja') { renderCaja(); }
  if (pageId === 'pos') {
    renderFacturasTabs();
    renderCarrito();
    // Asegurar que el grid de la categorÃ­a activa sea visible
    if (categoriaActual && !_gridNecesitaActualizar(categoriaActual)) {
      _mostrarGrid(categoriaActual);
    } else if (categoriaActual) {
      _llenarGrid(categoriaActual);
      _mostrarGrid(categoriaActual);
    }
  }
};

// ==================== INVENTARIO SUSCRIPCION ====================
function suscribirInventario() {
  if (unsubCategorias) unsubCategorias();
  const catsRef = collection(db, 'negocios', negocioId, 'categorias');
  unsubCategorias = onSnapshot(catsRef, (snap) => {
    const nuevasCats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    nuevasCats.sort((a, b) => {
      const oa = a.orden ?? 9999;
      const ob = b.orden ?? 9999;
      if (oa !== ob) return oa - ob;
      return (a.nombre || '').localeCompare(b.nombre || '');
    });

    // Detectar si las categorÃ­as realmente cambiaron antes de re-renderizar
    const catsStr = JSON.stringify(nuevasCats);
    const catsAnteriorStr = JSON.stringify(categorias);
    const catsChanged = catsStr !== catsAnteriorStr;

    categorias = nuevasCats;

    if (catsChanged) {
      renderCategoriasPos();
      populateCatSelects();
    }

    // Suscribir productos de categorÃ­as nuevas, desuscribir las eliminadas
    _sincronizarSuscripcionesProductos();
  });
}

function _sincronizarSuscripcionesProductos() {
  const catIds = new Set(categorias.map(c => c.id));

  // Desuscribir categorÃ­as eliminadas
  Object.keys(_unsubProductos).forEach(catId => {
    if (!catIds.has(catId)) {
      _unsubProductos[catId]();
      delete _unsubProductos[catId];
      // Eliminar productos de esa categorÃ­a
      productos = productos.filter(p => p.categoriaId !== catId);
    }
  });

  // Suscribir categorÃ­as nuevas
  categorias.forEach(cat => {
    if (_unsubProductos[cat.id]) return; // ya suscrita
    const prodsRef = collection(db, 'negocios', negocioId, 'categorias', cat.id, 'productos');
    _unsubProductos[cat.id] = onSnapshot(prodsRef, (snap) => {
      _actualizarProductosDeCat(cat.id, snap);
    });
  });
}

function _actualizarProductosDeCat(catId, snap) {
  const cat = categorias.find(c => c.id === catId);
  const catNombre = cat ? cat.nombre : '';

  const nuevosDeEstaCat = snap.docs.map(d => ({
    id: d.id,
    categoriaId: catId,
    categoriaNombre: catNombre,
    ...d.data()
  }));

  // Detectar si algo realmente cambiÃ³ para esta categorÃ­a
  const anterioresDeEstaCat = productos.filter(p => p.categoriaId === catId);
  const anteriorStr = JSON.stringify(anterioresDeEstaCat.map(p => ({ ...p })).sort((a,b) => a.id.localeCompare(b.id)));
  const nuevoStr = JSON.stringify(nuevosDeEstaCat.map(p => ({ ...p })).sort((a,b) => a.id.localeCompare(b.id)));

  if (anteriorStr === nuevoStr) return; // Sin cambios reales, no re-renderizar

  // Reemplazar productos de esta categorÃ­a
  productos = productos.filter(p => p.categoriaId !== catId).concat(nuevosDeEstaCat);
  productos.sort((a, b) => {
    if (a.categoriaId !== b.categoriaId) return 0;
    return (a.orden ?? 9999) - (b.orden ?? 9999);
  });

  _recalcularInvStats();
  actualizarConteosCategorias();

  // Actualizar contenido del grid de la categorÃ­a que cambiÃ³ (sin eliminarlo del DOM)
  // Esto evita parpadeos y problemas de visibilidad
  _llenarGrid(catId);

  // Si "mÃ¡s vendidos" puede verse afectada, actualizarla tambiÃ©n
  if (catId !== '__mas_vendidos__') {
    _llenarGrid('__mas_vendidos__');
  }

  // Garantizar que el grid activo siga visible (nunca quitar visibilidad al activo)
  if (categoriaActual) {
    _mostrarGrid(categoriaActual);
  }

  renderInventario();
}

// ==================== CAJA ====================
function suscribirCaja() {
  const cajaRef = collection(db, 'negocios', negocioId, 'caja');
  const q = query(cajaRef, where('estado', '==', 'abierta'), limit(1));
  const unsub = onSnapshot(q, (snap) => {
    if (!snap.empty) { cajaActual = { id: snap.docs[0].id, ...snap.docs[0].data() }; }
    else { cajaActual = null; }
    updateCajaBanner();
    renderCaja();
  });
  unsubscribers.push(unsub);
}

function updateCajaBanner() {
  const banner = document.getElementById('caja-pendiente-banner');
  if (!cajaActual) { banner.classList.add('visible'); }
  else { banner.classList.remove('visible'); }
  // Actualizar dot de estado de caja en desktop y mobile
  document.querySelectorAll('.caja-status-dot, .mob-caja-dot').forEach(el => {
    el.className = el.className.replace(/\b(abierta|cerrada)\b/g, '');
    el.classList.add(cajaActual ? 'abierta' : 'cerrada');
  });
}

window.abrirModalAbrirCaja = () => {
  document.getElementById('caja-monto-inicial').value = '';
  document.getElementById('caja-notas-apertura').value = '';
  abrirModal('modal-abrir-caja');
};

window.abrirCaja = async () => {
  const monto = parseFloat(document.getElementById('caja-monto-inicial').value) || 0;
  const notas = document.getElementById('caja-notas-apertura').value;
  const empNombre = await getEmpNombre();
  const _offlineAC = !navigator.onLine;
  try {
    await _fsOp(() => addDoc(collection(db, 'negocios', negocioId, 'caja'), { estado: 'abierta', montoInicial: monto, fechaApertura: serverTimestamp(), uid: currentUser.uid, empleadoNombre: empNombre, notas, ingresos: 0, gastos: 0 }));
    cerrarModal('modal-abrir-caja');
    toast(_offlineAC ? 'ðŸ“± Caja abierta localmente â€” se sincronizarÃ¡ con Firebase' : 'Caja abierta exitosamente âœ…', _offlineAC ? 'warning' : 'success', _offlineAC ? 5000 : 3000);
  } catch (e) { toast('Error al abrir caja: ' + e.message, 'error'); }
};

async function getEmpNombre() {
  const emp = empleadosCache.find(e => e.uid === currentUser.uid);
  return emp ? emp.nombre : currentUser.email;
}

window.abrirModalCerrarCaja = () => {
  if (!cajaActual) return;
  const ingresos = cajaActual.ingresos || 0;
  const gastos = cajaActual.gastos || 0;
  const esperado = (cajaActual.montoInicial || 0) + ingresos - gastos;
  document.getElementById('cc-monto-inicial').textContent = fmt(cajaActual.montoInicial || 0);
  document.getElementById('cc-ingresos').textContent = fmt(ingresos);
  document.getElementById('cc-gastos').textContent = fmt(gastos);
  document.getElementById('cc-total').textContent = fmt(esperado);
  document.getElementById('caja-monto-final').value = '';
  document.getElementById('diferencia-caja').style.display = 'none';
  abrirModal('modal-cerrar-caja');
};

window.calcularDiferencia = () => {
  if (!cajaActual) return;
  const final = parseFloat(document.getElementById('caja-monto-final').value) || 0;
  const ingresos = cajaActual.ingresos || 0;
  const gastos = cajaActual.gastos || 0;
  const esperado = (cajaActual.montoInicial || 0) + ingresos - gastos;
  const diff = final - esperado;
  const el = document.getElementById('diferencia-caja');
  el.style.display = 'block';
  if (Math.abs(diff) < 0.01) { el.style.background = '#d4edda'; el.style.color = '#155724'; el.textContent = 'âœ… Caja cuadra perfectamente'; }
  else if (diff > 0) { el.style.background = '#fff3cd'; el.style.color = '#856404'; el.textContent = `âš ï¸ Sobrante: ${fmt(diff)}`; }
  else { el.style.background = '#f8d7da'; el.style.color = '#721c24'; el.textContent = `âŒ Faltante: ${fmt(Math.abs(diff))}`; }
};

window.cerrarCaja = async () => {
  if (!cajaActual) return;
  const final = parseFloat(document.getElementById('caja-monto-final').value);
  if (isNaN(final)) { toast('Ingresa el monto final', 'error'); return; }
  const notas = document.getElementById('caja-notas-cierre').value;
  const empNombre = await getEmpNombre();
  const _offlineCC = !navigator.onLine;
  try {
    await _fsOp(() => updateDoc(doc(db, 'negocios', negocioId, 'caja', cajaActual.id), { estado: 'cerrada', montoFinal: final, fechaCierre: serverTimestamp(), notasCierre: notas, empleadoCierreNombre: empNombre }));
    cerrarModal('modal-cerrar-caja');
    toast(_offlineCC ? 'ðŸ“± Caja cerrada localmente â€” se sincronizarÃ¡ con Firebase' : 'Caja cerrada correctamente âœ…', _offlineCC ? 'warning' : 'success', _offlineCC ? 5000 : 3000);
  } catch (e) { toast('Error: ' + e.message, 'error'); }
};

window.abrirModalGasto = () => {
  if (!cajaActual) { toast('La caja debe estar abierta', 'error'); return; }
  document.getElementById('gasto-desc').value = '';
  document.getElementById('gasto-monto').value = '';
  abrirModal('modal-gasto');
};

window.registrarGasto = async () => {
  const desc = document.getElementById('gasto-desc').value.trim();
  const monto = parseFloat(document.getElementById('gasto-monto').value);
  const cat = document.getElementById('gasto-cat').value;
  if (!desc || isNaN(monto) || monto <= 0) { toast('Completa todos los campos', 'error'); return; }
  const empNombre = await getEmpNombre();
  const _offlineRG = !navigator.onLine;
  try {
    _fsOp(() => addDoc(collection(db, 'negocios', negocioId, 'movimientos'), { tipo: 'gasto', descripcion: desc, categoria: cat, monto, fecha: serverTimestamp(), uid: currentUser.uid, empleadoNombre: empNombre, cajaId: cajaActual.id }));
    cajaActual.gastos = (cajaActual.gastos || 0) + monto;
    _fsOp(() => updateDoc(doc(db, 'negocios', negocioId, 'caja', cajaActual.id), { gastos: cajaActual.gastos }));
    // Agregar al cache local inmediatamente
    movimientosCache.unshift({ tipo: 'gasto', descripcion: desc, categoria: cat, monto, fecha: { toDate: () => new Date() }, empleadoNombre: empNombre });
    cerrarModal('modal-gasto');
    toast(_offlineRG ? 'ðŸ“± Gasto registrado localmente â€” se sincronizarÃ¡ con Firebase' : 'Gasto registrado âœ…', _offlineRG ? 'warning' : 'success', _offlineRG ? 5000 : 3000);
    renderMovimientos();
  } catch (e) { toast('Error: ' + e.message, 'error'); }
};

async function cargarMovimientosHoy() {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const q = query(collection(db, 'negocios', negocioId, 'movimientos'), where('fecha', '>=', Timestamp.fromDate(hoy)), orderBy('fecha', 'desc'));
  const snap = await getDocs(q);
  movimientosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderMovimientos();
}

function renderMovimientos() {
  const tbody = document.getElementById('tbody-movimientos');
  if (!tbody) return;
  if (!movimientosCache.length) { tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="fas fa-inbox"></i><p>Sin movimientos hoy</p></div></td></tr>`; return; }
  tbody.innerHTML = movimientosCache.map(m => { const fecha = m.fecha?.toDate ? m.fecha.toDate() : new Date(); return `<tr><td>${fecha.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}</td><td><span class="badge ${m.tipo}">${m.tipo === 'ingreso' ? 'ðŸŸ¢ Ingreso' : 'ðŸ”´ Gasto'}</span></td><td>${m.descripcion || '-'}</td><td>${m.empleadoNombre || '-'}</td><td style="font-family:var(--font-mono);font-weight:700;color:${m.tipo === 'ingreso' ? '#00b341' : '#e03131'};">${m.tipo === 'ingreso' ? '+' : '-'}${fmt(m.monto)}</td></tr>`; }).join('');
}

async function cargarHistorialCaja() {
  const q = query(collection(db, 'negocios', negocioId, 'caja'), orderBy('fechaApertura', 'desc'), limit(20));
  const snap = await getDocs(q);
  const tbody = document.getElementById('tbody-historial-caja');
  if (!tbody) return;
  const rows = snap.docs.map(d => { const data = d.data(); const apertura = data.fechaApertura?.toDate ? data.fechaApertura.toDate().toLocaleString('es-DO') : '-'; const cierre = data.fechaCierre?.toDate ? data.fechaCierre.toDate().toLocaleString('es-DO') : '-'; return `<tr><td>${apertura}</td><td>${cierre}</td><td>${data.empleadoNombre || '-'}</td><td style="font-family:var(--font-mono);">${fmt(data.montoInicial || 0)}</td><td style="font-family:var(--font-mono);">${data.montoFinal !== undefined ? fmt(data.montoFinal) : '-'}</td><td><span class="badge ${data.estado}">${data.estado}</span></td></tr>`; });
  tbody.innerHTML = rows.join('') || `<tr><td colspan="6" style="text-align:center;color:var(--gris-suave);">Sin registros</td></tr>`;
}

function renderCaja() {
  const card = document.getElementById('caja-estado-card');
  if (!card) return;
  if (cajaActual) {
    const apertura = cajaActual.fechaApertura?.toDate ? cajaActual.fechaApertura.toDate().toLocaleString('es-DO') : 'Desconocida';
    const ingresos = cajaActual.ingresos || 0;
    const gastos = cajaActual.gastos || 0;
    const total = (cajaActual.montoInicial || 0) + ingresos - gastos;
    card.innerHTML = `<div class="caja-estado-icon">ðŸŸ¢</div><h2>Caja Abierta</h2><p>Apertura: ${apertura} â€¢ Por: ${cajaActual.empleadoNombre || '-'}</p><div class="caja-info-grid"><div class="caja-info-item"><label>Monto Inicial</label><span>${fmt(cajaActual.montoInicial || 0)}</span></div><div class="caja-info-item"><label>Ingresos</label><span style="color:#00b341">+${fmt(ingresos)}</span></div><div class="caja-info-item"><label>Gastos</label><span style="color:#e03131">-${fmt(gastos)}</span></div><div class="caja-info-item"><label>Total Esperado</label><span>${fmt(total)}</span></div></div><div class="caja-btns"><button class="btn-caja gasto" onclick="abrirModalGasto()"><i class="fas fa-minus-circle"></i> Registrar Gasto</button><button class="btn-caja cerrar" onclick="abrirModalCerrarCaja()"><i class="fas fa-lock"></i> Cerrar Caja</button></div>`;
  } else {
    card.innerHTML = `<div class="caja-estado-icon">ðŸ”´</div><h2>Caja Cerrada</h2><p>No hay caja abierta. Debes abrir la caja para poder realizar ventas.</p><div class="caja-btns"><button class="btn-caja abrir" onclick="abrirModalAbrirCaja()"><i class="fas fa-lock-open"></i> Abrir Caja</button></div>`;
  }
  cargarMovimientosHoy();
  cargarHistorialCaja();
}

// ==================== HELPERS ====================
function fmt(val) { return `RD$ ${(val || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtNum(val) { const n = parseFloat(val) || 0; if (Number.isInteger(n)) return n; const r = parseFloat(n.toFixed(2)); return Number.isInteger(r) ? r : r.toFixed(2); }

// â”€â”€ MODAL HISTORY MANAGER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Mantiene un stack de modales abiertos. Cada vez que se abre un modal
// se empuja una entrada al historial del navegador, y cuando el usuario
// presiona "atrÃ¡s" (popstate) se cierra el modal mÃ¡s reciente en lugar
// de salir de la pÃ¡gina.
const _modalStack = [];
window._modalStack = _modalStack;

window.abrirModal = (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('visible');
  _modalStack.push(id);
  // Empujamos una entrada al historial para "capturar" el botÃ³n atrÃ¡s
  history.pushState({ modalOpen: id, stackLen: _modalStack.length }, '', window.location.href);
};

window.cerrarModal = (id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('visible');
  // Quitar del stack (puede estar en cualquier posiciÃ³n si se cerrÃ³ programÃ¡ticamente)
  const idx = _modalStack.lastIndexOf(id);
  if (idx !== -1) _modalStack.splice(idx, 1);
};

// Interceptar el botÃ³n atrÃ¡s del navegador / gesto en mÃ³vil
window.addEventListener('popstate', (e) => {
  if (_modalStack.length > 0) {
    // Cerrar el modal mÃ¡s reciente
    const topId = _modalStack[_modalStack.length - 1];
    const el = document.getElementById(topId);
    if (el) el.classList.remove('visible');
    _modalStack.pop();
    // Si todavÃ­a quedan modales en el stack, re-empujamos una entrada
    // para que el prÃ³ximo "atrÃ¡s" tambiÃ©n sea interceptado
    if (_modalStack.length > 0) {
      history.pushState({ modalOpen: _modalStack[_modalStack.length - 1], stackLen: _modalStack.length }, '', window.location.href);
    }
  }
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    // El modal-producto NO se cierra al hacer clic afuera
    if (overlay.id === 'modal-producto') return;
    if (e.target === overlay) {
      // Usar cerrarModal para que tambiÃ©n limpie el stack y el historial
      if (_modalStack.length > 0) {
        history.back(); // dispara popstate â†’ cierra el modal
      } else {
        overlay.classList.remove('visible');
      }
    }
  });
});

function toast(msg, type = 'info', duration = 3200) {
  // Eliminar toast previo si existe
  const prev = document.getElementById('_toast_global');
  if (prev) prev.remove();

  const colors = {
    success: { bg: '#00b341', icon: 'âœ…' },
    error:   { bg: '#e03131', icon: 'âŒ' },
    info:    { bg: '#1971c2', icon: 'â„¹ï¸'  },
    warning: { bg: '#f59f00', icon: 'âš ï¸'  },
  };
  const c = colors[type] || colors.info;

  const el = document.createElement('div');
  el.id = '_toast_global';
  el.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: ${c.bg};
    color: white;
    padding: 12px 22px;
    border-radius: 40px;
    font-family: var(--font-body);
    font-size: 14px;
    font-weight: 700;
    box-shadow: 0 6px 24px rgba(0,0,0,0.22);
    z-index: 99999;
    max-width: 90vw;
    text-align: center;
    opacity: 0;
    transition: all 0.25s ease;
    pointer-events: none;
    white-space: pre-line;
  `;
  el.textContent = `${c.icon}  ${msg}`;
  document.body.appendChild(el);

  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => el.remove(), 300);
  }, duration);
}
window.toast = toast;

setTimeout(() => {
  if (document.getElementById('loading-screen').style.display !== 'none') {
    const authState = auth.currentUser;
    if (!authState) showScreen('auth');
  }
}, 2500);

let facturasTabActual = 'pagadas';

window.switchFacturasTab = (tab) => {
  facturasTabActual = tab;
  const btnPend = document.getElementById('btn-tab-pendientes');
  const btnPag = document.getElementById('btn-tab-pagadas');
  if (btnPend) btnPend.classList.toggle('active', tab === 'pendientes');
  if (btnPag) btnPag.classList.toggle('active', tab === 'pagadas');
  if (!Array.isArray(facturasCache)) return;
  const lista = tab === 'pendientes'
    ? facturasCache.filter(f => f.estado === 'pendiente')
    : facturasCache.filter(f => f.estado !== 'pendiente');
  if (typeof renderTablaFacturas === 'function') renderTablaFacturas(lista);
};

const PAISES_TEL = [
  { code: 'DO', flag: 'RD', dial: '+1' },
  { code: 'US', flag: 'US', dial: '+1' },
  { code: 'PR', flag: 'PR', dial: '+1' },
  { code: 'HT', flag: 'HT', dial: '+509' },
  { code: 'PA', flag: 'PA', dial: '+507' },
  { code: 'CO', flag: 'CO', dial: '+57' },
  { code: 'VE', flag: 'VE', dial: '+58' },
  { code: 'ES', flag: 'ES', dial: '+34' }
];

function initPaisSelects() {
  ['cfg-tel-pais', 'cfg-ws-pais'].forEach((id) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    if (sel.options.length > 0) return;
    sel.innerHTML = PAISES_TEL.map(p => `<option value="${p.code}">${p.flag} ${p.dial}</option>`).join('');
    sel.value = 'DO';
  });
}

function updateTelPreview(selId, numero, previewId) {
  const sel = document.getElementById(selId);
  const prev = document.getElementById(previewId);
  if (!sel || !prev) return;
  const pais = PAISES_TEL.find(p => p.code === sel.value);
  if (!numero || !pais) {
    prev.textContent = '';
    return;
  }
  const limpio = numero.replace(/\D/g, '');
  prev.textContent = `${pais.dial}${limpio}`;
}

window.onChangeTelPais = (_code, inputId, previewId) => {
  const input = document.getElementById(inputId);
  const selId = previewId.includes('ws') ? 'cfg-ws-pais' : 'cfg-tel-pais';
  updateTelPreview(selId, input?.value || '', previewId);
};

const _clearBtnMap = {};
window._syncClearBtn = function (inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input || !btn) return;
  const sync = () => { btn.style.display = input.value.trim() ? 'flex' : 'none'; };
  if (!_clearBtnMap[inputId]) {
    _clearBtnMap[inputId] = true;
    input.addEventListener('input', sync);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      sync();
    });
  }
  sync();
};

async function manejarPedidoEntrante() {
  return false;
}
window._manejarPedidoEntrante = manejarPedidoEntrante;

function actualizarConteosCategorias() {
  // Actualizar conteo de categorÃ­a virtual MÃ¡s Vendidos
  const mvCard = document.getElementById('pos-cat-__mas_vendidos__');
  if (mvCard) {
    const mvCount = productos.filter(p => p.masVendidos).length;
    const mvCountEl = mvCard.querySelector('.cat-count');
    if (mvCountEl) mvCountEl.textContent = `${mvCount} producto${mvCount !== 1 ? 's' : ''}`;
  }
  // Actualizar conteos de categorÃ­as reales
  categorias.forEach(c => {
    const card = document.getElementById(`pos-cat-${c.id}`);
    if (!card) return;
    const count = productos.filter(p => p.categoriaId === c.id).length;
    const countEl = card.querySelector('.cat-count');
    if (countEl) countEl.textContent = `${count} producto${count !== 1 ? 's' : ''}`;
  });
}

// ==================== POS ====================
function renderCategoriasPos() {
  const lista = document.getElementById('pos-categorias-lista');
  const area = document.getElementById('pos-productos-area');
  if (!lista) return;

  // Construir categorÃ­as: MÃ¡s Vendidos primero (virtual), luego las reales
  const masVendidosProds = productos.filter(p => p.masVendidos);
  const mvBgImg = negocioData?.masVendidosBg || './img/backgrounds/masvendidos_1.jpg';
  const catsMostrar = [
    { id: '__mas_vendidos__', nombre: 'MÃ¡s Vendidos', emoji: 'â­', imagen: mvBgImg, _virtual: true, _count: masVendidosProds.length }
  ].concat(categorias.filter(c => c.id !== '__mas_vendidos__').map(c => ({ ...c, _virtual: false, _count: productos.filter(p => p.categoriaId === c.id).length })));

  if (!catsMostrar.length || (catsMostrar.length === 1 && categorias.length === 0)) {
    lista.innerHTML = `<div style="color:rgba(0,0,0,0.4);font-size:12px;text-align:center;padding:20px 8px;">Sin categorÃ­as</div>`;
    if (area) area.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><p>No hay categorÃ­as creadas.<br>Ve a Inventario para crear categorÃ­as y productos.</p></div>`;
    return;
  }

  lista.innerHTML = catsMostrar.map(c => {
    const numProds = c._count;
    const esMasVendidos = c._virtual;
    const bgContent = c.imagen
      ? `<img class="cat-bg-img" src="${c.imagen}" alt="${c.nombre}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const emojiFallback = `<div class="cat-bg-emoji" ${c.imagen ? 'style="display:none"' : ''}>${c.emoji || 'ðŸ“¦'}</div>`;
    return `<div class="pos-cat-card${esMasVendidos ? ' mas-vendidos-cat' : ''}" id="pos-cat-${c.id}" onclick="verProductosCategoria('${c.id}')">${bgContent}${emojiFallback}<span class="cat-label">${c.nombre}</span><span class="cat-count">${numProds} producto${numProds !== 1 ? 's' : ''}</span></div>`;
  }).join('');

  // Si no hay categorÃ­a activa, seleccionar MÃ¡s Vendidos (primera)
  if (!categoriaActual) {
    categoriaActual = '__mas_vendidos__';
  }
  if (categoriaActual) {
    renderProductosCategoria(categoriaActual);
    const activeCard = document.getElementById(`pos-cat-${categoriaActual}`);
    if (activeCard) activeCard.classList.add('activa');
  }
}

// â”€â”€ CACHÃ‰ DE GRIDS POR CATEGORÃA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Cada categorÃ­a tiene su propio div.productos-grid en el DOM.
// Al cambiar de categorÃ­a solo se muestra/oculta â€” sin destruir ni recrear.
// _gridOrdenCache guarda con quÃ© orden fue renderizado cada grid para invalidarlo si cambia.
const _gridCache = {};
const _gridOrdenCache = {}; // catId -> orden con que fue renderizado

function _getOrCreateGrid(catId) {
  const area = document.getElementById('pos-productos-area');
  if (!area) return null;
  if (_gridCache[catId] && area.contains(_gridCache[catId])) {
    return _gridCache[catId];
  }
  const grid = document.createElement('div');
  grid.className = `productos-grid ${gridSize}`;
  grid.id = `productos-grid-${catId}`;
  grid.style.display = 'none';
  area.appendChild(grid);
  _gridCache[catId] = grid;
  return grid;
}

function _gridNecesitaActualizar(catId) {
  // El grid necesita re-renderizarse si no existe o si fue renderizado con otro orden
  return !_gridCache[catId] || _gridOrdenCache[catId] !== ordenProductos;
}

function _llenarGrid(catId, busqueda = '') {
  const grid = _getOrCreateGrid(catId);
  if (!grid) return;
  let prods;
  if (catId === '__mas_vendidos__') {
    prods = productos.filter(p => p.masVendidos);
  } else {
    prods = productos.filter(p => p.categoriaId === catId);
  }
  if (busqueda) prods = prods.filter(p =>
    p.nombre?.toLowerCase().includes(busqueda.toLowerCase()) ||
    (p.codigoBarras || '').includes(busqueda)
  );
  prods = _aplicarOrden(prods);
  grid.className = `productos-grid ${gridSize}`;
  grid.innerHTML = prods.length
    ? prods.map(p => renderProdCard(p, busqueda)).join('')
    : '<div class="empty-state"><i class="fas fa-box-open"></i><p>Sin productos en esta categorÃ­a</p></div>';
  // Registrar con quÃ© orden fue renderizado este grid
  if (!busqueda) _gridOrdenCache[catId] = ordenProductos;
}

function _mostrarGrid(catId) {
  const area = document.getElementById('pos-productos-area');
  if (!area) return;
  // Ocultar todos los grids cacheados y el de bÃºsqueda
  Array.from(area.children).forEach(el => { el.style.display = 'none'; });
  // Mostrar el de esta categorÃ­a (crearlo si no existe)
  const grid = _getOrCreateGrid(catId);
  if (grid) grid.style.display = '';
}

window.verProductosCategoria = (catId) => {
  categoriaActual = catId;
  document.querySelectorAll('.pos-cat-card').forEach(el => el.classList.remove('activa'));
  const activeCard = document.getElementById(`pos-cat-${catId}`);
  if (activeCard) activeCard.classList.add('activa');
  // Re-renderizar si es primera visita O si cambiÃ³ el orden desde la Ãºltima vez
  if (_gridNecesitaActualizar(catId)) {
    _llenarGrid(catId);
  }
  _mostrarGrid(catId);
};

function renderProductosCategoria(catId, busqueda = '') {
  if (busqueda) {
    // Con bÃºsqueda: grid temporal, no entra en cachÃ©
    const area = document.getElementById('pos-productos-area');
    if (!area) return;
    Array.from(area.children).forEach(el => { el.style.display = 'none'; });
    let searchGrid = document.getElementById('productos-grid-busqueda');
    if (!searchGrid) {
      searchGrid = document.createElement('div');
      searchGrid.id = 'productos-grid-busqueda';
      area.appendChild(searchGrid);
    }
    let prods = catId === '__mas_vendidos__'
      ? productos.filter(p => p.masVendidos)
      : productos.filter(p => p.categoriaId === catId);
    prods = prods.filter(p =>
      normalizarTexto(p.nombre).includes(normalizarTexto(busqueda)) ||
      normalizarTexto(p.codigoBarras || '').includes(normalizarTexto(busqueda))
    );
    prods = _aplicarOrden(prods);
    searchGrid.className = `productos-grid ${gridSize}`;
    searchGrid.style.display = '';
    searchGrid.innerHTML = prods.length
      ? prods.map(p => renderProdCard(p, busqueda)).join('')
      : '<div class="empty-state"><i class="fas fa-box-open"></i><p>Sin productos en esta categorÃ­a</p></div>';
    return;
  }
  // Sin bÃºsqueda: reconstruir el grid cacheado de esta categorÃ­a
  // (llamado por Firebase cuando hay un cambio real)
  _llenarGrid(catId);
  _mostrarGrid(catId);
}

function escapeHtml(str) { return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function normalizarTexto(str) { return (str || '').normalize('NFD').replace(/[Ì€-Í¯]/g, '').toLowerCase(); }

function resaltarTexto(texto, busqueda) {
  if (!busqueda) return escapeHtml(texto);
  const regex = new RegExp(`(${busqueda.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escapeHtml(texto).replace(regex, '<span class="search-highlight">$1</span>');
}

function renderProdCard(p, busqueda = '') {
  const stockHab = p.stockHabilitado !== false;
  const sinStock = stockHab && p.stock <= 0;
  const bajoStock = stockHab && p.stock > 0 && p.stock <= (p.stockMin || 5);
  const nombreHtml = resaltarTexto(p.nombre || '', busqueda);
  const stockClass = bajoStock ? ' stock-bajo' : (sinStock ? ' sin-stock-txt' : '');
  const esDetallable = esUnidadDetallable(p.unidad);
  const unidadLabel = esDetallable ? labelUnidad(p.unidad) : '';
  const precioHtml = esDetallable
    ? `${fmt(p.precio)}/${unidadLabel}`
    : fmt(p.precio);
  const unidadBadge = esDetallable ? ` <span style="background:#1971c2;color:white;border-radius:4px;padding:1px 5px;font-size:10px;font-weight:700;">${unidadLabel}</span>` : '';
  const stockValDisplay = stockHab ? fmtNum(p.stock) : 'âˆž';
  const stockHtml = `Stock: ${stockValDisplay}${unidadBadge}`;
  const comboBadge = p.comboActivo && p.comboPrecio && p.comboUnidades
    ? `<span style="position:absolute;top:4px;left:4px;background:linear-gradient(135deg,#f59f00,#e67700);color:#fff;border-radius:5px;padding:2px 6px;font-size:9px;font-weight:800;letter-spacing:0.3px;box-shadow:0 1px 4px rgba(0,0,0,0.18);z-index:2;">${p.comboUnidades}x${p.comboPrecio}</span>`
    : '';
  const imagenHtml = p.imagen
    ? `<img src="${p.imagen}" alt="${escapeHtml(p.nombre || '')}" onerror="this.outerHTML='<div class=&quot;prod-emoji&quot;><i class=&quot;fas fa-shopping-cart&quot;></i></div>'">`
    : `<div class="prod-emoji"><i class="fas fa-shopping-cart"></i></div>`;
  const pesoNetoHtml = p.pesoNeto ? `<span class="peso-neto-badge">${escapeHtml(p.pesoNeto)}</span>` : '';
  return `<div class="prod-card ${sinStock ? 'sin-stock' : ''}" onclick="agregarAlCarrito('${p.id}')" oncontextmenu="mostrarMenuContextoProducto(event,'${p.id}');return false;"><div class="product-image" style="position:relative;">${imagenHtml}${pesoNetoHtml}${comboBadge}</div><div class="prod-info"><div class="prod-nombre">${nombreHtml}</div><div class="prod-precio">${precioHtml}</div><div class="prod-stock${stockClass}">${stockHtml}</div></div></div>`;
}

window.buscarProductos = (q) => {
  if (!q) {
    // Limpiar grids de bÃºsqueda y volver a mostrar la categorÃ­a cacheada
    const sg = document.getElementById('productos-grid-busqueda');
    if (sg) sg.style.display = 'none';
    const gs = document.getElementById('productos-grid-global-search');
    if (gs) gs.style.display = 'none';
    if (categoriaActual) {
      if (_gridNecesitaActualizar(categoriaActual)) _llenarGrid(categoriaActual);
      _mostrarGrid(categoriaActual);
    } else {
      renderCategoriasPos();
    }
    return;
  }
  // Deduplicar por id para evitar mostrar el mismo producto dos veces
  const seenIds = new Set();
  const found = productos.filter(p => {
    if (seenIds.has(p.id)) return false;
    const match = normalizarTexto(p.nombre).includes(normalizarTexto(q)) || normalizarTexto(p.codigoBarras || '').includes(normalizarTexto(q));
    if (match) seenIds.add(p.id);
    return match;
  });
  const area = document.getElementById('pos-productos-area');
  if (!area) return;
  document.querySelectorAll('.pos-cat-card').forEach(el => el.classList.remove('activa'));
  // Ocultar todos los grids cacheados (no destruirlos)
  Object.values(_gridCache).forEach(el => { el.style.display = 'none'; });
  // Usar un div persistente para resultados globales
  let globalSearch = document.getElementById('productos-grid-global-search');
  if (!globalSearch) {
    globalSearch = document.createElement('div');
    globalSearch.id = 'productos-grid-global-search';
    area.appendChild(globalSearch);
  }
  globalSearch.style.display = '';
  const foundOrdenado = _aplicarOrden(found);
  globalSearch.innerHTML = `<div style="padding:0 0 12px;font-size:13px;color:var(--gris-suave);font-weight:600;">${found.length} resultado(s) para "<strong>${escapeHtml(q)}</strong>"</div><div class="productos-grid ${gridSize}">${found.length ? foundOrdenado.map(p => renderProdCard(p, q)).join('') : '<div class="empty-state"><p>Sin resultados</p></div>'}</div>`;
};

// â”€â”€ MenÃº contextual producto en POS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
window.mostrarMenuContextoProducto = function(e, prodId) {
  e.preventDefault();
  // Eliminar menÃº previo si existe
  const prev = document.getElementById('_pos_ctx_menu');
  if (prev) prev.remove();

  const menu = document.createElement('div');
  menu.id = '_pos_ctx_menu';
  menu.style.cssText = `position:fixed;z-index:99999;background:#fff;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.18);min-width:160px;overflow:hidden;animation:ctxFadeIn 0.13s ease;`;
  menu.innerHTML = `
    <div style="padding:6px 0;">
      <button onclick="window.editarProducto('${prodId}');document.getElementById('_pos_ctx_menu')?.remove();" style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 18px;border:none;background:none;cursor:pointer;font-size:14px;font-weight:600;color:#1a2135;font-family:inherit;transition:background 0.15s;" onmouseover="this.style.background='#f0f4ff'" onmouseout="this.style.background='none'">
        <i class="fas fa-edit" style="color:#1971c2;width:16px;"></i> Editar producto
      </button>
    </div>`;

  // Posicionar cerca del cursor sin salirse de la pantalla
  let x = e.clientX, y = e.clientY;
  document.body.appendChild(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  if (x + mw > window.innerWidth - 8) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight - 8) y = window.innerHeight - mh - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  // Cerrar al hacer click fuera
  setTimeout(() => {
    const cerrar = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', cerrar); } };
    document.addEventListener('mousedown', cerrar);
  }, 50);
};

window.setGridSize = (size) => {
  gridSize = size;
  localStorage.setItem('pos_grid_size', size);
  document.getElementById('btn-grid-grande').classList.toggle('active', size === 'grande');
  document.getElementById('btn-grid-peq').classList.toggle('active', size === 'pequena');
  // Actualizar clase en todos los grids cacheados
  Object.values(_gridCache).forEach(el => { el.className = `productos-grid ${size}`; });
  const sg = document.getElementById('productos-grid-busqueda');
  if (sg) sg.className = `productos-grid ${size}`;
};

// â”€â”€ Orden de productos â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function _aplicarOrden(prods) {
  if (ordenProductos === 'az') {
    return [...prods].sort((a, b) => normalizarTexto(a.nombre).localeCompare(normalizarTexto(b.nombre)));
  }
  return prods; // orden original de Firebase
}

window.setOrdenProductos = (orden) => {
  if (ordenProductos === orden) return;
  ordenProductos = orden;
  localStorage.setItem('pos_orden_productos', orden);
  const btnAZ = document.getElementById('btn-orden-az');
  if (btnAZ) btnAZ.classList.toggle('active', orden === 'az');
  Object.keys(_gridOrdenCache).forEach(k => delete _gridOrdenCache[k]);
  if (categoriaActual) {
    _llenarGrid(categoriaActual);
    _mostrarGrid(categoriaActual);
  }
  const busqEl = document.getElementById('pos-buscar');
  if (busqEl && busqEl.value.trim()) window.buscarProductos(busqEl.value.trim());
};

window.toggleOrdenProductos = () => {
  setOrdenProductos(ordenProductos === 'az' ? 'original' : 'az');
};

// Restaurar tamaÃ±o de grid guardado
(function () {
  const saved = localStorage.getItem('pos_grid_size');
  if (saved === 'pequena' || saved === 'grande') {
    gridSize = saved;
    document.addEventListener('DOMContentLoaded', () => {
      const bg = document.getElementById('btn-grid-grande');
      const bp = document.getElementById('btn-grid-peq');
      if (bg) bg.classList.toggle('active', saved === 'grande');
      if (bp) bp.classList.toggle('active', saved === 'pequena');
    });
  }
})();
(function () {
  const savedOrden = localStorage.getItem('pos_orden_productos') || 'original';
  ordenProductos = savedOrden;
  document.addEventListener('DOMContentLoaded', () => {
    const ba = document.getElementById('btn-orden-az');
    if (ba) ba.classList.toggle('active', savedOrden === 'az');
  });
})();

window.abrirScaner = () => {
  if (window.innerWidth <= 768) {
    // En mÃ³vil: abrir cÃ¡mara scanner y dirigir resultado al buscador de productos
    if (window.abrirCamaraScanner) {
      // Usar un destino especial que agrega el producto al carrito por cÃ³digo de barras
      window._scannerDestinoPos = true;
      abrirCamaraScanner('pos-buscar');
    }
  } else {
    document.getElementById('scanner-input').value = '';
    abrirModal('modal-scanner');
    setTimeout(() => document.getElementById('scanner-input').focus(), 300);
  }
};

window.buscarPorBarcode = () => {
  const codigo = document.getElementById('scanner-input').value.trim();
  if (!codigo) return;
  const prod = productos.find(p => p.codigoBarras === codigo);
  if (prod) {
    agregarAlCarritoObj(prod);
    cerrarModal('modal-scanner');
  } else {
    toast('Producto no encontrado con ese cÃ³digo', 'error');
  }
};

// ==================== CARRITO ====================
// Unidades que permiten cantidades decimales (detallables)
const UNIDADES_DETALLABLES = ['libra', 'libras', 'lb', 'kilogramo', 'kilogramos', 'kg', 'kilo', 'kilos', 'onza', 'onzas', 'oz', 'litro', 'litros', 'lt', 'l'];

function esUnidadDetallable(unidad) {
  if (!unidad) return false;
  return UNIDADES_DETALLABLES.includes((unidad || '').toLowerCase().trim());
}

function labelUnidad(unidad) {
  const u = (unidad || '').toLowerCase().trim();
  const map = { libra: 'lb', libras: 'lb', lb: 'lb', kilogramo: 'kg', kilogramos: 'kg', kg: 'kg', kilo: 'kg', kilos: 'kg', onza: 'oz', onzas: 'oz', oz: 'oz', litro: 'L', litros: 'L', lt: 'L', l: 'L' };
  return map[u] || unidad;
}

// Estado del modal de detalle
let _duProd = null;
let _duTab = 'cantidad'; // 'cantidad' | 'precio'
let _duValor = '';

window.duCambiarTab = (tab) => {
  _duTab = tab;
  _duValor = '';
  const duInput = document.getElementById('du-valor');
  duInput.value = '';
  document.getElementById('du-tab-cant').classList.toggle('activo', tab === 'cantidad');
  document.getElementById('du-tab-precio').classList.toggle('activo', tab === 'precio');
  const lbl = document.getElementById('du-label-unidad');
  if (tab === 'cantidad') {
    lbl.textContent = labelUnidad(_duProd?.unidad || '');
  } else {
    lbl.textContent = 'RD$';
  }
  setTimeout(() => {
    duInput.focus();
    duInput.select();
  }, 0);
  duActualizarResultado();
};

window.duTecla = (key) => {
  if (key === 'âŒ«') {
    _duValor = _duValor.slice(0, -1);
  } else if (key === '.') {
    if (!_duValor.includes('.')) _duValor += '.';
  } else {
    if (_duValor === '0') _duValor = key;
    else _duValor += key;
  }
  document.getElementById('du-valor').value = _duValor;
  duActualizarResultado();
};

function duActualizarResultado() {
  const res = document.getElementById('du-resultado-texto');
  const btn = document.getElementById('du-btn-confirmar');
  if (!_duProd || !_duValor) { res.textContent = 'Ingresa la cantidad'; if (btn) btn.disabled = true; return; }
  const val = parseFloat(_duValor);
  if (isNaN(val) || val <= 0) { res.textContent = 'Valor invÃ¡lido'; if (btn) btn.disabled = true; return; }
  if (btn) btn.disabled = false;
  const unidadLabel = labelUnidad(_duProd.unidad || '');
  if (_duTab === 'cantidad') {
    const subtotal = val * _duProd.precio;
    res.innerHTML = `${val} ${unidadLabel} Ã— ${fmt(_duProd.precio)} = <span class="du-resultado-valor">${fmt(subtotal)}</span>`;
  } else {
    // Por precio: calcular cuÃ¡ntas unidades
    const cantEquiv = val / _duProd.precio;
    res.innerHTML = `${fmt(val)} Ã· ${fmt(_duProd.precio)}/${unidadLabel} = <span class="du-resultado-valor">${cantEquiv.toFixed(2)} ${unidadLabel}</span>`;
  }
}

window.duConfirmar = () => {
  if (!_duProd || !_duValor) { toast('Ingresa una cantidad', 'error'); return; }
  const val = parseFloat(_duValor);
  if (isNaN(val) || val <= 0) { toast('Cantidad invÃ¡lida', 'error'); return; }

  let qty;
  const precioBase = _duProd._precioBase || _duProd.precio;
  if (_duTab === 'cantidad') {
    qty = val;
  } else {
    qty = val / precioBase;
  }

  const carrito = getCarrito();
  const idx = carrito.findIndex(i => i.id === _duProd.id);
  if (_duModoEdicion) {
    // Modo ediciÃ³n: reemplazar qty existente
    if (idx >= 0) {
      if (qty <= 0) {
        carrito.splice(idx, 1);
      } else {
        carrito[idx].qty = qty;
      }
    }
  } else {
    // Modo agregar: sumar o crear
    if (idx >= 0) {
      carrito[idx].qty += qty;
    } else {
      carrito.push({ ..._duProd, qty, _precioBase: precioBase });
    }
  }
  setCarrito(carrito);
  renderCarrito();
  cerrarModal('modal-detalle-unidad');
  const accion = _duModoEdicion ? 'actualizado' : 'agregado';
  toast(`âœ… ${qty.toFixed(2)} ${labelUnidad(_duProd.unidad)} de ${_duProd.nombre} ${accion}`, 'success');
};

// ===== TECLADO FÃSICO + INPUT NATIVO para modal-detalle-unidad =====
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const inp = document.getElementById('du-valor');
    if (!inp) return;

    inp.addEventListener('input', () => {
      let val = inp.value.replace(/[^0-9.]/g, '');
      const parts = val.split('.');
      if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
      if (inp.value !== val) inp.value = val;
      _duValor = val;
      duActualizarResultado();
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { duConfirmar(); e.preventDefault(); }
      else if (e.key === 'Escape') { cerrarModal('modal-detalle-unidad'); e.preventDefault(); }
    });

    document.addEventListener('keydown', (e) => {
      const modal = document.getElementById('modal-detalle-unidad');
      if (!modal || !modal.classList.contains('active')) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

      if (e.key >= '0' && e.key <= '9') { duTecla(e.key); e.preventDefault(); return; }
      if (e.key === '.') { duTecla('.'); e.preventDefault(); return; }
      if (e.key === 'Backspace') { duTecla('âŒ«'); e.preventDefault(); return; }
      if (e.key === 'Enter') { duConfirmar(); e.preventDefault(); return; }
      if (e.key === 'Escape') { cerrarModal('modal-detalle-unidad'); e.preventDefault(); }
    });

    const modal = document.getElementById('modal-detalle-unidad');
    if (!modal) return;
    const observer = new MutationObserver(() => {
      if (modal.classList.contains('active')) {
        setTimeout(() => inp.focus(), 120);
      }
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  });
})();
// ===== FIN TECLADO FÃSICO =====

let _duModoEdicion = false; // false = agregar nuevo, true = editar existente en carrito

function abrirModalDetalle(prod) {
  _duProd = prod;
  _duModoEdicion = false;
  _duTab = 'cantidad';
  _duValor = '';
  document.getElementById('du-nombre').textContent = prod.nombre;
  document.getElementById('du-precio-ref').innerHTML = `Precio: <span class="du-precio-valor">${fmt(prod.precio)}</span> por ${labelUnidad(prod.unidad)}`;
  document.getElementById('du-valor').value = '';
  document.getElementById('du-label-unidad').textContent = labelUnidad(prod.unidad || '');
  document.getElementById('du-tab-cant').classList.add('activo');
  document.getElementById('du-tab-precio').classList.remove('activo');
  const h3 = document.querySelector('#modal-detalle-unidad .modal-header h3');
  if (h3) h3.innerHTML = '<i class="fas fa-balance-scale"></i> Cantidad a detallar';
  const btnOk = document.getElementById('du-btn-confirmar');
  if (btnOk) { btnOk.innerHTML = '<i class="fas fa-check"></i> Agregar al Carrito'; btnOk.disabled = true; }
  duActualizarResultado();
  abrirModal('modal-detalle-unidad');
  setTimeout(() => document.getElementById('du-valor')?.focus(), 140);
}

window.abrirModalEditarDetalle = (prodId) => {
  const carrito = getCarrito();
  const item = carrito.find(i => i.id === prodId);
  if (!item) return;
  _duProd = item;
  _duModoEdicion = true;
  _duTab = 'cantidad';
  _duValor = '';
  document.getElementById('du-nombre').textContent = item.nombre;
  document.getElementById('du-precio-ref').innerHTML = `Precio: <span class="du-precio-valor">${fmt(item._precioBase || item.precio)}</span> por ${labelUnidad(item.unidad)}`;
  document.getElementById('du-valor').value = '';
  document.getElementById('du-label-unidad').textContent = labelUnidad(item.unidad || '');
  document.getElementById('du-tab-cant').classList.add('activo');
  document.getElementById('du-tab-precio').classList.remove('activo');
  const h3 = document.querySelector('#modal-detalle-unidad .modal-header h3');
  if (h3) h3.innerHTML = '<i class="fas fa-pen"></i> Editar cantidad';
  const btnOk = document.getElementById('du-btn-confirmar');
  if (btnOk) { btnOk.innerHTML = 'Actualizar Carrito'; btnOk.disabled = true; }
  duActualizarResultado();
  abrirModal('modal-detalle-unidad');
  setTimeout(() => document.getElementById('du-valor')?.focus(), 140);
};

window.editarCantidadDetalle = (prodId, inputEl) => {
  const carrito = getCarrito();
  const idx = carrito.findIndex(i => i.id === prodId);
  if (idx < 0) return;
  const val = parseFloat(inputEl.value);
  if (isNaN(val) || val <= 0) { inputEl.value = carrito[idx].qty.toFixed(2); return; }
  carrito[idx].qty = val;
  setCarrito(carrito);
  _actualizarTotalesCarrito();
};

window.editarPrecioDetalle = (prodId, inputEl) => {
  const carrito = getCarrito();
  const idx = carrito.findIndex(i => i.id === prodId);
  if (idx < 0) return;
  const precioUnitario = carrito[idx]._precioBase || carrito[idx].precio;
  const totalIngresado = parseFloat(inputEl.value);
  if (isNaN(totalIngresado) || totalIngresado <= 0) { inputEl.value = (carrito[idx].qty * precioUnitario).toFixed(2); return; }
  const nuevaQty = totalIngresado / precioUnitario;
  carrito[idx].qty = nuevaQty;
  setCarrito(carrito);
  const qtyInput = document.getElementById(`du-qty-${prodId}`);
  if (qtyInput) qtyInput.value = nuevaQty.toFixed(2);
  _actualizarTotalesCarrito();
};

window.confirmarEdicionDetalle = (prodId) => {
  const carrito = getCarrito();
  const idx = carrito.findIndex(i => i.id === prodId);
  if (idx < 0) return;
  if (carrito[idx].qty <= 0) {
    carrito.splice(idx, 1);
    setCarrito(carrito);
    renderCarrito();
  } else {
    setCarrito(carrito);
    renderCarrito();
  }
};

window.calcularPrecioConCombo = function calcularPrecioConCombo(qty, precioUnit, comboPrecio, comboUnidades) {
  if (!comboPrecio || !comboUnidades || comboUnidades < 2 || !precioUnit) return qty * precioUnit;
  const combosCompletos = Math.floor(qty / comboUnidades);
  const sueltas = qty % comboUnidades;
  return (combosCompletos * comboPrecio) + (sueltas * precioUnit);
};

window.calcularUnidadesCombo = function calcularUnidadesCombo(monto, precioUnit, comboPrecio, comboUnidades) {
  if (!comboPrecio || !comboUnidades || comboUnidades < 2 || !precioUnit) return Math.floor(monto / precioUnit);
  let restante = monto;
  let unidades = 0;
  const combosCompletos = Math.floor(restante / comboPrecio);
  unidades += combosCompletos * comboUnidades;
  restante -= combosCompletos * comboPrecio;
  unidades += Math.floor(restante / precioUnit);
  return unidades;
};

function _actualizarTotalesCarrito() {
  const carrito = getCarrito();
  const subtotal = carrito.reduce((s, i) => {
    if (i.comboActivo && i.comboPrecio && i.comboUnidades >= 2) return s + window.calcularPrecioConCombo(i.qty, i.precio, i.comboPrecio, i.comboUnidades);
    if (i._precioBase !== undefined) return s + i._precioBase * i.qty;
    return s + i.precio * i.qty;
  }, 0);
  const itbisPct = config.itbisPct || 18;
  const itbisCliente = config.itbisCliente === true;
  const itbis = itbisCliente ? subtotal * (itbisPct / 100) : 0;
  const total = subtotal + itbis;
  document.getElementById('cart-subtotal').textContent = fmt(subtotal);
  document.getElementById('cart-itbis').textContent = fmt(itbis);
  document.getElementById('cart-total').textContent = fmt(total);
  const itbisRow = document.getElementById('cart-itbis-row');
  if (itbisRow) itbisRow.style.display = itbisCliente ? '' : 'none';
  carrito.forEach(item => {
    if (esUnidadDetallable(item.unidad)) {
      const st = document.getElementById(`du-subtotal-${item.id}`);
      if (st) st.textContent = fmt((item._precioBase || item.precio) * item.qty);
    }
  });
}

let _carritoQueue = [];
let _carritoProcessing = false;

function _procesarColaCarrito() {
  if (_carritoProcessing || !_carritoQueue.length) return;
  _carritoProcessing = true;
  const prodId = _carritoQueue.shift();
  const prod = productos.find(p => p.id === prodId);
  if (prod) agregarAlCarritoObj(prod);
  _carritoProcessing = false;
  if (_carritoQueue.length) requestAnimationFrame(_procesarColaCarrito);
}

let _ultimoItemAgregado = null;

window.agregarAlCarrito = (prodId) => {
  if (!cajaActual) { toast('âš ï¸ La caja no estÃ¡ abierta', 'error'); return; }
  const prod = productos.find(p => p.id === prodId);
  if (!prod) return;
  if (prod.stockHabilitado !== false && prod.stock <= 0) { toast('Sin stock disponible', 'error'); return; }
  if (esUnidadDetallable(prod.unidad)) {
    const carrito = getCarrito();
    const idx = carrito.findIndex(i => i.id === prod.id);
    if (idx >= 0) carrito[idx].qty += 1;
    else {
      const tieneComboD = prod.comboActivo && prod.comboPrecio && prod.comboUnidades >= 2;
      carrito.push(tieneComboD ? { ...prod, qty: 1 } : { ...prod, qty: 1, _precioBase: prod.precio });
    }
    setCarrito(carrito);
    _ultimoItemAgregado = prod.id;
    renderCarrito();
    return;
  }
  _ultimoItemAgregado = prodId;
  _carritoQueue.push(prodId);
  requestAnimationFrame(_procesarColaCarrito);
};

function agregarAlCarritoObj(prod) {
  const carrito = getCarrito();
  const idx = carrito.findIndex(i => i.id === prod.id);
  if (idx >= 0) {
    if (prod.stockHabilitado !== false && carrito[idx].qty >= prod.stock) { toast('No hay mÃ¡s stock disponible', 'error'); return; }
    carrito[idx].qty++;
  } else {
    const tieneCombo = prod.comboActivo && prod.comboPrecio && prod.comboUnidades >= 2;
    const nuevoItem = tieneCombo
      ? { ...prod, qty: 1, _precioInventario: prod.precio }
      : { ...prod, qty: 1, _precioBase: prod.precio, _precioInventario: prod.precio };
    carrito.push(nuevoItem);
  }
  setCarrito(carrito);
  _ultimoItemAgregado = prod.id;
  renderCarrito();
}

window.cambiarQty = (prodId, delta) => {
  const carrito = getCarrito();
  const idx = carrito.findIndex(i => i.id === prodId);
  if (idx < 0) return;
  carrito[idx].qty += delta;
  if (carrito[idx].qty <= 0) carrito.splice(idx, 1);
  setCarrito(carrito);
  renderCarrito();
};

function _renderItemNormal(item) {
  const pesoNeto = item.pesoNeto ? `<span class="peso-neto-badge">${item.pesoNeto}</span>` : '';
  if (item.comboActivo && item.comboPrecio && item.comboUnidades >= 2) {
    const subtotalReal = window.calcularPrecioConCombo(item.qty, item.precio, item.comboPrecio, item.comboUnidades);
    return `<div class="carrito-item"><div class="img-producto" style="position:relative;">${item.imagen ? `<img src="${item.imagen}" alt="${item.nombre}" onerror="this.outerHTML='<div class=&quot;item-emoji&quot;>ðŸ“¦</div>'">` : `<div class="item-emoji">ðŸ“¦</div>`}${pesoNeto}</div><div class="item-info"><div class="item-nombre">${item.nombre}</div><div class="item-precio">${fmt(item.precio)} c/u Â· ${item.comboUnidades}x${fmt(item.comboPrecio)}</div><div><span class="item-subtotal">${fmt(subtotalReal)}</span></div></div><div class="item-ctrl"><button class="qty-btn minus" onclick="cambiarQty('${item.id}', -1)">âˆ’</button><span class="qty-num">${item.qty}</span><button class="qty-btn plus" onclick="cambiarQty('${item.id}', 1)">+</button></div></div>`;
  }
  return `<div class="carrito-item"><div class="img-producto" style="position:relative;">${item.imagen ? `<img src="${item.imagen}" alt="${item.nombre}" onerror="this.outerHTML='<div class=&quot;item-emoji&quot;>ðŸ“¦</div>'">` : `<div class="item-emoji">ðŸ“¦</div>`}${pesoNeto}</div><div class="item-info"><div class="item-nombre">${item.nombre}</div><div class="item-precio">${fmt(item.precio)} c/u</div><div><span class="item-subtotal">${fmt(item.precio * item.qty)}</span></div></div><div class="item-ctrl"><button class="qty-btn minus" onclick="cambiarQty('${item.id}', -1)">âˆ’</button><span class="qty-num">${item.qty}</span><button class="qty-btn plus" onclick="cambiarQty('${item.id}', 1)">+</button></div></div>`;
}

function _renderItemDetallable(item) {
  const precioBase = item._precioBase || item.precio;
  const unidadLabel = labelUnidad(item.unidad || '');
  const subtotal = precioBase * item.qty;
  const qtyDisplay = Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(2);
  const pesoNeto = item.pesoNeto ? `<span class="peso-neto-badge">${item.pesoNeto}</span>` : '';
  return `<div class="carrito-item">
    <div class="img-producto" style="position:relative;">${item.imagen ? `<img src="${item.imagen}" alt="${item.nombre}" onerror="this.outerHTML='<div class=&quot;item-emoji&quot;>ðŸ“¦</div>'" style="">` : `<div class="item-emoji" style="width:44px;height:44px;font-size:20px;">ðŸ“¦</div>`}${pesoNeto}</div>
    <div class="item-info" style="flex:1;min-width:0;">
      <div class="item-nombre">${item.nombre}</div>
      <div class="item-precio">${fmt(precioBase)}/${unidadLabel}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:2px;">
        <span class="item-subtotal" id="du-subtotal-${item.id}">${fmt(subtotal)}</span>
      </div>
    </div>
    <div class="btns-editar-lib">
      <div style="display:flex;gap:4px;">
        <button class="qty-btn minus" onclick="eliminarItemDetalle('${item.id}')" style="background:#fff0f0;color:#e03131;width:36px;height:36px;font-size:16px;" title="Eliminar"><i class="fas fa-trash"></i></button>
        <button onclick="abrirModalEditarDetalle('${item.id}')" style="background:#1971c2;color:white;border:none;border-radius:6px;padding:10px 10px;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px;"><i class="fas fa-pen" style="font-size:10px;"></i> Editar</button>
      </div>
      <span class="item-unidad-cantidad">${qtyDisplay} ${unidadLabel}</span>
    </div>
  </div>`;
}

window.eliminarItemDetalle = (prodId) => {
  const carrito = getCarrito();
  const idx = carrito.findIndex(i => i.id === prodId);
  if (idx >= 0) { carrito.splice(idx, 1); setCarrito(carrito); renderCarrito(); }
};

function renderCarrito() {
  renderFacturasTabs();
  const items = document.getElementById('carrito-items');
  const count = document.getElementById('carrito-count');
  const carrito = getCarrito();
  count.textContent = carrito.length;

  const headerNombre = document.getElementById('carrito-header-nombre');
  if (headerNombre) {
    const tabActiva = _getTabActiva();
    headerNombre.textContent = tabActiva ? tabActiva.nombre : 'Carrito';
  }

  if (!carrito.length) {
    items.innerHTML = `<div class="carrito-empty"><i class="fas fa-shopping-cart"></i><p>Agrega productos al carrito</p></div>`;
  } else {
    Array.from(items.children).forEach(el => { if (!el.classList.contains('carrito-item')) el.remove(); });
    const existingNodes = {};
    items.querySelectorAll('.carrito-item[data-item-id]').forEach(el => { existingNodes[el.dataset.itemId] = el; });
    const newIds = new Set(carrito.map(i => i.id));
    Object.keys(existingNodes).forEach(id => { if (!newIds.has(id)) existingNodes[id].remove(); });

    carrito.forEach((item, idx) => {
      const esDetallable = esUnidadDetallable(item.unidad);
      const existing = existingNodes[item.id];
      if (existing) {
        if (esDetallable) {
          const precioBase = item._precioBase || item.precio;
          const unidadLabel = labelUnidad(item.unidad || '');
          const subtotal = precioBase * item.qty;
          const qtyDisplay = Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(2);
          const subEl = existing.querySelector('.item-subtotal');
          if (subEl) subEl.textContent = fmt(subtotal);
          const cantEl = existing.querySelector('.item-unidad-cantidad');
          if (cantEl) cantEl.textContent = `${qtyDisplay} ${unidadLabel}`;
        } else {
          const qtyEl = existing.querySelector('.qty-num');
          if (qtyEl) qtyEl.textContent = item.qty;
          const subEl = existing.querySelector('.item-subtotal');
          if (subEl) {
            if (item.comboActivo && item.comboPrecio && item.comboUnidades >= 2) {
              const subtotalReal = window.calcularPrecioConCombo(item.qty, item.precio, item.comboPrecio, item.comboUnidades);
              subEl.textContent = fmt(subtotalReal);
            } else {
              subEl.textContent = fmt(item.precio * item.qty);
            }
          }
        }
        const currentChildren = Array.from(items.children).filter(el => el.classList.contains('carrito-item'));
        if (currentChildren[idx] !== existing) items.insertBefore(existing, currentChildren[idx] || null);
      } else {
        const html = esDetallable ? _renderItemDetallable(item) : _renderItemNormal(item);
        const tpl = document.createElement('div');
        tpl.innerHTML = html.trim();
        const newEl = tpl.firstElementChild;
        newEl.dataset.itemId = item.id;
        const currentChildren = Array.from(items.children).filter(el => el.classList.contains('carrito-item'));
        items.insertBefore(newEl, currentChildren[idx] || null);
      }
    });
  }

  const subtotal = carrito.reduce((s, i) => { if (i.comboActivo && i.comboPrecio && i.comboUnidades >= 2) return s + window.calcularPrecioConCombo(i.qty, i.precio, i.comboPrecio, i.comboUnidades); if (i._precioBase !== undefined) return s + i._precioBase * i.qty; return s + i.precio * i.qty; }, 0);
  const itbisPct = config.itbisPct || 18;
  const itbisCliente = config.itbisCliente === true;
  const itbis = itbisCliente ? subtotal * (itbisPct / 100) : 0;
  const total = subtotal + itbis;
  document.getElementById('cart-subtotal').textContent = fmt(subtotal);
  document.getElementById('cart-itbis-label').textContent = `ITBIS (${itbisPct}%)`;
  document.getElementById('cart-itbis').textContent = fmt(itbis);
  document.getElementById('cart-total').textContent = fmt(total);
  const itbisRow = document.getElementById('cart-itbis-row');
  if (itbisRow) itbisRow.style.display = itbisCliente ? '' : 'none';
  const btnVaciar = document.getElementById('btn-vaciar-carrito');
  if (btnVaciar) btnVaciar.style.background = carrito.length ? 'var(--rojo)' : '#aab4c8';
  if (typeof window._actualizarFabBadge === 'function') window._actualizarFabBadge(carrito.length);

  if (_ultimoItemAgregado) {
    const idAgregado = _ultimoItemAgregado;
    _ultimoItemAgregado = null;
    requestAnimationFrame(() => {
      const el = items.querySelector(`.carrito-item[data-item-id="${idAgregado}"]`);
      if (el) {
        el.classList.remove('item-added');
        void el.offsetWidth;
        el.classList.add('item-added');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => el.classList.remove('item-added'), 2100);
      }
    });
  }
}

// MODO EDICIÃ“N CARRITO + MODAL EDITAR ITEM
let _modoEdicionCarrito = false;
let _meicItemId = null;

window.toggleModoEdicionCarrito = function () {
  _modoEdicionCarrito = !_modoEdicionCarrito;
  const icon = document.getElementById('icon-editar-carrito');
  if (icon) icon.className = _modoEdicionCarrito ? 'fas fa-times' : 'fas fa-pen';
  const btn = document.getElementById('btn-editar-carrito');
  if (btn) btn.style.background = _modoEdicionCarrito ? 'rgba(252,79,98,0.25)' : 'none';
  _aplicarOverlaysEdicion();
};

function _aplicarOverlaysEdicion() {
  const carritoItemsEl = document.getElementById('carrito-items');
  if (!carritoItemsEl) return;
  carritoItemsEl.querySelectorAll('.carrito-item').forEach(el => {
    let ov = el.querySelector('.carrito-edit-overlay');
    if (_modoEdicionCarrito) {
      el.style.position = 'relative';
      if (!ov) {
        ov = document.createElement('div');
        ov.className = 'carrito-edit-overlay';
        ov.innerHTML = '<i class="fas fa-pen"></i>';
        ov.addEventListener('click', function (e) {
          e.stopPropagation();
          const itemId = el.dataset.itemId;
          if (itemId) abrirModalEditarItem(itemId);
        });
        el.appendChild(ov);
      }
    } else if (ov) ov.remove();
  });
}

function _meicTotalReal(item, qty) {
  if (item._precioBase !== undefined && !item.comboActivo) return (item._precioBase || item.precio) * qty;
  if (item.comboActivo && item.comboPrecio && item.comboUnidades >= 2) return window.calcularPrecioConCombo(qty, item.precio, item.comboPrecio, item.comboUnidades);
  return item.precio * qty;
}

window.getCarrito = getCarrito;
window.setCarrito = setCarrito;
window.renderCarrito = renderCarrito;
window.renderFacturasTabs = renderFacturasTabs;
window._getTabActiva = _getTabActiva;
window._guardarDibujoTab = _guardarDibujoTab;
window._guardarTabsEnStorage = _guardarTabsEnStorage;
window._aplicarOverlaysEdicion = _aplicarOverlaysEdicion;
window._meicTotalReal = _meicTotalReal;
Object.defineProperty(window, 'config', { get: () => config, set: v => { config = v; }, configurable: true });
Object.defineProperty(window, 'cajaActual', { get: () => cajaActual, set: v => { cajaActual = v; }, configurable: true });
Object.defineProperty(window, 'currentUser', { get: () => currentUser, set: v => { currentUser = v; }, configurable: true });
Object.defineProperty(window, 'empleadosCache', { get: () => empleadosCache, set: v => { empleadosCache = v; }, configurable: true });
Object.defineProperty(window, 'negocioData', { get: () => negocioData, set: v => { negocioData = v; }, configurable: true });
Object.defineProperty(window, 'signaturePad', { get: () => signaturePad, set: v => { signaturePad = v; }, configurable: true });
Object.defineProperty(window, 'dibujoDataURL', { get: () => dibujoDataURL, set: v => { dibujoDataURL = v; }, configurable: true });
Object.defineProperty(window, '_modoEdicionCarrito', { get: () => _modoEdicionCarrito, set: v => { _modoEdicionCarrito = v; }, configurable: true });
Object.defineProperty(window, '_meicItemId', { get: () => _meicItemId, set: v => { _meicItemId = v; }, configurable: true });

window.abrirModalFacturar = () => {
      if (!carrito.length) { toast('El carrito estÃ¡ vacÃ­o', 'error'); return; }
      if (!cajaActual) { toast('La caja no estÃ¡ abierta', 'error'); return; }
      const subtotal = carrito.reduce((s, i) => s + i.precio * i.qty, 0);
      const itbisPct = config.itbisPct || 18;
      const itbisCliente = config.itbisCliente !== false;
      const itbis = itbisCliente ? subtotal * (itbisPct / 100) : 0;
      const total = subtotal + itbis;
      document.getElementById('factura-items-lista').innerHTML = carrito.map(item => `<div class="factura-item-row"><span class="fi-nombre">${item.nombre}</span><span class="fi-qty">x${item.qty}</span><span class="fi-precio">${fmt(item.precio * item.qty)}</span></div>`).join('');
      document.getElementById('mfact-subtotal').textContent = fmt(subtotal);
      document.getElementById('mfact-itbis-lbl').textContent = `ITBIS (${itbisPct}%)${!itbisCliente ? ' (asumido)' : ''}`;
      document.getElementById('mfact-itbis').textContent = fmt(itbis);
      document.getElementById('mfact-total').textContent = fmt(total);
      document.getElementById('monto-recibido').value = '';
      document.getElementById('cambio-display').style.display = 'none';
      const sel = document.getElementById('fact-empleado');
      sel.innerHTML = empleadosCache.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
      const myEmp = empleadosCache.find(e => e.uid === currentUser.uid);
      if (myEmp) sel.value = myEmp.id;
      seleccionarMetodo('efectivo');
      estadoFacturaSeleccionado = '';
      document.getElementById('btn-estado-pagada').classList.remove('selected');
      document.getElementById('btn-estado-pendiente').classList.remove('selected');
      abrirModal('modal-facturar');
    };

    window.seleccionarMetodo = (metodo) => { metodoPagoSeleccionado = metodo; document.querySelectorAll('.mpago-btn').forEach((b, i) => { const metodos = ['efectivo', 'transferencia', 'tarjeta']; b.classList.toggle('selected', metodos[i] === metodo); }); const efectivoSec = document.getElementById('efectivo-section'); if (metodo === 'efectivo') efectivoSec.classList.add('visible'); else efectivoSec.classList.remove('visible'); };

    window.setEstadoFactura = (estado) => { estadoFacturaSeleccionado = estado; document.getElementById('btn-estado-pagada').classList.toggle('selected', estado === 'pagada'); document.getElementById('btn-estado-pendiente').classList.toggle('selected', estado === 'pendiente'); };

    window.calcularCambio = () => { const total = carrito.reduce((s, i) => s + i.precio * i.qty, 0) * (1 + (config.itbisCliente !== false ? (config.itbisPct || 18) / 100 : 0)); const recibido = parseFloat(document.getElementById('monto-recibido').value) || 0; const cambio = recibido - total; const disp = document.getElementById('cambio-display'); if (recibido > 0) { disp.style.display = 'flex'; document.getElementById('cambio-valor').textContent = fmt(Math.max(0, cambio)); disp.style.background = cambio >= 0 ? '#d4edda' : '#f8d7da'; } else { disp.style.display = 'none'; } };

    window.tecNumero = (val) => { const inp = document.getElementById('monto-recibido'); if (val === 'C') { inp.value = ''; } else if (val === 'âŒ«') { inp.value = inp.value.slice(0, -1); } else if (val === 'OK') { calcularCambio(); return; } else { inp.value += val; } calcularCambio(); };

    window.confirmarFactura = async () => {
      if (!estadoFacturaSeleccionado) {
        toast('Selecciona si el pago es Confirmado o Pendiente', 'error');
        return;
      }
      if (estadoFacturaSeleccionado === 'pagada' && metodoPagoSeleccionado === 'efectivo') {
        const montoRec = parseFloat(document.getElementById('monto-recibido').value);
        if (!montoRec || montoRec <= 0) {
          toast('Ingresa el monto recibido en efectivo para confirmar la factura', 'error');
          return;
        }
      }
      const btn = document.getElementById('btn-confirmar-factura');
      btn.innerHTML = '<span class="loader"></span> Procesando...';
      btn.disabled = true;
      try {
        const subtotal = carrito.reduce((s, i) => s + i.precio * i.qty, 0);
        const itbisPct = config.itbisPct || 18;
        const itbisCliente = config.itbisCliente !== false;
        const itbis = itbisCliente ? subtotal * (itbisPct / 100) : 0;
        const total = subtotal + itbis;
        const empId = document.getElementById('fact-empleado').value;
        const empNombre = empleadosCache.find(e => e.id === empId)?.nombre || await getEmpNombre();
        const ncfSeq = config.ncfSeq || 1;
        const ncf = `${config.ncfPrefijo || 'B01'}${String(ncfSeq).padStart(8, '0')}`;
        const numFactura = `F-${Date.now()}`;
        const notaDibujo = (signaturePad && !signaturePad.isEmpty()) ? signaturePad.toDataURL() : null;
        const direccionCliente = document.getElementById('pos-direccion-cliente')?.value.trim() || '';

        const facturaData = { numero: numFactura, ncf, fecha: serverTimestamp(), items: carrito.map(i => ({ id: i.id, nombre: i.nombre, precio: i.precio, qty: i.qty, subtotal: i.precio * i.qty })), subtotal, itbis, itbisPct, total, metodoPago: metodoPagoSeleccionado, montoRecibido: parseFloat(document.getElementById('monto-recibido').value) || total, estado: estadoFacturaSeleccionado, empleadoId: empId, empleadoNombre: empNombre, cajaId: cajaActual.id, uid: currentUser.uid, dibujoNota: notaDibujo, ...(direccionCliente ? { direccionCliente } : {}) };
        const factRef = await addDoc(collection(db, 'negocios', negocioId, 'facturas'), facturaData);
        if (estadoFacturaSeleccionado === 'pagada') {
          await addDoc(collection(db, 'negocios', negocioId, 'movimientos'), { tipo: 'ingreso', descripcion: `Venta ${numFactura}`, monto: total, fecha: serverTimestamp(), uid: currentUser.uid, empleadoNombre: empNombre, facturaId: factRef.id, cajaId: cajaActual.id });
          await updateDoc(doc(db, 'negocios', negocioId, 'caja', cajaActual.id), { ingresos: (cajaActual.ingresos || 0) + total });
        }
        await updateDoc(doc(db, 'negocios', negocioId, 'configuraciones', 'general'), { ncfSeq: ncfSeq + 1 });
        config.ncfSeq = ncfSeq + 1;
        const batch = writeBatch(db);
        for (const item of carrito) {
          const prodRef = doc(db, 'negocios', negocioId, 'categorias', item.categoriaId, 'productos', item.id);
          batch.update(prodRef, { stock: (item.stock || 0) - item.qty });
          const pi = productos.findIndex(p => p.id === item.id);
          if (pi >= 0) productos[pi].stock -= item.qty;
        }
        await batch.commit();
        localStorage.setItem(`prods_${negocioId}`, JSON.stringify(productos));
        cerrarModal('modal-facturar');
        facturaActualParaImprimir = { ...facturaData, id: factRef.id };
        mostrarTicket(facturaActualParaImprimir);
        carrito = [];
        renderCarrito();
        const dirInput = document.getElementById('pos-direccion-cliente');
        if (dirInput) dirInput.value = '';
        if (signaturePad) signaturePad.clear();
        dibujoDataURL = null;
        toast('Factura generada exitosamente âœ…', 'success');
      } catch (e) { toast('Error al procesar: ' + e.message, 'error'); console.error(e); }
      btn.innerHTML = '<i class="fas fa-check"></i> Confirmar Factura';
      btn.disabled = false;
    };

    function mostrarTicket(factura) { const body = document.getElementById('modal-ticket-body'); body.innerHTML = generarHTMLTicket(factura); abrirModal('modal-ticket'); }

    function generarHTMLTicket(factura) {
      const fecha = factura.fecha?.toDate ? factura.fecha.toDate() : new Date();
      let dibujoHtml = '';
      if (factura.dibujoNota) {
        dibujoHtml = `<div style="margin-top:12px; border-top:1px dashed #ccc; padding-top:8px;"><strong>ðŸ“ Nota / Dibujo:</strong><br><img src="${factura.dibujoNota}" style="max-width:100%; height:auto; border:1px solid #ddd; border-radius:8px; margin-top:6px;"></div>`;
      }
      return `<div class="ticket"><div class="ticket-header"><div style="font-size:16px;font-weight:800;">${negocioData?.nombre || 'Colmado'}</div><div>${negocioData?.direccion || ''}</div><div>${negocioData?.telefono || ''}</div>${negocioData?.rnc ? `<div>RNC: ${negocioData.rnc}</div>` : ''}<div style="margin-top:6px;">â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”</div><div>Factura: ${factura.numero}</div>${factura.ncf ? `<div>NCF: ${factura.ncf}</div>` : ''}<div>${fecha.toLocaleString('es-DO')}</div><div>Empleado: ${factura.empleadoNombre || '-'}</div>${factura.direccionCliente ? `<div style="margin-top:4px;"><strong>ðŸ“ Entrega:</strong> ${factura.direccionCliente}</div>` : ''}</div><div>${(factura.items || []).map(i => `<div class="ticket-row"><span>${i.nombre} x${i.qty}</span><span>${fmt(i.subtotal)}</span></div>`).join('')}</div><div class="ticket-total"><div class="ticket-row"><span>Subtotal</span><span>${fmt(factura.subtotal)}</span></div><div class="ticket-row"><span>ITBIS (${factura.itbisPct}%)</span><span>${fmt(factura.itbis)}</span></div><div class="ticket-row" style="font-size:16px;"><span>TOTAL</span><span>${fmt(factura.total)}</span></div><div class="ticket-row"><span>MÃ©todo</span><span>${factura.metodoPago}</span></div>${factura.metodoPago === 'efectivo' ? `<div class="ticket-row"><span>Recibido</span><span>${fmt(factura.montoRecibido)}</span></div><div class="ticket-row"><span>Cambio</span><span>${fmt(Math.max(0, (factura.montoRecibido || 0) - factura.total))}</span></div>` : ''}</div>${dibujoHtml}<div style="text-align:center;margin-top:12px;font-size:11px;">Â¡Gracias por su compra!<br>Estado: <strong>${factura.estado === 'pagada' ? 'âœ… PAGADA' : 'â³ PENDIENTE'}</strong></div></div>`;
    }

    window.imprimirTicket = () => { const content = document.getElementById('modal-ticket-body').innerHTML; const w = window.open('', '_blank'); w.document.write(`<html><head><title>Ticket</title><style>body{font-family:monospace;font-size:12px;max-width:300px;margin:0 auto;}.ticket-row{display:flex;justify-content:space-between;margin-bottom:4px;}.ticket-header{text-align:center;border-bottom:1px dashed #ccc;padding-bottom:8px;margin-bottom:8px;}.ticket-total{border-top:1px dashed #ccc;padding-top:6px;margin-top:6px;font-weight:700;}</style></head><body>${content}<script>window.print();window.close();<\/script></body></html>`); w.document.close(); };

    window.imprimirFacturaActual = () => { const content = document.getElementById('modal-ver-factura-body').innerHTML; const w = window.open('', '_blank'); w.document.write(`<html><head><title>Factura</title><style>body{font-family:monospace;font-size:12px;max-width:300px;margin:0 auto;}.ticket-row{display:flex;justify-content:space-between;margin-bottom:4px;}.ticket-header{text-align:center;border-bottom:1px dashed #ccc;padding-bottom:8px;margin-bottom:8px;}.ticket-total{border-top:1px dashed #ccc;padding-top:6px;margin-top:6px;font-weight:700;}</style></head><body>${content}<script>window.print();window.close();<\/script></body></html>`); w.document.close(); };

    window.nuevaVenta = () => { carrito = []; renderCarrito(); cerrarModal('modal-ticket'); categoriaActual = null; renderCategoriasPos(); };

    window.abrirModalVaciarCarrito = () => { if (!carrito.length) { toast('El carrito ya estÃ¡ vacÃ­o', 'info'); return; } abrirModal('modal-vaciar-carrito'); };
    window.confirmarVaciarCarrito = () => { carrito = []; renderCarrito(); cerrarModal('modal-vaciar-carrito'); toast('Carrito vaciado', 'info'); };

    // ==================== FACTURAS PAGE ====================
    async function cargarFacturas() { const q = query(collection(db, 'negocios', negocioId, 'facturas'), orderBy('fecha', 'desc'), limit(100)); const snap = await getDocs(q); facturasCache = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderTablaFacturas(facturasCache); }

    function renderTablaFacturas(facturas) { const tbody = document.getElementById('tbody-facturas'); if (!tbody) return; if (!facturas.length) { tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fas fa-file-invoice"></i><p>Sin facturas</p></div></td></tr>`; return; } tbody.innerHTML = facturas.map(f => { const fecha = f.fecha?.toDate ? f.fecha.toDate().toLocaleString('es-DO') : '-'; return `<tr><td style="font-family:var(--font-mono);font-weight:700;">${f.numero || '-'}</td><td style="font-family:var(--font-mono);font-size:11px;">${f.ncf || '-'}</td><td>${fecha}</td><td>${f.empleadoNombre || '-'}</td><td>${f.metodoPago || '-'}</td><td style="font-family:var(--font-mono);font-weight:700;">${fmt(f.total)}</td><td><span class="badge ${f.estado}">${f.estado === 'pagada' ? 'âœ… Pagada' : 'â³ Pendiente'}</span></td><td><button class="btn-sm gris" onclick="verFactura('${f.id}')" style="padding:6px 10px;font-size:12px;"><i class="fas fa-eye"></i></button>${f.estado === 'pendiente' ? `<button class="btn-sm verde" onclick="marcarPagada('${f.id}')" style="padding:6px 10px;font-size:12px;margin-left:4px;"><i class="fas fa-check"></i> Pagar</button>` : ''}</td></tr>`; }).join(''); }

    window.filtrarFacturas = () => { const buscar = document.getElementById('fact-buscar').value.toLowerCase(); const estado = document.getElementById('fact-estado').value; const metodo = document.getElementById('fact-metodo').value; const fechaIni = document.getElementById('fact-fecha-ini').value; const fechaFin = document.getElementById('fact-fecha-fin').value; let filtradas = facturasCache.filter(f => { if (buscar && !f.numero?.toLowerCase().includes(buscar)) return false; if (estado && f.estado !== estado) return false; if (metodo && f.metodoPago !== metodo) return false; if (fechaIni || fechaFin) { const fecha = f.fecha?.toDate ? f.fecha.toDate() : null; if (!fecha) return false; if (fechaIni && fecha < new Date(fechaIni)) return false; if (fechaFin && fecha > new Date(fechaFin + 'T23:59:59')) return false; } return true; }); renderTablaFacturas(filtradas); };

    window.limpiarFiltrosFacturas = () => { document.getElementById('fact-buscar').value = ''; document.getElementById('fact-fecha-ini').value = ''; document.getElementById('fact-fecha-fin').value = ''; document.getElementById('fact-estado').value = ''; document.getElementById('fact-metodo').value = ''; renderTablaFacturas(facturasCache); };

    window.verFactura = (id) => { const f = facturasCache.find(f => f.id === id); if (!f) return; document.getElementById('modal-ver-factura-body').innerHTML = generarHTMLTicket(f); abrirModal('modal-ver-factura'); };

    window.marcarPagada = async (id) => { try { await updateDoc(doc(db, 'negocios', negocioId, 'facturas', id), { estado: 'pagada' }); const f = facturasCache.find(f => f.id === id); if (f && cajaActual) { await addDoc(collection(db, 'negocios', negocioId, 'movimientos'), { tipo: 'ingreso', descripcion: `Pago factura ${f.numero}`, monto: f.total, fecha: serverTimestamp(), uid: currentUser.uid, empleadoNombre: await getEmpNombre(), facturaId: id, cajaId: cajaActual.id }); await updateDoc(doc(db, 'negocios', negocioId, 'caja', cajaActual.id), { ingresos: (cajaActual.ingresos || 0) + f.total }); } toast('Factura marcada como pagada', 'success'); await cargarFacturas(); } catch (e) { toast('Error: ' + e.message, 'error'); } };

    // ==================== INVENTARIO - NUEVA VERSIÃ“N CON BÃšSQUEDA, DRAG TÃCTIL Y MOVER PRODUCTO ENTRE CATEGORÃAS ====================
    function renderInventario() {
      if (inventarioCategoriaActual) {
        renderProductosInventario(inventarioCategoriaActual, inventarioBusquedaActual);
        document.getElementById('btn-volver-cats').style.display = 'inline-flex';
      } else {
        renderCategoriasInventario();
        document.getElementById('btn-volver-cats').style.display = 'none';
      }
    }

    window.toggleModoOrden = () => {
      modoOrdenActivo = !modoOrdenActivo;
      const btn = document.getElementById('btn-modo-ordenar');
      if (btn) {
        btn.classList.toggle('activo', modoOrdenActivo);
        btn.innerHTML = modoOrdenActivo
          ? '<i class="fas fa-check"></i> Listo'
          : '<i class="fas fa-arrows-alt"></i> Ordenar';
      }
      document.querySelectorAll('.categorias-grid-inv, .productos-grid-inv').forEach(g => {
        g.classList.toggle('modo-orden', modoOrdenActivo);
        g.querySelectorAll('[draggable]').forEach(c => c.draggable = modoOrdenActivo);
      });
    };

    // Soporte tÃ¡ctil para drag & drop
    let touchDragSrcEl = null;
    let touchDragSrcId = null;
    let touchDragType = null;
    let touchStartX = 0, touchStartY = 0;

    function attachTouchDrag(card, id, type, container) {
      card.addEventListener('touchstart', (e) => {
        if (!modoOrdenActivo) return;
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchDragSrcEl = card;
        touchDragSrcId = id;
        touchDragType = type;
        card.classList.add('dragging');
        e.preventDefault();
      });

      card.addEventListener('touchmove', (e) => {
        if (!modoOrdenActivo || !touchDragSrcEl) return;
        const touch = e.touches[0];
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        const dragOverCard = target?.closest(type === 'cat' ? '.cat-card-inv' : '.prod-card-inv');
        if (dragOverCard && dragOverCard !== touchDragSrcEl) {
          container.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
          dragOverCard.classList.add('drag-over');
        }
        e.preventDefault();
      });

      card.addEventListener('touchend', async (e) => {
        if (!modoOrdenActivo || !touchDragSrcEl) {
          card.classList.remove('dragging');
          touchDragSrcEl = null;
          return;
        }
        const touch = e.changedTouches[0];
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        const dropCard = target?.closest(type === 'cat' ? '.cat-card-inv' : '.prod-card-inv');

        if (dropCard && dropCard !== touchDragSrcEl) {
          const allCards = [...container.children];
          const srcIdx = allCards.indexOf(touchDragSrcEl);
          const dstIdx = allCards.indexOf(dropCard);
          if (srcIdx < dstIdx) container.insertBefore(touchDragSrcEl, dropCard.nextSibling);
          else container.insertBefore(touchDragSrcEl, dropCard);

          const newOrder = [...container.children].map(c => c.dataset.id);
          if (type === 'cat') {
            categorias.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
            [...container.children].forEach((c, i) => {
              const badge = c.querySelector('.orden-badge');
              if (badge) badge.textContent = i + 1;
            });
            renderCategoriasPos();
            populateCatSelects();
            await guardarOrdenCategorias();
          } else {
            newOrder.forEach((id, i) => { const p = productos.find(x => x.id === id); if (p) p.orden = i + 1; });
            [...container.children].forEach((c, i) => {
              const badge = c.querySelector('.orden-badge');
              if (badge) badge.textContent = i + 1;
            });
            await guardarOrdenProductos(newOrder, inventarioCategoriaActual);
          }
        }
        container.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
        touchDragSrcEl.classList.remove('dragging');
        touchDragSrcEl = null;
        e.preventDefault();
      });
    }

    function renderCategoriasInventario() {
      const area = document.getElementById('inv-contenido');
      if (!area) return;
      if (!categorias.length) {
        area.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><p>No hay categorÃ­as creadas.<br>Haz clic en "CategorÃ­a" para agregar.</p></div>`;
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'categorias-grid-inv' + (modoOrdenActivo ? ' modo-orden' : '');

      const attachCatDragEvents = (card, catId) => {
        // Mouse events
        card.addEventListener('dragstart', (e) => {
          if (!modoOrdenActivo) { e.preventDefault(); return; }
          card.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', catId);
          window._dragSrcEl = card;
          window._dragSrcId = catId;
          window._dragType = 'cat';
        });
        card.addEventListener('dragend', () => {
          card.classList.remove('dragging');
          grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
        });
        card.addEventListener('dragover', (e) => {
          if (!modoOrdenActivo || window._dragType !== 'cat') return;
          e.preventDefault();
          if (card !== window._dragSrcEl) {
            grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
            card.classList.add('drag-over');
          }
        });
        card.addEventListener('dragleave', (e) => {
          if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over');
        });
        card.addEventListener('drop', async (e) => {
          e.preventDefault();
          card.classList.remove('drag-over');
          if (!modoOrdenActivo || window._dragType !== 'cat') return;
          const srcEl = window._dragSrcEl;
          const srcId = window._dragSrcId;
          if (!srcEl || srcId === catId) return;
          const allCards = [...grid.children];
          const srcIdx = allCards.indexOf(srcEl);
          const dstIdx = allCards.indexOf(card);
          if (srcIdx < dstIdx) grid.insertBefore(srcEl, card.nextSibling);
          else grid.insertBefore(srcEl, card);
          const newOrder = [...grid.children].map(c => c.dataset.id);
          categorias.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
          [...grid.children].forEach((c, i) => {
            const badge = c.querySelector('.orden-badge');
            if (badge) badge.textContent = i + 1;
          });
          renderCategoriasPos();
          populateCatSelects();
          await guardarOrdenCategorias();
        });

        // Touch events
        attachTouchDrag(card, catId, 'cat', grid);
      };

      categorias.forEach((cat, index) => {
        const card = document.createElement('div');
        card.className = 'cat-card-inv';
        card.draggable = modoOrdenActivo;
        card.dataset.id = cat.id;

        const imgHtml = cat.imagen
          ? `<img src="${cat.imagen}" alt="${cat.nombre}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px 10px 0 0;display:block;" onerror="this.style.display='none'">`
          : `<span class="cat-emoji-inv">${cat.emoji || 'ðŸ“¦'}</span>`;

        card.innerHTML = `
          <span class="orden-badge">${index + 1}</span>
          <div class="drag-grip-overlay"><i class="fas fa-grip-lines"></i></div>
          ${imgHtml}
          <div class="cat-info-inv">
            <div class="cat-nombre-inv">${cat.nombre}</div>
            <div class="cat-stats-inv">${productos.filter(p => p.categoriaId === cat.id).length} productos</div>
          </div>
          <div class="cat-actions-inv">
            <button class="icon-btn-sm" onclick="event.stopPropagation();editarCategoria('${cat.id}')" title="Editar"><i class="fas fa-edit"></i></button>
            <button class="icon-btn-sm" onclick="event.stopPropagation();eliminarCategoria('${cat.id}')" title="Eliminar"><i class="fas fa-trash"></i></button>
          </div>`;

        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
          if (modoOrdenActivo) return;
          if (e.target.closest('.cat-actions-inv')) return;
          verProductosPorCategoriaInventario(cat.id);
        });

        attachCatDragEvents(card, cat.id);
        grid.appendChild(card);
      });

      area.innerHTML = '';
      area.appendChild(grid);
    }

    async function guardarOrdenCategorias() {
      const indicator = document.getElementById('guardando-orden-indicator');
      if (indicator) indicator.classList.add('visible');
      try {
        const batch = writeBatch(db);
        categorias.forEach((cat, i) => {
          batch.update(doc(db, 'negocios', negocioId, 'categorias', cat.id), { orden: i + 1 });
          cat.orden = i + 1;
        });
        await batch.commit();
      } catch (e) {
        toast('Error guardando orden: ' + e.message, 'error');
      } finally {
        if (indicator) setTimeout(() => indicator.classList.remove('visible'), 1400);
      }
    }

    function resaltarTextoInv(texto, busqueda) {
      if (!busqueda) return escapeHtml(texto);
      const regex = new RegExp(`(${busqueda.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      return escapeHtml(texto).replace(regex, '<span class="search-highlight">$1</span>');
    }

    function renderProductosInventario(categoriaId, busqueda = '') {
      const area = document.getElementById('inv-contenido');
      const categoria = categorias.find(c => c.id === categoriaId);
      let prods = productos.filter(p => p.categoriaId === categoriaId);
      if (busqueda) prods = prods.filter(p => p.nombre?.toLowerCase().includes(busqueda.toLowerCase()) || (p.codigoBarras || '').includes(busqueda));
      if (!area) return;

      const header = `<div class="productos-header-inv"><button class="back-btn" onclick="volverCategoriasInventario()"><i class="fas fa-arrow-left"></i> CategorÃ­as</button><strong>${categoria?.nombre || 'Productos'}</strong><button class="btn-sm verde" onclick="abrirModalProductoDesdeCategoria('${categoriaId}')" style="margin-left:auto;"><i class="fas fa-plus"></i> Producto</button></div>`;

      if (!prods.length) {
        area.innerHTML = header + `<div class="empty-state"><i class="fas fa-box-open"></i><p>No hay productos en esta categorÃ­a</p></div>`;
        return;
      }

      prods.sort((a, b) => (a.orden ?? 9999) - (b.orden ?? 9999));

      const grid = document.createElement('div');
      grid.className = 'productos-grid-inv' + (modoOrdenActivo ? ' modo-orden' : '');
      grid.id = 'prod-drag-grid';

      const attachProdDragEvents = (card, prod) => {
        // Mouse events
        card.addEventListener('dragstart', (e) => {
          if (!modoOrdenActivo) { e.preventDefault(); return; }
          card.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', prod.id);
          window._dragSrcEl = card;
          window._dragSrcId = prod.id;
          window._dragType = 'prod';
        });
        card.addEventListener('dragend', () => {
          card.classList.remove('dragging');
          grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
        });
        card.addEventListener('dragover', (e) => {
          if (!modoOrdenActivo || window._dragType !== 'prod') return;
          e.preventDefault();
          if (card !== window._dragSrcEl) {
            grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
            card.classList.add('drag-over');
          }
        });
        card.addEventListener('dragleave', (e) => {
          if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over');
        });
        card.addEventListener('drop', async (e) => {
          e.preventDefault();
          card.classList.remove('drag-over');
          if (!modoOrdenActivo || window._dragType !== 'prod') return;
          const srcEl = window._dragSrcEl;
          const srcId = window._dragSrcId;
          if (!srcEl || srcId === prod.id) return;
          const allCards = [...grid.children];
          const srcIdx = allCards.indexOf(srcEl);
          const dstIdx = allCards.indexOf(card);
          if (srcIdx < dstIdx) grid.insertBefore(srcEl, card.nextSibling);
          else grid.insertBefore(srcEl, card);
          const newOrder = [...grid.children].map(c => c.dataset.id);
          newOrder.forEach((id, i) => { const p = productos.find(x => x.id === id); if (p) p.orden = i + 1; });
          [...grid.children].forEach((c, i) => {
            const badge = c.querySelector('.orden-badge');
            if (badge) badge.textContent = i + 1;
          });
          await guardarOrdenProductos(newOrder, categoriaId);
        });

        // Touch events
        attachTouchDrag(card, prod.id, 'prod', grid);
      };

      prods.forEach((p, index) => {
        const sinStock = p.stock <= 0;
        const bajoStock = p.stock > 0 && p.stock <= (p.stockMin || 5);
        const card = document.createElement('div');
        card.className = `prod-card-inv${sinStock ? ' sin-stock' : ''}`;
        card.draggable = modoOrdenActivo;
        card.dataset.id = p.id;

        const nombreResaltado = resaltarTextoInv(p.nombre || '', busqueda);
        const barcodeResaltado = p.codigoBarras ? resaltarTextoInv(p.codigoBarras, busqueda) : '';

        card.innerHTML = `
          <span class="orden-badge" style="background:#00b341;">${index + 1}</span>
          <div class="drag-grip-overlay"><i class="fas fa-grip-lines"></i></div>
          ${p.imagen ? `<img src="${p.imagen}" alt="${p.nombre}" loading="lazy" onerror="this.outerHTML='<div class=&quot;prod-emoji-inv&quot;>ðŸ“¦</div>'">` : `<div class="prod-emoji-inv">ðŸ“¦</div>`}
          ${bajoStock ? `<div class="stock-badge-inv warning">âš ï¸ Stock bajo: ${p.stock}</div>` : ''}
          ${sinStock ? `<div class="stock-badge-inv danger">Sin stock</div>` : ''}
          <div class="prod-info-inv">
            <div class="prod-nombre-inv">${nombreResaltado}</div>
            ${p.codigoBarras ? `<div class="prod-codigo-inv">${barcodeResaltado}</div>` : ''}
            <div class="prod-precios-inv"><span class="precio-venta">${fmt(p.precio)}</span>${p.costo ? `<span class="precio-costo">Costo: ${fmt(p.costo)}</span>` : ''}</div>
            <div class="prod-stock-inv ${bajoStock ? 'bajo' : ''} ${sinStock ? 'sin' : ''}">Stock: ${p.stock || 0} ${p.unidad || ''}</div>
            <div class="prod-actions-inv">
              <button class="btn-sm gris" onclick="editarProducto('${p.id}')"><i class="fas fa-edit"></i> Editar</button>
              <button class="btn-sm rojo" onclick="eliminarProducto('${p.id}')"><i class="fas fa-trash"></i> Eliminar</button>
            </div>
          </div>`;

        attachProdDragEvents(card, p);
        grid.appendChild(card);
      });

      area.innerHTML = header;
      area.appendChild(grid);
    }

    async function guardarOrdenProductos(newOrder, categoriaId) {
      const indicator = document.getElementById('guardando-orden-indicator');
      if (indicator) indicator.classList.add('visible');
      try {
        const batch = writeBatch(db);
        newOrder.forEach((id, i) => {
          batch.update(doc(db, 'negocios', negocioId, 'categorias', categoriaId, 'productos', id), { orden: i + 1 });
        });
        await batch.commit();
      } catch (e) {
        toast('Error guardando orden: ' + e.message, 'error');
      } finally {
        if (indicator) setTimeout(() => indicator.classList.remove('visible'), 1400);
      }
    }

    window.verProductosPorCategoriaInventario = (catId) => { inventarioCategoriaActual = catId; inventarioBusquedaActual = ''; document.getElementById('inv-buscar').value = ''; renderInventario(); };

    window.volverCategoriasInventario = () => { inventarioCategoriaActual = null; inventarioBusquedaActual = ''; document.getElementById('inv-buscar').value = ''; renderInventario(); };

    window.filtrarInventarioBusqueda = (texto) => { inventarioBusquedaActual = texto; renderInventario(); };

    window.abrirModalProductoDesdeCategoria = (categoriaId) => {
      productoEnEdicion = null;
      document.getElementById('modal-prod-titulo').innerHTML = '<i class="fas fa-box"></i> Nuevo Producto';
      ['prod-nombre', 'prod-barcode', 'prod-precio', 'prod-costo', 'prod-stock', 'prod-stock-min'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('prod-id').value = '';
      document.getElementById('prod-img-preview').src = '';
      document.getElementById('prod-img-preview').style.display = 'none';
      const icon = document.getElementById('prod-img-icon');
      const h1 = document.getElementById('prod-img-hint1');
      const h2 = document.getElementById('prod-img-hint2');
      const rh = document.getElementById('prod-img-replace-hint');
      if (icon) icon.style.display = 'block';
      if (h1) h1.style.display = 'block';
      if (h2) h2.style.display = 'block';
      if (rh) rh.style.display = 'none';
      document.getElementById('prod-unidad').value = 'Unidad';
      document.getElementById('prod-itbis').value = '1';
      populateCatSelects();
      document.getElementById('prod-categoria').value = categoriaId;
      abrirModal('modal-producto');
    };

    window.editarCategoria = async (catId) => { const cat = categorias.find(c => c.id === catId); if (!cat) return; document.getElementById('cat-nombre').value = cat.nombre || ''; document.getElementById('cat-emoji').value = cat.emoji || ''; const icon = document.getElementById('cat-img-icon'); const hint = document.getElementById('cat-img-hint'); if (cat.imagen) { document.getElementById('cat-img-preview').src = cat.imagen; document.getElementById('cat-img-preview').style.display = 'block'; if (icon) icon.style.display = 'none'; if (hint) hint.style.display = 'none'; } else { document.getElementById('cat-img-preview').src = ''; document.getElementById('cat-img-preview').style.display = 'none'; if (icon) icon.style.display = 'block'; if (hint) hint.style.display = 'block'; } window.categoriaEditandoId = catId; abrirModal('modal-categoria'); };

    window.eliminarCategoria = async (catId) => { const productosEnCat = productos.filter(p => p.categoriaId === catId); if (productosEnCat.length > 0) { toast(`No se puede eliminar la categorÃ­a. Tiene ${productosEnCat.length} productos.`, 'error'); return; } if (!confirm('Â¿Eliminar esta categorÃ­a?')) return; try { await deleteDoc(doc(db, 'negocios', negocioId, 'categorias', catId)); toast('CategorÃ­a eliminada', 'success'); } catch (e) { toast('Error: ' + e.message, 'error'); } };

    const guardarCategoriaOriginal = window.guardarCategoria;
    window.guardarCategoria = async () => {
      const nombre = document.getElementById('cat-nombre').value.trim();
      const emoji = document.getElementById('cat-emoji').value.trim() || 'ðŸ“¦';
      if (!nombre) { toast('Ingresa el nombre de la categorÃ­a', 'error'); return; }
      let imagen = '';
      const preview = document.getElementById('cat-img-preview');
      if (preview.src && preview.src !== window.location.href && preview.style.display !== 'none' && !preview.src.includes('firebasestorage')) {
        imagen = await subirImagenBase64(preview.src, `cats/${negocioId}/${Date.now()}`);
      } else if (window.categoriaEditandoId) {
        const catExistente = categorias.find(c => c.id === window.categoriaEditandoId);
        if (catExistente?.imagen && preview.src === catExistente.imagen) { imagen = catExistente.imagen; }
      }
      try {
        if (window.categoriaEditandoId) {
          await updateDoc(doc(db, 'negocios', negocioId, 'categorias', window.categoriaEditandoId), { nombre, emoji, imagen });
          toast('CategorÃ­a actualizada', 'success');
          delete window.categoriaEditandoId;
        } else {
          const nextOrden = categorias.length + 1;
          await addDoc(collection(db, 'negocios', negocioId, 'categorias'), { nombre, emoji, imagen, orden: nextOrden, creadoEn: serverTimestamp() });
          toast('CategorÃ­a creada', 'success');
        }
        cerrarModal('modal-categoria');
        document.getElementById('cat-img-preview').src = '';
        document.getElementById('cat-img-preview').style.display = 'none';
      } catch (e) { toast('Error: ' + e.message, 'error'); }
    };

    window.abrirModalCategoria = () => { delete window.categoriaEditandoId; document.getElementById('cat-nombre').value = ''; document.getElementById('cat-emoji').value = ''; document.getElementById('cat-img-preview').src = ''; document.getElementById('cat-img-preview').style.display = 'none'; const icon = document.getElementById('cat-img-icon'); const hint = document.getElementById('cat-img-hint'); if (icon) icon.style.display = 'block'; if (hint) hint.style.display = 'block'; abrirModal('modal-categoria'); };

    function populateCatSelects() {
      const selects = ['prod-categoria'];
      selects.forEach(id => { const sel = document.getElementById(id); if (!sel) return; const prev = sel.value; sel.innerHTML = '<option value="">Selecciona categorÃ­a...</option>' + categorias.map(c => `<option value="${c.id}">${c.emoji || 'ðŸ“¦'} ${c.nombre}</option>`).join(''); if (prev && categorias.find(c => c.id === prev)) sel.value = prev; });
    }

    window.abrirModalProducto = () => {
      productoEnEdicion = null;
      document.getElementById('modal-prod-titulo').innerHTML = '<i class="fas fa-box"></i> Nuevo Producto';
      ['prod-nombre', 'prod-barcode', 'prod-precio', 'prod-costo', 'prod-stock', 'prod-stock-min'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('prod-id').value = '';
      document.getElementById('prod-img-preview').src = '';
      document.getElementById('prod-img-preview').style.display = 'none';
      const icon = document.getElementById('prod-img-icon');
      const h1 = document.getElementById('prod-img-hint1');
      const h2 = document.getElementById('prod-img-hint2');
      const rh = document.getElementById('prod-img-replace-hint');
      if (icon) icon.style.display = 'block';
      if (h1) h1.style.display = 'block';
      if (h2) h2.style.display = 'block';
      if (rh) rh.style.display = 'none';
      document.getElementById('prod-unidad').value = 'Unidad';
      document.getElementById('prod-itbis').value = '1';
      populateCatSelects();
      if (inventarioCategoriaActual) {
        document.getElementById('prod-categoria').value = inventarioCategoriaActual;
      }
      abrirModal('modal-producto');
    };

    window.editarProducto = (id) => { const p = productos.find(pr => pr.id === id); if (!p) return; productoEnEdicion = p; document.getElementById('modal-prod-titulo').innerHTML = '<i class="fas fa-edit"></i> Editar Producto'; document.getElementById('prod-id').value = p.id; document.getElementById('prod-nombre').value = p.nombre || ''; document.getElementById('prod-barcode').value = p.codigoBarras || ''; document.getElementById('prod-precio').value = p.precio || ''; document.getElementById('prod-costo').value = p.costo || ''; document.getElementById('prod-stock').value = p.stock || ''; document.getElementById('prod-stock-min').value = p.stockMin || ''; document.getElementById('prod-unidad').value = p.unidad || 'Unidad'; document.getElementById('prod-itbis').value = p.itbis !== false ? '1' : '0'; populateCatSelects(); document.getElementById('prod-categoria').value = p.categoriaId || ''; const icon = document.getElementById('prod-img-icon'); const h1 = document.getElementById('prod-img-hint1'); const h2 = document.getElementById('prod-img-hint2'); const rh = document.getElementById('prod-img-replace-hint'); if (p.imagen) { document.getElementById('prod-img-preview').src = p.imagen; document.getElementById('prod-img-preview').style.display = 'block'; if (icon) icon.style.display = 'none'; if (h1) h1.style.display = 'none'; if (h2) h2.style.display = 'none'; if (rh) rh.style.display = 'block'; } else { document.getElementById('prod-img-preview').src = ''; document.getElementById('prod-img-preview').style.display = 'none'; if (icon) icon.style.display = 'block'; if (h1) h1.style.display = 'block'; if (h2) h2.style.display = 'block'; if (rh) rh.style.display = 'none'; } abrirModal('modal-producto'); };

    window.guardarProducto = async () => {
      const nombre = document.getElementById('prod-nombre').value.trim();
      const precio = parseFloat(document.getElementById('prod-precio').value);
      let catId = document.getElementById('prod-categoria').value;
      if (!nombre || isNaN(precio) || !catId) { toast('Nombre, precio y categorÃ­a son requeridos', 'error'); return; }

      const data = {
        nombre,
        precio,
        costo: parseFloat(document.getElementById('prod-costo').value) || 0,
        stock: parseInt(document.getElementById('prod-stock').value) || 0,
        stockMin: parseInt(document.getElementById('prod-stock-min').value) || 5,
        codigoBarras: document.getElementById('prod-barcode').value.trim(),
        unidad: document.getElementById('prod-unidad').value,
        itbis: document.getElementById('prod-itbis').value === '1',
        categoriaId: catId,
        actualizadoEn: serverTimestamp()
      };

      const preview = document.getElementById('prod-img-preview');
      if (preview.src && !preview.src.startsWith('http') && preview.style.display !== 'none') {
        data.imagen = await subirImagenBase64(preview.src, `prods/${negocioId}/${Date.now()}`);
      } else if (productoEnEdicion?.imagen) {
        data.imagen = productoEnEdicion.imagen;
      }

      try {
        const prodId = document.getElementById('prod-id').value;
        if (prodId) {
          // Si estÃ¡ cambiando de categorÃ­a, mover el producto
          if (productoEnEdicion && productoEnEdicion.categoriaId !== catId) {
            // Crear en nueva categorÃ­a
            await addDoc(collection(db, 'negocios', negocioId, 'categorias', catId, 'productos'), { ...data, creadoEn: serverTimestamp() });
            // Eliminar de categorÃ­a anterior
            await deleteDoc(doc(db, 'negocios', negocioId, 'categorias', productoEnEdicion.categoriaId, 'productos', prodId));
            toast('Producto movido a nueva categorÃ­a', 'success');
          } else {
            // Actualizar en misma categorÃ­a
            await updateDoc(doc(db, 'negocios', negocioId, 'categorias', catId, 'productos', prodId), data);
            toast('Producto actualizado', 'success');
          }
        } else {
          data.creadoEn = serverTimestamp();
          await addDoc(collection(db, 'negocios', negocioId, 'categorias', catId, 'productos'), data);
          toast('Producto creado', 'success');
        }
        cerrarModal('modal-producto');
        await cargarTodosProductos();
        renderInventario();
      } catch (e) { toast('Error: ' + e.message, 'error'); }
    };

    window.eliminarProducto = async (id) => { if (!confirm('Â¿Eliminar este producto?')) return; const p = productos.find(pr => pr.id === id); if (!p) return; try { await deleteDoc(doc(db, 'negocios', negocioId, 'categorias', p.categoriaId, 'productos', id)); toast('Producto eliminado', 'success'); await cargarTodosProductos(); renderInventario(); } catch (e) { toast('Error: ' + e.message, 'error'); } };

    async function subirImagenBase64(dataUrl, path) { try { const imgRef = ref(storage, path); await uploadString(imgRef, dataUrl, 'data_url'); return await getDownloadURL(imgRef); } catch (e) { console.warn('Error subiendo imagen:', e); return dataUrl; } }

    function comprimirImagen(file, maxHeight = 175, quality = 0.94) {
      return new Promise((resolve, reject) => {
        const objectURL = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(objectURL);
          let { width, height } = img;
          if (height > maxHeight) { width = Math.round(width * (maxHeight / height)); height = maxHeight; }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const isSVG = file.type === 'image/svg+xml';
          const hasPossibleAlpha = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp' || file.type === 'image/avif';
          const outMime = (isSVG || !hasPossibleAlpha) ? 'image/jpeg' : 'image/png';
          const outQuality = outMime === 'image/jpeg' ? quality : undefined;
          resolve(canvas.toDataURL(outMime, outQuality));
        };
        img.onerror = () => { URL.revokeObjectURL(objectURL); reject(new Error('No se pudo cargar la imagen')); };
        img.src = objectURL;
      });
    }

    window.previewImagen = async (input) => {
      const file = input.files[0]; if (!file) return;
      try {
        const dataUrl = await comprimirImagen(file);
        const prev = document.getElementById('prod-img-preview');
        prev.src = dataUrl; prev.style.display = 'block';
        const icon = document.getElementById('prod-img-icon');
        const hint1 = document.getElementById('prod-img-hint1');
        const hint2 = document.getElementById('prod-img-hint2');
        const replaceHint = document.getElementById('prod-img-replace-hint');
        if (icon) icon.style.display = 'none';
        if (hint1) hint1.style.display = 'none';
        if (hint2) hint2.style.display = 'none';
        if (replaceHint) replaceHint.style.display = 'block';
      } catch (e) { toast('Error procesando imagen: ' + e.message, 'error'); }
    };

    window.previewCatImagen = async (input) => {
      const file = input.files[0]; if (!file) return;
      try {
        const dataUrl = await comprimirImagen(file);
        const prev = document.getElementById('cat-img-preview');
        prev.src = dataUrl; prev.style.display = 'block';
        const icon = document.getElementById('cat-img-icon');
        const hint = document.getElementById('cat-img-hint');
        if (icon) icon.style.display = 'none';
        if (hint) hint.style.display = 'none';
      } catch (e) { toast('Error procesando imagen: ' + e.message, 'error'); }
    };

    window.escanearBarcodeProducto = () => { const val = prompt('Ingresa el cÃ³digo de barras:'); if (val) document.getElementById('prod-barcode').value = val; };

    // ==================== EMPLEADOS ====================
    async function loadEmpleados() { const snap = await getDocs(collection(db, 'negocios', negocioId, 'empleados')); empleadosCache = snap.docs.map(d => ({ id: d.id, ...d.data() })); }

    function renderEmpleados() { const lista = document.getElementById('empleados-lista'); if (!lista) return; if (!empleadosCache.length) { lista.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><p>Sin empleados</p></div>'; return; } lista.innerHTML = empleadosCache.map(e => `<div class="empleado-row"><div class="empleado-avatar">${(e.nombre || 'E')[0].toUpperCase()}</div><div class="empleado-info"><div class="emp-nombre">${e.nombre}</div><div class="emp-email">${e.email}</div></div><span class="emp-rol ${e.rol}">${e.rol}</span>${e.uid !== currentUser.uid ? `<button class="btn-sm" onclick="eliminarEmpleado('${e.id}')" style="background:#ffe3e3;color:#e03131;padding:6px 10px;font-size:12px;"><i class="fas fa-trash"></i></button>` : ''}</div>`).join(''); }

    window.abrirModalEmpleado = () => { ['emp-nombre', 'emp-email', 'emp-pass'].forEach(id => document.getElementById(id).value = ''); document.getElementById('emp-rol').value = 'empleado'; abrirModal('modal-empleado'); };

    window.guardarEmpleado = async () => { const nombre = document.getElementById('emp-nombre').value.trim(); const email = document.getElementById('emp-email').value.trim(); const pass = document.getElementById('emp-pass').value; const rol = document.getElementById('emp-rol').value; if (!nombre || !email || !pass) { toast('Todos los campos son requeridos', 'error'); return; } if (pass.length < 6) { toast('La contraseÃ±a debe tener mÃ­nimo 6 caracteres', 'error'); return; } try { const cred = await createUserWithEmailAndPassword(auth, email, pass); const uid = cred.user.uid; localStorage.setItem(`negocio_${uid}`, negocioId); await setDoc(doc(db, 'negocios', negocioId, 'empleados', uid), { nombre, email, rol, uid, activo: true, creadoEn: serverTimestamp() }); empleadosCache.push({ id: uid, nombre, email, rol, uid }); renderEmpleados(); cerrarModal('modal-empleado'); toast('Empleado agregado', 'success'); } catch (e) { let msg = 'Error: '; if (e.code === 'auth/email-already-in-use') msg += 'Ese email ya existe'; else msg += e.message; toast(msg, 'error'); } };

    window.eliminarEmpleado = async (id) => { if (!confirm('Â¿Eliminar este empleado?')) return; try { await deleteDoc(doc(db, 'negocios', negocioId, 'empleados', id)); empleadosCache = empleadosCache.filter(e => e.id !== id); renderEmpleados(); toast('Empleado eliminado', 'success'); } catch (e) { toast('Error: ' + e.message, 'error'); } };

    // ==================== CONFIG ====================
    function renderConfig() { if (!negocioData) return; initPaisSelects(); document.getElementById('cfg-nombre').value = negocioData.nombre || ''; document.getElementById('cfg-rnc').value = negocioData.rnc || ''; document.getElementById('cfg-direccion').value = negocioData.direccion || ''; document.getElementById('cfg-telefono').value = negocioData.telefono || ''; document.getElementById('cfg-whatsapp').value = negocioData.whatsapp || ''; document.getElementById('cfg-ncf-prefijo').value = config.ncfPrefijo || 'B01'; document.getElementById('cfg-ncf-seq').value = config.ncfSeq || 1; document.getElementById('cfg-itbis-pct').value = config.itbisPct || 18; document.getElementById('cfg-itbis-cliente').checked = config.itbisCliente !== false; updateTelPreview('cfg-tel-pais', negocioData.telefono || '', 'cfg-tel-preview'); updateTelPreview('cfg-ws-pais', negocioData.whatsapp || '', 'cfg-ws-preview'); }

    window.guardarConfig = async () => { try { const negUpdate = { nombre: document.getElementById('cfg-nombre').value.trim(), rnc: document.getElementById('cfg-rnc').value.trim(), direccion: document.getElementById('cfg-direccion').value.trim(), telefono: document.getElementById('cfg-telefono').value.trim() }; const cfgUpdate = { ncfPrefijo: document.getElementById('cfg-ncf-prefijo').value.trim() || 'B01', ncfSeq: parseInt(document.getElementById('cfg-ncf-seq').value) || 1, itbisPct: parseFloat(document.getElementById('cfg-itbis-pct').value) || 18, itbisCliente: document.getElementById('cfg-itbis-cliente').checked }; await updateDoc(doc(db, 'negocios', negocioId), negUpdate); await updateDoc(doc(db, 'negocios', negocioId, 'configuraciones', 'general'), cfgUpdate); negocioData = { ...negocioData, ...negUpdate }; config = { ...config, ...cfgUpdate }; document.getElementById('nav-negocio-nombre').textContent = negocioData.nombre || 'Mi Colmado'; toast('ConfiguraciÃ³n guardada', 'success'); } catch (e) { toast('Error: ' + e.message, 'error'); } };

    // ==================== ESTADÃSTICAS ====================
    window.estadisticasHoy = () => { const hoy = new Date(); document.getElementById('stats-fecha-ini').value = hoy.toISOString().split('T')[0]; document.getElementById('stats-fecha-fin').value = hoy.toISOString().split('T')[0]; calcularEstadisticas(); };

    window.calcularEstadisticas = async () => { const fechaIni = document.getElementById('stats-fecha-ini').value; const fechaFin = document.getElementById('stats-fecha-fin').value; let q; if (fechaIni && fechaFin) { const ini = Timestamp.fromDate(new Date(fechaIni)); const fin = Timestamp.fromDate(new Date(fechaFin + 'T23:59:59')); q = query(collection(db, 'negocios', negocioId, 'facturas'), where('fecha', '>=', ini), where('fecha', '<=', fin), orderBy('fecha', 'asc')); } else { q = query(collection(db, 'negocios', negocioId, 'facturas'), orderBy('fecha', 'desc'), limit(100)); } const snap = await getDocs(q); const facturas = snap.docs.map(d => ({ id: d.id, ...d.data() })); const pagadas = facturas.filter(f => f.estado === 'pagada'); const totalVentas = pagadas.reduce((s, f) => s + (f.total || 0), 0); const numFacturas = pagadas.length; let prodsVendidos = 0; const prodConteo = {}; pagadas.forEach(f => { (f.items || []).forEach(i => { prodsVendidos += i.qty || 0; prodConteo[i.nombre] = (prodConteo[i.nombre] || 0) + (i.qty || 0); }); }); document.getElementById('stat-ventas-total').textContent = fmt(totalVentas); document.getElementById('stat-num-facturas').textContent = numFacturas; document.getElementById('stat-prods-vendidos').textContent = prodsVendidos; document.getElementById('stat-promedio').textContent = numFacturas ? fmt(totalVentas / numFacturas) : 'RD$ 0'; renderCharts(pagadas, prodConteo); await calcularContabilidad(fechaIni, fechaFin); };

    async function calcularContabilidad(fechaIni, fechaFin) { let q; if (fechaIni && fechaFin) { const ini = Timestamp.fromDate(new Date(fechaIni)); const fin = Timestamp.fromDate(new Date(fechaFin + 'T23:59:59')); q = query(collection(db, 'negocios', negocioId, 'movimientos'), where('fecha', '>=', ini), where('fecha', '<=', fin)); } else { q = query(collection(db, 'negocios', negocioId, 'movimientos'), limit(500)); } const snap = await getDocs(q); const movs = snap.docs.map(d => d.data()); const ingresos = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0); const egresos = movs.filter(m => m.tipo === 'gasto').reduce((s, m) => s + (m.monto || 0), 0); document.getElementById('contab-ingresos').textContent = fmt(ingresos); document.getElementById('contab-egresos').textContent = fmt(egresos); document.getElementById('contab-ganancia').textContent = fmt(ingresos - egresos); }

    function renderCharts(facturas, prodConteo) {
      const ventasPorDia = {}; facturas.forEach(f => { const fecha = f.fecha?.toDate ? f.fecha.toDate().toLocaleDateString('es-DO') : 'Sin fecha'; ventasPorDia[fecha] = (ventasPorDia[fecha] || 0) + (f.total || 0); });
      if (chartVentas) chartVentas.destroy(); const ctxV = document.getElementById('chart-ventas'); if (ctxV) { chartVentas = new Chart(ctxV, { type: 'bar', data: { labels: Object.keys(ventasPorDia), datasets: [{ label: 'Ventas', data: Object.values(ventasPorDia), backgroundColor: '#00b341', borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } }); }
      const topProds = Object.entries(prodConteo).sort((a, b) => b[1] - a[1]).slice(0, 8); if (chartProductos) chartProductos.destroy(); const ctxP = document.getElementById('chart-productos'); if (ctxP) { chartProductos = new Chart(ctxP, { type: 'bar', data: { labels: topProds.map(p => p[0]), datasets: [{ label: 'Cantidad', data: topProds.map(p => p[1]), backgroundColor: '#1971c2', borderRadius: 6 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } }); }
      const metodos = { efectivo: 0, transferencia: 0, tarjeta: 0 }; facturas.forEach(f => { if (metodos.hasOwnProperty(f.metodoPago)) metodos[f.metodoPago] += f.total || 0; }); if (chartMetodos) chartMetodos.destroy(); const ctxM = document.getElementById('chart-metodos'); if (ctxM) { chartMetodos = new Chart(ctxM, { type: 'doughnut', data: { labels: ['Efectivo', 'Transferencia', 'Tarjeta'], datasets: [{ data: [metodos.efectivo, metodos.transferencia, metodos.tarjeta], backgroundColor: ['#00b341', '#1971c2', '#ffd100'] }] }, options: { responsive: true, plugins: { legend: { position: 'bottom' } } } }); }
    }

    window.exportarMovimientos = () => { let csv = 'Hora,Tipo,DescripciÃ³n,Empleado,Monto\n'; movimientosCache.forEach(m => { const fecha = m.fecha?.toDate ? m.fecha.toDate().toLocaleTimeString('es-DO') : '-'; csv += `"${fecha}","${m.tipo}","${m.descripcion}","${m.empleadoNombre || '-'}","${m.monto}"\n`; }); const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `movimientos_${new Date().toLocaleDateString('es-DO')}.csv`; a.click(); };

    // ==================== HELPERS ====================



