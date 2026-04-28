/**
 * ════════════════════════════════════════════════════════════════════
 * MÓDULO 1: auth.js
 * RESPONSABILIDAD: Autenticación de usuarios y selección/registro de negocios.
 *
 * BENEFICIO DE SEPARACIÓN:
 *   Puedes agregar Google Login, biometría o cambiar a Supabase Auth
 *   sin tocar ningún otro módulo (POS, Inventario, Caja, etc.).
 *
 * FUNCIONES EXPUESTAS EN window:
 *   login()                    → Iniciar sesión con email/password
 *   registrar()                → Registrar nuevo negocio + usuario admin
 *   authTab(tab)               → Cambiar pestaña login/registro en pantalla auth
 *   mostrarSelectorNegocios()  → Renderiza lista de negocios del usuario
 *   entrarAlNegocio(negId)     → Carga datos y entra a un negocio
 *   cambiarNegocio()           → Vuelve al selector de negocios
 *   logoutTotal()              → Cierra sesión completamente
 *   abrirAgregarNegocio()      → Abre modal para agregar negocio adicional
 *   cerrarAgregarNegocio()     → Cierra dicho modal
 *   registrarNuevoNegocio()    → Crea nuevo negocio desde el modal selector
 *
 * EVENTOS EMITIDOS:
 *   'micolmapp:negocio-listo'  → Se dispara cuando el negocio está cargado
 *                                 y el app está listo para usarse.
 *                                 detail: { negocioId, negocioData, userRole }
 * ════════════════════════════════════════════════════════════════════
 */

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  collection, collectionGroup, doc,
  getDoc, getDocs, setDoc, updateDoc,
  query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { AppState, limpiarSesionNegocio } from './app-state.js';
import { showScreen, toast }               from './utils.js';

// Referencia a Firebase (cargado por firebase-init.js)
const getAuth = () => window._auth;
const getDb   = () => window._db;

// ─── OBSERVER DE AUTENTICACIÓN ───────────────────────────────────────────────
// Se ejecuta al cargar la página y cada vez que cambia el estado de auth.

document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(getAuth(), async (user) => {
    if (user) {
      AppState.currentUser = user;
      // Intentar restaurar el negocio activo de la sesión anterior
      try {
        const negActivo = localStorage.getItem(`negocio_activo_${user.uid}`);
        if (negActivo) {
          await entrarAlNegocio(negActivo);
          return;
        }
      } catch(e) {}
      await mostrarSelectorNegocios(user);
    } else {
      AppState.currentUser = null;
      showScreen('auth');
    }
  });
});

// ─── LOGIN ───────────────────────────────────────────────────────────────────

export async function login() {
  const email = document.getElementById('login-email')?.value.trim();
  const pass  = document.getElementById('login-pass')?.value;
  if (!email || !pass) { showAuthMsg('Por favor completa todos los campos.', 'error'); return; }

  try {
    showAuthMsg('Iniciando sesión...', 'info');
    await signInWithEmailAndPassword(getAuth(), email, pass);
    // onAuthStateChanged se encarga del resto
  } catch(e) {
    const msgs = {
      'auth/user-not-found':  'Usuario no encontrado.',
      'auth/wrong-password':  'Contraseña incorrecta.',
      'auth/invalid-email':   'Correo inválido.',
      'auth/too-many-requests': 'Demasiados intentos. Espera un momento.'
    };
    showAuthMsg(msgs[e.code] || `Error: ${e.message}`, 'error');
  }
}
window.login = login;

// ─── REGISTRO ────────────────────────────────────────────────────────────────

export async function registrar() {
  const nombre    = document.getElementById('reg-nombre')?.value.trim();
  const tipo      = document.getElementById('reg-tipo')?.value || 'colmado';
  const rnc       = document.getElementById('reg-rnc')?.value.trim();
  const direccion = document.getElementById('reg-direccion')?.value.trim();
  const telefono  = document.getElementById('reg-telefono')?.value.trim();
  const email     = document.getElementById('reg-email')?.value.trim();
  const pass      = document.getElementById('reg-pass')?.value;

  if (!nombre || !email || !pass) {
    showAuthMsg('Nombre del negocio, correo y contraseña son obligatorios.', 'error');
    return;
  }
  if (pass.length < 6) {
    showAuthMsg('La contraseña debe tener al menos 6 caracteres.', 'error');
    return;
  }

  try {
    showAuthMsg('Registrando...', 'info');
    const cred = await createUserWithEmailAndPassword(getAuth(), email, pass);
    const uid  = cred.user.uid;
    const db   = getDb();

    // Crear documento del negocio
    await setDoc(doc(db, 'negocios', uid), {
      nombre, tipo, rnc, direccion, telefono,
      propietarioUid: uid,
      email,
      creadoEn: serverTimestamp()
    });

    // Crear configuración inicial
    await setDoc(doc(db, 'negocios', uid, 'configuraciones', 'general'), {
      itbisPct: 18, itbisCliente: false, ncfPrefijo: 'B01', ncfSeq: 1
    });

    // Registrar negocio en documento de usuario
    await setDoc(doc(db, 'usuarios', uid), {
      email,
      negociosAdmin: [uid],
      creadoEn: serverTimestamp()
    });

    showAuthMsg('✅ Negocio registrado con éxito. Entrando...', 'success');
    // onAuthStateChanged se encargará de entrar automáticamente
  } catch(e) {
    const msgs = {
      'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
      'auth/invalid-email':        'Correo inválido.',
      'auth/weak-password':        'La contraseña es muy débil.'
    };
    showAuthMsg(msgs[e.code] || `Error: ${e.message}`, 'error');
  }
}
window.registrar = registrar;

// ─── CAMBIO DE PESTAÑA EN PANTALLA AUTH ──────────────────────────────────────

export function authTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(btn => btn.classList.remove('active'));
  const activeBtn = [...document.querySelectorAll('.auth-tab')].find(b => b.textContent.toLowerCase().includes(tab));
  if (activeBtn) activeBtn.classList.add('active');

  const loginEl    = document.getElementById('auth-login');
  const registroEl = document.getElementById('auth-registro');
  if (loginEl)    loginEl.style.display    = tab === 'login'   ? '' : 'none';
  if (registroEl) registroEl.style.display = tab === 'registro' ? '' : 'none';
  showAuthMsg('', '');
}
window.authTab = authTab;

// ─── SELECTOR DE NEGOCIOS ─────────────────────────────────────────────────────

export async function mostrarSelectorNegocios(user) {
  showScreen('selector');
  const lista = document.getElementById('ns-lista');
  if (!lista) return;

  lista.innerHTML = `<div style="text-align:center;padding:20px;color:#aab4c8;">
    <i class="fas fa-spinner fa-spin"></i> Cargando negocios...</div>`;

  const bienvenida = document.getElementById('ns-bienvenida');
  if (bienvenida) bienvenida.textContent = `Bienvenido, ${user.email}`;

  try {
    const negociosIds = await _obtenerNegociosDelUsuario(user);

    if (!negociosIds.length) {
      lista.innerHTML = !navigator.onLine
        ? `<div style="text-align:center;padding:20px;color:#e67700;">
             <i class="fas fa-wifi-slash" style="font-size:2rem;display:block;margin-bottom:8px;"></i>
             <strong>Sin conexión</strong><br>
             <span style="font-size:13px;">Inicia sesión con internet al menos una vez para usar el modo offline.</span>
           </div>`
        : `<div style="text-align:center;padding:20px;color:#aab4c8;">
             <i class="fas fa-store-slash" style="font-size:2rem;display:block;margin-bottom:8px;"></i>
             No tienes ningún negocio registrado. Agrega tu primer negocio.
           </div>`;
      return;
    }

    const db      = getDb();
    const negocios = await Promise.all(negociosIds.map(async id => {
      try {
        const snap = await getDoc(doc(db, 'negocios', id));
        if (snap.exists()) {
          try { localStorage.setItem(`negocio_data_${id}`, JSON.stringify(snap.data())); } catch(e) {}
          return { id, ...snap.data() };
        }
        const cached = localStorage.getItem(`negocio_data_${id}`);
        return cached ? { id, ...JSON.parse(cached) } : null;
      } catch(e) {
        const cached = localStorage.getItem(`negocio_data_${id}`);
        return cached ? { id, ...JSON.parse(cached) } : null;
      }
    }));

    const validos = negocios.filter(Boolean);
    const offlineBanner = !navigator.onLine
      ? `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#664d03;">
           <i class="fas fa-wifi-slash"></i> <strong>Modo offline</strong> — Los cambios se sincronizarán al volver la conexión
         </div>`
      : '';

    lista.innerHTML = offlineBanner + validos.map(neg => `
      <div onclick="entrarAlNegocio('${neg.id}')"
        style="display:flex;align-items:center;gap:14px;background:#f8f9ff;border:2px solid #e2e8f0;
               border-radius:14px;padding:16px 18px;cursor:pointer;transition:all 0.18s;"
        onmouseover="this.style.borderColor='#1971c2';this.style.background='#eff6ff'"
        onmouseout="this.style.borderColor='#e2e8f0';this.style.background='#f8f9ff'">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,#1971c2,#1864ab);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">🏪</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:15px;color:#1a2135;">${neg.nombre || 'Sin nombre'}</div>
          <div style="font-size:12px;color:#718096;margin-top:2px;">${neg.direccion || ''}</div>
        </div>
        <i class="fas fa-chevron-right" style="color:#a0aec0;font-size:14px;"></i>
      </div>`).join('');

  } catch(e) {
    lista.innerHTML = `<div style="color:#e03131;text-align:center;padding:16px;">
      Error al cargar negocios: ${e.message}</div>`;
  }
}
window.mostrarSelectorNegocios = mostrarSelectorNegocios;

// ─── ENTRAR AL NEGOCIO ───────────────────────────────────────────────────────

export async function entrarAlNegocio(negId) {
  showScreen('loading');
  const db   = getDb();
  const auth = getAuth();
  const user = AppState.currentUser || auth.currentUser;
  if (!user) { showScreen('auth'); return; }

  try {
    const negSnap = await getDoc(doc(db, 'negocios', negId));

    if (!negSnap.exists()) {
      // Intentar desde caché offline
      const cached = localStorage.getItem(`negocio_data_${negId}`);
      if (cached) {
        AppState.negocioId   = negId;
        AppState.negocioData = JSON.parse(cached);
        AppState.userRole    = localStorage.getItem(`negocio_role_${negId}_${user.uid}`) || 'admin';
        localStorage.setItem(`negocio_activo_${user.uid}`, negId);
        _emitirNegocioListo();
        if (!navigator.onLine) toast('📱 Modo offline — datos del caché local', 'warning', 3000);
        return;
      }
      toast('Negocio no encontrado', 'error');
      showScreen('selector');
      return;
    }

    AppState.negocioId   = negId;
    AppState.negocioData = negSnap.data();
    try { localStorage.setItem(`negocio_data_${negId}`, JSON.stringify(AppState.negocioData)); } catch(e) {}

    // Determinar rol del usuario
    const empSnap = await getDoc(doc(db, 'negocios', negId, 'empleados', user.uid));
    if (empSnap.exists()) {
      AppState.userRole = empSnap.data().rol;
    } else {
      AppState.userRole = AppState.negocioData.propietarioUid === user.uid ? 'admin' : 'empleado';
    }
    try { localStorage.setItem(`negocio_role_${negId}_${user.uid}`, AppState.userRole); } catch(e) {}

    localStorage.setItem(`negocio_activo_${user.uid}`, negId);
    localStorage.setItem(`negocio_${user.uid}`, negId);

    _emitirNegocioListo();
    if (!navigator.onLine) toast('📱 Modo offline — los cambios se sincronizarán al volver la conexión', 'warning', 4000);

  } catch(e) {
    // Fallback offline
    if (!navigator.onLine || e.code === 'unavailable') {
      const cached = localStorage.getItem(`negocio_data_${negId}`);
      if (cached) {
        AppState.negocioId   = negId;
        AppState.negocioData = JSON.parse(cached);
        AppState.userRole    = localStorage.getItem(`negocio_role_${negId}_${user?.uid}`) || 'admin';
        localStorage.setItem(`negocio_activo_${user?.uid}`, negId);
        _emitirNegocioListo();
        toast('📱 Modo offline — funcionando con datos locales', 'warning', 4000);
        return;
      }
    }
    toast(`Error al entrar al negocio: ${e.message}`, 'error');
    showScreen('selector');
  }
}
window.entrarAlNegocio = entrarAlNegocio;

// ─── CAMBIAR NEGOCIO ─────────────────────────────────────────────────────────

export function cambiarNegocio() {
  limpiarSesionNegocio();
  if (AppState.currentUser) mostrarSelectorNegocios(AppState.currentUser);
}
window.cambiarNegocio = cambiarNegocio;

// ─── LOGOUT TOTAL ────────────────────────────────────────────────────────────

export async function logoutTotal() {
  limpiarSesionNegocio();
  AppState.currentUser = null;
  await signOut(getAuth());
  showScreen('auth');
}
window.logoutTotal = logoutTotal;
window.logout      = logoutTotal; // alias legacy

// ─── MODAL: AGREGAR NEGOCIO ADICIONAL ────────────────────────────────────────

export function abrirAgregarNegocio() {
  const modal = document.getElementById('ns-modal-nuevo');
  if (modal) modal.style.display = 'flex';
}

export function cerrarAgregarNegocio() {
  const modal = document.getElementById('ns-modal-nuevo');
  if (modal) modal.style.display = 'none';
}

export async function registrarNuevoNegocio() {
  const nombre    = document.getElementById('ns-reg-nombre')?.value.trim();
  const tipo      = document.getElementById('ns-reg-tipo')?.value || 'colmado';
  const rnc       = document.getElementById('ns-reg-rnc')?.value.trim();
  const direccion = document.getElementById('ns-reg-direccion')?.value.trim();
  const telefono  = document.getElementById('ns-reg-telefono')?.value.trim();
  const msgEl     = document.getElementById('ns-reg-msg');

  if (!nombre) {
    if (msgEl) { msgEl.textContent = 'El nombre del negocio es obligatorio.'; msgEl.className = 'ns-reg-msg error'; }
    return;
  }

  const db   = getDb();
  const user = AppState.currentUser || getAuth().currentUser;
  if (!user) return;

  try {
    if (msgEl) { msgEl.textContent = 'Creando negocio...'; msgEl.className = 'ns-reg-msg info'; }
    const negRef = doc(collection(db, 'negocios'));
    await setDoc(negRef, {
      nombre, tipo, rnc, direccion, telefono,
      propietarioUid: user.uid,
      email: user.email,
      creadoEn: serverTimestamp()
    });
    await setDoc(doc(db, 'negocios', negRef.id, 'configuraciones', 'general'), {
      itbisPct: 18, itbisCliente: false, ncfPrefijo: 'B01', ncfSeq: 1
    });

    // Agregar a la lista de negocios del usuario
    const userRef  = doc(db, 'usuarios', user.uid);
    const userSnap = await getDoc(userRef);
    const negActuales = userSnap.exists() ? (userSnap.data().negociosAdmin || []) : [];
    await setDoc(userRef, { negociosAdmin: [...negActuales, negRef.id] }, { merge: true });

    cerrarAgregarNegocio();
    toast('✅ Negocio creado exitosamente', 'success');
    await mostrarSelectorNegocios(user);
  } catch(e) {
    if (msgEl) { msgEl.textContent = `Error: ${e.message}`; msgEl.className = 'ns-reg-msg error'; }
  }
}

window.abrirAgregarNegocio    = abrirAgregarNegocio;
window.cerrarAgregarNegocio   = cerrarAgregarNegocio;
window.registrarNuevoNegocio  = registrarNuevoNegocio;

// ─── HELPERS PRIVADOS ────────────────────────────────────────────────────────

async function _obtenerNegociosDelUsuario(user) {
  const db  = getDb();
  const ids = new Set();

  try {
    const userSnap = await getDoc(doc(db, 'usuarios', user.uid));
    if (userSnap.exists()) (userSnap.data().negociosAdmin || []).forEach(id => ids.add(id));
  } catch(e) {}

  try {
    const legacySnap = await getDoc(doc(db, 'negocios', user.uid));
    if (legacySnap.exists()) ids.add(user.uid);
  } catch(e) {}

  try {
    const empQuery = query(collectionGroup(db, 'empleados'), where('uid', '==', user.uid));
    const empSnap  = await getDocs(empQuery);
    empSnap.forEach(d => { const negId = d.ref.parent.parent.id; if (negId) ids.add(negId); });
  } catch(e) {}

  try {
    const cachedNeg = localStorage.getItem(`negocio_${user.uid}`);
    if (cachedNeg) ids.add(cachedNeg);
  } catch(e) {}

  return [...ids];
}

function _emitirNegocioListo() {
  // ── FIX: mostrar el app antes de notificar a los módulos ──────────────────
  showScreen('app');

  // Notificar a los demás módulos (pos.js, inventario.js, caja.js, etc.)
  window.dispatchEvent(new CustomEvent('micolmapp:negocio-listo', {
    detail: {
      negocioId:   AppState.negocioId,
      negocioData: AppState.negocioData,
      userRole:    AppState.userRole
    }
  }));
}

function showAuthMsg(msg, type) {
  const el = document.getElementById('auth-msg');
  if (!el) return;
  el.className  = `auth-msg ${type}`;
  el.textContent = msg;
}

console.log('[auth] Módulo de autenticación cargado ✅');
