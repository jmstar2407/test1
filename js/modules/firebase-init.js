/**
 * ════════════════════════════════════════════════════════════════════
 * MÓDULO: firebase-init.js
 * RESPONSABILIDAD: Inicializar Firebase (App, Auth, Firestore, Storage)
 *
 * EXPONE (window globals para compatibilidad con módulos no-ES):
 *   window._fbApp    → instancia de la Firebase App
 *   window._auth     → instancia de Firebase Auth
 *   window._db       → instancia de Firestore (con persistencia offline)
 *   window._storage  → instancia de Firebase Storage
 *
 * PARA CAMBIAR DE PROYECTO FIREBASE: solo modifica firebaseConfig aquí.
 * ════════════════════════════════════════════════════════════════════
 */

import { initializeApp }        from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage }           from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// ─── Configuración del proyecto Firebase ────────────────────────────────────
// ⚠️  CAMBIA ESTOS VALORES si migras a otro proyecto de Firebase
const firebaseConfig = {
  apiKey:            "AIzaSyB7cX3O8Nkhg5XYsuH1UIn0ZDyxoxLzTB4",
  authDomain:        "colmapp-4aaa4.firebaseapp.com",
  projectId:         "colmapp-4aaa4",
  storageBucket:     "colmapp-4aaa4.firebasestorage.app",
  messagingSenderId: "767529335752",
  appId:             "1:767529335752:web:5967b10a0e0da050f91efd",
  measurementId:     "G-22YKHGWTMH"
};

// ─── Inicialización ──────────────────────────────────────────────────────────
const _fbApp = initializeApp(firebaseConfig);

// Auth con persistencia local (mantiene sesión entre recargas)
const _auth = getAuth(_fbApp);
setPersistence(_auth, browserLocalPersistence).catch(() => {});

// Firestore con caché IndexedDB multi-pestaña
// onSnapshot sirve datos offline; escrituras se encolan automáticamente
const _db = initializeFirestore(_fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

const _storage = getStorage(_fbApp);

// ─── Exponer globalmente (necesario porque el script principal es type="module") ──
// Otros módulos acceden via window._db, window._auth, etc.
Object.defineProperty(window, '_fbApp',    { get: () => _fbApp,    configurable: true });
Object.defineProperty(window, '_auth',     { get: () => _auth,     configurable: true });
Object.defineProperty(window, '_db',       { get: () => _db,       configurable: true });
Object.defineProperty(window, '_storage',  { get: () => _storage,  configurable: true });

console.log('[firebase-init] Firebase inicializado ✅');
export { _fbApp, _auth, _db, _storage };
