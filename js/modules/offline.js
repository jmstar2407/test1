/**
 * ════════════════════════════════════════════════════════════════════
 * MÓDULO: offline.js
 * RESPONSABILIDAD: Soporte offline completo — cola de imágenes pendientes,
 *                  indicadores visuales y sincronización automática.
 *
 * FUNCIONES EXPORTADAS / EXPUESTAS EN window:
 *   _fsOp(fn, timeoutMs)             → Ejecuta operación Firestore con soporte offline
 *   _addToImgQueue(entry)            → Agrega imagen a la cola offline
 *   _removeFromImgQueue(path)        → Elimina imagen de la cola offline
 *   _actualizarFirestoreEnCola()     → Actualiza firestorePath en la cola
 *   _actualizarBadgePendientes()     → Actualiza el badge visual del estado offline
 *   subirImagenBase64(url, path, ...) → Sube imagen (o encola si offline)
 *   comprimirImagen(file, maxH, q)   → Comprime imagen antes de subir
 * ════════════════════════════════════════════════════════════════════
 */

import { ref, uploadString, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { doc, updateDoc }
  from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { toast } from './utils.js';

const getDb      = () => window._db;
const getStorage = () => window._storage;

// ─── COLA DE IMÁGENES OFFLINE (LocalStorage) ─────────────────────────────────

const OFFLINE_IMG_QUEUE_KEY = 'offline_img_queue_v1';

function _getImgQueue() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_IMG_QUEUE_KEY) || '[]'); } catch { return []; }
}
function _saveImgQueue(queue) {
  try { localStorage.setItem(OFFLINE_IMG_QUEUE_KEY, JSON.stringify(queue)); } catch(e) {}
}

export function _addToImgQueue(entry) {
  const queue = _getImgQueue();
  const idx   = queue.findIndex(e => e.path === entry.path);
  if (idx >= 0) queue[idx] = entry; else queue.push(entry);
  _saveImgQueue(queue);
  _actualizarBadgePendientes();
}

export function _removeFromImgQueue(path) {
  _saveImgQueue(_getImgQueue().filter(e => e.path !== path));
  _actualizarBadgePendientes();
}

export function _actualizarFirestoreEnCola(dataUrlOrPath, firestorePath, field) {
  const queue = _getImgQueue();
  const idx   = queue.findIndex(e => e.dataUrl === dataUrlOrPath || e.path === dataUrlOrPath);
  if (idx >= 0) {
    queue[idx].firestorePath = firestorePath;
    queue[idx].field         = field || 'imagen';
    _saveImgQueue(queue);
  }
}

// ─── BADGE VISUAL OFFLINE ────────────────────────────────────────────────────

export function _actualizarBadgePendientes() {
  const queue  = _getImgQueue();
  const badge  = document.getElementById('offline-badge');
  if (!badge) return;

  if (!navigator.onLine) {
    badge.style.display  = 'flex';
    badge.style.background = '#e03131';
    badge.innerHTML = '<i class="fas fa-wifi-slash"></i> SIN CONEXIÓN';
  } else if (queue.length > 0) {
    badge.style.display  = 'flex';
    badge.style.background = '#e67700';
    badge.innerHTML = `<i class="fas fa-sync fa-spin"></i> Sincronizando ${queue.length} imagen${queue.length > 1 ? 'es' : ''}...`;
  } else {
    badge.style.display  = 'none';
    badge.style.background = '#e03131';
  }
}

// ─── SINCRONIZACIÓN AL VOLVER LA CONEXIÓN ────────────────────────────────────

async function _sincronizarImagenesPendientes() {
  const queue = _getImgQueue();
  if (!queue.length) return;

  _actualizarBadgePendientes();

  for (const entry of [...queue]) {
    try {
      const imgRef     = ref(getStorage(), entry.path);
      await uploadString(imgRef, entry.dataUrl, 'data_url');
      const downloadURL = await getDownloadURL(imgRef);

      if (entry.firestorePath && entry.field) {
        const parts = entry.firestorePath.split('/');
        let docRef;
        if (parts.length === 2) docRef = doc(getDb(), parts[0], parts[1]);
        else if (parts.length === 4) docRef = doc(getDb(), parts[0], parts[1], parts[2], parts[3]);
        else if (parts.length === 6) docRef = doc(getDb(), parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
        if (docRef) await updateDoc(docRef, { [entry.field]: downloadURL });
      }

      _removeFromImgQueue(entry.path);
    } catch(e) {
      console.warn(`[Offline] Error sincronizando imagen ${entry.path}:`, e);
    }
  }

  _actualizarBadgePendientes();
  if (_getImgQueue().length === 0) {
    toast('✅ Datos sincronizados con Firebase', 'success', 3000);
  }
}

// Listeners de conectividad
window.addEventListener('online',  async () => {
  _actualizarBadgePendientes();
  setTimeout(_sincronizarImagenesPendientes, 2000);
});
window.addEventListener('offline', _actualizarBadgePendientes);
_actualizarBadgePendientes(); // estado inicial

// ─── HELPER FIRESTORE CON SOPORTE OFFLINE ────────────────────────────────────

/**
 * Ejecuta una operación Firestore con timeout offline.
 * Si no hay internet, Firestore encola la op internamente y resuelve
 * inmediatamente desde el caché local. Evita spinners colgados.
 *
 * @param {Function} fn         Función que retorna una Promise de Firestore
 * @param {number}   timeoutMs  Tiempo máximo de espera (default 4000ms)
 * @returns {Promise}
 */
export async function _fsOp(fn, timeoutMs = 4000) {
  if (!navigator.onLine) {
    try {
      return await Promise.race([
        fn(),
        new Promise(res => setTimeout(() => res({ id: 'offline_' + Date.now() }), 800))
      ]);
    } catch(e) {
      return { id: 'offline_' + Date.now() };
    }
  }
  return await fn();
}
window._fsOp = _fsOp;

// ─── SUBIR IMAGEN (CON SOPORTE OFFLINE) ─────────────────────────────────────

/**
 * Sube una imagen base64 a Firebase Storage.
 * Si no hay conexión, la encola en localStorage para sincronizar después.
 *
 * @param {string} dataUrl        Imagen en base64 (data:image/...)
 * @param {string} storagePath    Ruta en Firebase Storage
 * @param {string} [firestorePath]Ruta del documento Firestore a actualizar
 * @param {string} [field]        Campo del documento a actualizar con la URL
 * @returns {Promise<string>}     URL descargable o base64 si está offline
 */
export async function subirImagenBase64(dataUrl, storagePath, firestorePath, field) {
  if (!dataUrl || dataUrl.startsWith('http')) return dataUrl;

  if (!navigator.onLine) {
    _addToImgQueue({ path: storagePath, dataUrl, firestorePath: firestorePath || null, field: field || 'imagen', savedAt: Date.now() });
    return dataUrl;
  }

  try {
    const imgRef = ref(getStorage(), storagePath);
    await uploadString(imgRef, dataUrl, 'data_url');
    return await getDownloadURL(imgRef);
  } catch(e) {
    _addToImgQueue({ path: storagePath, dataUrl, firestorePath: firestorePath || null, field: field || 'imagen', savedAt: Date.now() });
    return dataUrl;
  }
}
window.subirImagenBase64 = subirImagenBase64;

// ─── COMPRIMIR IMAGEN ANTES DE SUBIR ─────────────────────────────────────────

/**
 * Redimensiona y comprime una imagen a JPEG/PNG según el tipo.
 * @param {File}   file       Archivo de imagen
 * @param {number} maxHeight  Altura máxima en px (default: 400)
 * @param {number} quality    Calidad JPEG 0–1 (default: 0.82)
 * @returns {Promise<string>} dataURL comprimido
 */
export function comprimirImagen(file, maxHeight = 400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const objectURL = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectURL);
      let { width, height } = img;
      if (height > maxHeight) { width = Math.round(width * (maxHeight / height)); height = maxHeight; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const isSVG = file.type === 'image/svg+xml';
      const hasAlpha = ['image/png','image/gif','image/webp','image/avif'].includes(file.type);
      const outMime = (isSVG || !hasAlpha) ? 'image/jpeg' : 'image/png';
      resolve(canvas.toDataURL(outMime, outMime === 'image/jpeg' ? quality : undefined));
    };
    img.onerror = () => { URL.revokeObjectURL(objectURL); reject(new Error('No se pudo cargar la imagen')); };
    img.src = objectURL;
  });
}
window.comprimirImagen = comprimirImagen;

// Exponer helpers de cola para uso en inventario.js
window._addToImgQueue            = _addToImgQueue;
window._removeFromImgQueue       = _removeFromImgQueue;
window._actualizarFirestoreEnCola = _actualizarFirestoreEnCola;
window._actualizarBadgePendientes = _actualizarBadgePendientes;

console.log('[offline] Sistema offline cargado ✅');
