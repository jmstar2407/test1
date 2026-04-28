/**
 * ════════════════════════════════════════════════════════════════════
 * MÓDULO: config.js — Configuración del Negocio
 * RESPONSABILIDAD: Gestión de la configuración general del negocio:
 *                  ITBIS, NCF, perfil del negocio, empleados,
 *                  WhatsApp, impresora térmica, etc.
 *
 * FUNCIONES EXPUESTAS EN window:
 *   cargarConfiguracion()       → Lee config de Firestore y llena los campos
 *   guardarConfigGeneral()      → Guarda nombre, dirección, RNC, teléfono
 *   guardarConfigITBIS()        → Guarda configuración de ITBIS y NCF
 *   guardarConfigWhatsApp()     → Guarda número de WhatsApp para facturas
 *   guardarConfigImpresora()    → Guarda IP/puerto de impresora térmica
 *   agregarEmpleado()           → Crea empleado y lo invita por email
 *   eliminarEmpleado(uid)       → Elimina empleado del negocio
 *   renderEmpleados()           → Renderiza la lista de empleados
 *
 * ESCUCHA EL EVENTO:
 *   'micolmapp:negocio-listo'  → Carga configuración inicial
 *   'micolmapp:page-change'    → Re-carga al navegar a "config"
 * ════════════════════════════════════════════════════════════════════
 */

import {
  doc, collection, getDoc, getDocs,
  setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { AppState }                     from './app-state.js';
import { fmt, toast, abrirModal, cerrarModal,
         initPaisSelects, autoDetectPaisTel,
         updateTelPreview, _startClock }   from './utils.js';
import { _fsOp, subirImagenBase64, comprimirImagen } from './offline.js';

const getDb   = () => window._db;
const getAuth = () => window._auth;

// ─── INICIALIZACIÓN ──────────────────────────────────────────────────────────

window.addEventListener('micolmapp:negocio-listo', async () => {
  await cargarConfiguracion();
  _suscribirEmpleados();
  _startClock();
  _inicializarNavbar();
});

window.addEventListener('micolmapp:page-change', ({ detail }) => {
  if (detail.page === 'config') cargarConfiguracion();
});

// ─── NAVBAR: NOMBRE DEL NEGOCIO Y BOTONES ────────────────────────────────────

function _inicializarNavbar() {
  // Nombre del negocio en el navbar
  const navNombre = document.getElementById('nav-negocio-nombre');
  if (navNombre && AppState.negocioData?.nombre) {
    navNombre.textContent = AppState.negocioData.nombre;
  }

  // Email del usuario en el menú
  const emailTxt = document.getElementById('nav-email-txt');
  if (emailTxt && AppState.currentUser?.email) {
    emailTxt.textContent = AppState.currentUser.email;
  }

  // Botones de navegación desktop
  const navButtons = document.getElementById('nav-buttons');
  if (navButtons) {
    navButtons.innerHTML = [
      { page: 'pos',          icon: 'fa-cash-register', label: 'POS' },
      { page: 'caja',         icon: 'fa-box-open',      label: 'Caja' },
      { page: 'inventario',   icon: 'fa-boxes',         label: 'Inventario' },
      { page: 'estadisticas', icon: 'fa-chart-bar',     label: 'Ventas' },
      { page: 'config',       icon: 'fa-cog',           label: 'Config' },
    ].map(b => `
      <button class="nav-btn" data-page="${b.page}" onclick="showPage('${b.page}')">
        <i class="fas ${b.icon}"></i>
        <span>${b.label}</span>
      </button>`).join('');
  }

  // Nav móvil inferior
  const mobileNav = document.getElementById('mobile-bottom-nav');
  if (mobileNav) {
    mobileNav.innerHTML = [
      { page: 'pos',          icon: 'fa-cash-register', label: 'POS'       },
      { page: 'caja',         icon: 'fa-box-open',      label: 'Caja'      },
      { page: 'inventario',   icon: 'fa-boxes',         label: 'Inventario'},
      { page: 'estadisticas', icon: 'fa-chart-bar',     label: 'Ventas'    },
      { page: 'config',       icon: 'fa-cog',           label: 'Config'    },
    ].map(b => `
      <button class="mob-nav-btn" data-page="${b.page}" onclick="showPage('${b.page}')">
        <i class="fas ${b.icon}"></i>
        <span>${b.label}</span>
      </button>`).join('');
  }

  // Ir a la página POS por defecto
  if (window.showPage) window.showPage('pos');
  if (window.showScreen) window.showScreen('app');
}

// ─── CARGAR CONFIGURACIÓN ────────────────────────────────────────────────────

export async function cargarConfiguracion() {
  const db  = getDb();
  const neg = AppState.negocioData;

  // Datos del negocio
  _setVal('cfg-nombre',    neg?.nombre    || '');
  _setVal('cfg-rnc',       neg?.rnc       || '');
  _setVal('cfg-direccion', neg?.direccion || '');
  _setVal('cfg-telefono',  neg?.telefono  || '');
  _setVal('cfg-email-neg', neg?.email     || AppState.currentUser?.email || '');

  // Logo del negocio
  const logoEl = document.getElementById('cfg-logo-preview');
  if (logoEl) {
    logoEl.src          = neg?.logo || '';
    logoEl.style.display = neg?.logo ? 'block' : 'none';
  }

  // Configuración general (ITBIS, NCF, WhatsApp, etc.)
  try {
    const cfgSnap = await getDoc(doc(db, 'negocios', AppState.negocioId, 'configuraciones', 'general'));
    if (cfgSnap.exists()) {
      const cfg = cfgSnap.data();

      // Actualizar estado global
      AppState.config = {
        itbisPct:     cfg.itbisPct     ?? 18,
        itbisCliente: cfg.itbisCliente ?? false,
        ncfPrefijo:   cfg.ncfPrefijo   ?? 'B01',
        ncfSeq:       cfg.ncfSeq       ?? 1,
      };

      _setVal('cfg-itbis-pct',  cfg.itbisPct ?? 18);
      _setVal('cfg-ncf-prefijo', cfg.ncfPrefijo || 'B01');
      _setVal('cfg-ncf-seq',    cfg.ncfSeq    ?? 1);
      _setVal('cfg-ws-numero',  cfg.wsNumero  || '');
      _setVal('cfg-impresora-ip',   cfg.impresoraIp   || '');
      _setVal('cfg-impresora-port', cfg.impresoraPort || '9100');

      const chkItbis = document.getElementById('cfg-itbis-cliente');
      if (chkItbis) chkItbis.checked = cfg.itbisCliente === true;

      const chkModoPrueba = document.getElementById('cfg-modo-prueba');
      if (chkModoPrueba) {
        try {
          const mp = localStorage.getItem(`modo_prueba_${AppState.negocioId}`) === '1';
          chkModoPrueba.checked = mp;
          AppState.modoPrueba   = mp;
          if (window._aplicarModoPrueba) window._aplicarModoPrueba();
        } catch(e) {}
      }

      // WhatsApp país
      initPaisSelects();
      if (cfg.wsNumero) autoDetectPaisTel(cfg.wsNumero, 'cfg-ws-pais', 'cfg-ws-preview');

      // Teléfono del negocio
      if (cfg.telPais) {
        const selTel = document.getElementById('cfg-tel-pais');
        if (selTel) selTel.value = cfg.telPais;
      }
    }
  } catch(e) {
    console.warn('[config] Error cargando configuración:', e);
  }
}
window.cargarConfiguracion = cargarConfiguracion;

// ─── GUARDAR: DATOS DEL NEGOCIO ───────────────────────────────────────────────

export async function guardarConfigGeneral() {
  const db   = getDb();
  const btn  = document.getElementById('btn-guardar-cfg-general');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'; }

  const nombre    = document.getElementById('cfg-nombre')?.value.trim()    || '';
  const rnc       = document.getElementById('cfg-rnc')?.value.trim()       || '';
  const direccion = document.getElementById('cfg-direccion')?.value.trim() || '';
  const telefono  = document.getElementById('cfg-telefono')?.value.trim()  || '';

  try {
    // Subir logo si se seleccionó uno nuevo
    let logo = AppState.negocioData?.logo || '';
    const logoInput = document.getElementById('cfg-logo-input');
    if (logoInput?.files[0]) {
      const dataUrl   = await comprimirImagen(logoInput.files[0], 300, 0.85);
      const storagePath = `negocios/${AppState.negocioId}/logo`;
      logo = await subirImagenBase64(dataUrl, storagePath,
        `negocios/${AppState.negocioId}`, 'logo');
    }

    await _fsOp(() => updateDoc(doc(db, 'negocios', AppState.negocioId), {
      nombre, rnc, direccion, telefono, logo
    }));

    // Actualizar estado local
    AppState.negocioData = { ...AppState.negocioData, nombre, rnc, direccion, telefono, logo };
    try { localStorage.setItem(`negocio_data_${AppState.negocioId}`, JSON.stringify(AppState.negocioData)); } catch(e) {}

    // Actualizar navbar
    const navNombre = document.getElementById('nav-negocio-nombre');
    if (navNombre) navNombre.textContent = nombre;

    toast('✅ Configuración guardada', 'success');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Guardar'; }
  }
}
window.guardarConfigGeneral = guardarConfigGeneral;

// ─── GUARDAR: ITBIS Y NCF ────────────────────────────────────────────────────

export async function guardarConfigITBIS() {
  const db         = getDb();
  const itbisPct   = parseFloat(document.getElementById('cfg-itbis-pct')?.value)  || 18;
  const itbisCliente = document.getElementById('cfg-itbis-cliente')?.checked === true;
  const ncfPrefijo = document.getElementById('cfg-ncf-prefijo')?.value.trim()     || 'B01';
  const ncfSeq     = parseInt(document.getElementById('cfg-ncf-seq')?.value)       || 1;

  try {
    await _fsOp(() => updateDoc(
      doc(db, 'negocios', AppState.negocioId, 'configuraciones', 'general'),
      { itbisPct, itbisCliente, ncfPrefijo, ncfSeq }
    ));
    AppState.config = { ...AppState.config, itbisPct, itbisCliente, ncfPrefijo, ncfSeq };
    toast('✅ Configuración de ITBIS guardada', 'success');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}
window.guardarConfigITBIS = guardarConfigITBIS;

// ─── GUARDAR: WHATSAPP ────────────────────────────────────────────────────────

export async function guardarConfigWhatsApp() {
  const db       = getDb();
  const wsNumero = document.getElementById('cfg-ws-numero')?.value.trim() || '';
  const wsPais   = document.getElementById('cfg-ws-pais')?.value          || 'DO';

  try {
    await _fsOp(() => updateDoc(
      doc(db, 'negocios', AppState.negocioId, 'configuraciones', 'general'),
      { wsNumero, wsPais }
    ));
    toast('✅ WhatsApp configurado', 'success');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}
window.guardarConfigWhatsApp = guardarConfigWhatsApp;

// ─── GUARDAR: IMPRESORA TÉRMICA ───────────────────────────────────────────────

export async function guardarConfigImpresora() {
  const db       = getDb();
  const ip       = document.getElementById('cfg-impresora-ip')?.value.trim()   || '';
  const port     = document.getElementById('cfg-impresora-port')?.value.trim() || '9100';

  try {
    await _fsOp(() => updateDoc(
      doc(db, 'negocios', AppState.negocioId, 'configuraciones', 'general'),
      { impresoraIp: ip, impresoraPort: port }
    ));
    toast('✅ Configuración de impresora guardada', 'success');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}
window.guardarConfigImpresora = guardarConfigImpresora;

// ─── MODO PRUEBA ─────────────────────────────────────────────────────────────

window.onCfgModoPruebaChange = (checked) => {
  if (window.toggleModoPrueba) window.toggleModoPrueba(checked);
};

// ─── EMPLEADOS ────────────────────────────────────────────────────────────────

let _unsubEmpleados = null;

function _suscribirEmpleados() {
  if (_unsubEmpleados) _unsubEmpleados();
  const db = getDb();
  _unsubEmpleados = onSnapshot(
    collection(db, 'negocios', AppState.negocioId, 'empleados'),
    (snap) => {
      AppState.empleadosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderEmpleados();
    }
  );
}

export function renderEmpleados() {
  const lista = document.getElementById('empleados-lista');
  if (!lista) return;

  const empleados = AppState.empleadosCache;

  if (!empleados.length) {
    lista.innerHTML = `<div style="text-align:center;padding:20px;color:#aab4c8;">
      <i class="fas fa-users-slash" style="font-size:2rem;display:block;margin-bottom:8px;"></i>
      No hay empleados agregados aún.
    </div>`;
    return;
  }

  const rolLabel = { admin: '👑 Admin', empleado: '👤 Empleado', cajero: '💳 Cajero', gerente: '📊 Gerente' };

  lista.innerHTML = empleados.map(emp => `
    <div class="empleado-row">
      <div class="emp-avatar">${(emp.nombre || emp.email || '?')[0].toUpperCase()}</div>
      <div class="emp-info">
        <div class="emp-nombre">${emp.nombre || '—'}</div>
        <div class="emp-email">${emp.email || '—'}</div>
        <span class="emp-rol-badge">${rolLabel[emp.rol] || emp.rol || 'empleado'}</span>
      </div>
      <div class="emp-acciones">
        <button class="btn-sm rojo" onclick="eliminarEmpleado('${emp.id}')">
          <i class="fas fa-user-minus"></i>
        </button>
      </div>
    </div>`).join('');
}
window.renderEmpleados = renderEmpleados;

window.abrirModalAgregarEmpleado = () => abrirModal('modal-agregar-empleado');

export async function agregarEmpleado() {
  const nombre  = document.getElementById('emp-nombre')?.value.trim();
  const email   = document.getElementById('emp-email')?.value.trim();
  const pass    = document.getElementById('emp-pass')?.value;
  const rol     = document.getElementById('emp-rol')?.value || 'empleado';
  const msgEl   = document.getElementById('emp-msg');

  const showMsg = (msg, type) => {
    if (!msgEl) return;
    msgEl.textContent = msg;
    msgEl.className   = `auth-msg ${type}`;
    msgEl.style.display = 'block';
  };

  if (!nombre || !email || !pass) { showMsg('Todos los campos son obligatorios.', 'error'); return; }
  if (pass.length < 6)            { showMsg('La contraseña debe tener mínimo 6 caracteres.', 'error'); return; }

  const db   = getDb();
  const auth = getAuth();
  const btn  = document.getElementById('btn-guardar-empleado');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creando...'; }

  try {
    showMsg('Creando usuario...', 'info');

    // Crear cuenta de Firebase Auth para el empleado
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid  = cred.user.uid;

    // Guardar en la subcolección de empleados del negocio
    await _fsOp(() => setDoc(
      doc(db, 'negocios', AppState.negocioId, 'empleados', uid),
      { uid, nombre, email, rol, creadoEn: serverTimestamp() }
    ));

    // Enviar email de bienvenida/reset (opcional)
    try { await sendPasswordResetEmail(auth, email); } catch(e) {}

    cerrarModal('modal-agregar-empleado');
    _setVal('emp-nombre', ''); _setVal('emp-email', ''); _setVal('emp-pass', '');
    toast(`✅ Empleado ${nombre} agregado`, 'success');
  } catch(e) {
    const msgs = {
      'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
      'auth/invalid-email':        'Correo inválido.',
      'auth/weak-password':        'Contraseña muy débil.'
    };
    showMsg(msgs[e.code] || `Error: ${e.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus"></i> Agregar Empleado'; }
  }
}
window.agregarEmpleado = agregarEmpleado;

export async function eliminarEmpleado(uid) {
  if (!confirm('¿Eliminar este empleado del negocio?')) return;
  const db = getDb();
  try {
    await _fsOp(() => deleteDoc(doc(db, 'negocios', AppState.negocioId, 'empleados', uid)));
    toast('Empleado eliminado', 'info');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}
window.eliminarEmpleado = eliminarEmpleado;

// ─── RESET / PELIGRO ─────────────────────────────────────────────────────────

window.abrirModalPeligro = () => abrirModal('modal-zona-peligro');

window.resetNCFSequence = async () => {
  if (!confirm('¿Resetear la secuencia NCF a 1? Esta acción es irreversible.')) return;
  const db = getDb();
  try {
    await _fsOp(() => updateDoc(
      doc(db, 'negocios', AppState.negocioId, 'configuraciones', 'general'),
      { ncfSeq: 1 }
    ));
    AppState.config.ncfSeq = 1;
    _setVal('cfg-ncf-seq', 1);
    toast('✅ Secuencia NCF reiniciada a 1', 'success');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
};

// ─── HELPER ──────────────────────────────────────────────────────────────────

function _setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val ?? '';
}

console.log('[config] Módulo de configuración cargado ✅');
