/**
 * ════════════════════════════════════════════════════════════════════
 * MÓDULO: barcode-scanner.js — Escaneo de Códigos de Barras
 * RESPONSABILIDAD: Detectar entrada de lectores de código de barras USB/BT
 *                  y cámaras (vía jsQR o BarcodeDetector API).
 *
 * FUNCIONES EXPUESTAS EN window:
 *   initBarcodeListener()      → Activa escucha de lector USB/BT global
 *   abrirScanerCamara()        → Abre modal de escaneo por cámara
 *   cerrarScanerCamara()       → Cierra modal y detiene la cámara
 *   buscarPorBarcode(codigo)   → Busca producto por código y lo agrega al carrito
 *
 * INTEGRACIÓN:
 *   Los lectores USB/BT se comportan como teclados rápidos que terminan con
 *   Enter. Este módulo los intercepta globalmente cuando el foco no está en
 *   un campo de texto.
 * ════════════════════════════════════════════════════════════════════
 */

import { AppState } from './app-state.js';
import { toast }    from './utils.js';

// ─── LECTOR USB/BT (INPUT RÁPIDO + ENTER) ───────────────────────────────────

let _barcodeBuffer    = '';
let _barcodeTimeout   = null;
const BARCODE_DELAY   = 80; // ms entre teclas (lector HID es más rápido que humano)

export function initBarcodeListener() {
  document.addEventListener('keydown', _onKeyDown, true);
}
window.initBarcodeListener = initBarcodeListener;

// Inicializar automáticamente cuando el negocio esté listo
window.addEventListener('micolmapp:negocio-listo', initBarcodeListener);

function _onKeyDown(e) {
  // Ignorar si el foco está en un input/textarea/select
  const tag = document.activeElement?.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;

  // Ignorar modificadores de teclado
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  if (e.key === 'Enter') {
    if (_barcodeBuffer.length >= 3) {
      _procesarCodigo(_barcodeBuffer.trim());
    }
    _barcodeBuffer  = '';
    clearTimeout(_barcodeTimeout);
    return;
  }

  // Solo caracteres imprimibles
  if (e.key.length === 1) {
    _barcodeBuffer += e.key;
    clearTimeout(_barcodeTimeout);
    _barcodeTimeout = setTimeout(() => { _barcodeBuffer = ''; }, BARCODE_DELAY * 10);
  }
}

function _procesarCodigo(codigo) {
  const prod = AppState.productos.find(p => p.codigoBarras === codigo);
  if (prod) {
    if (window.agregarAlCarrito) window.agregarAlCarrito(prod.id);
    toast(`✅ ${prod.nombre} agregado`, 'success', 2000);
  } else {
    // Mostrar el input de búsqueda en el POS con el código pre-llenado
    const buscadorEl = document.getElementById('pos-buscador');
    if (buscadorEl) {
      buscadorEl.value = codigo;
      buscadorEl.dispatchEvent(new Event('input'));
    }
    toast(`Código: ${codigo} — sin coincidencia`, 'warning', 2500);
  }
}

// ─── BÚSQUEDA MANUAL POR CÓDIGO ──────────────────────────────────────────────

export function buscarPorBarcode(codigo) {
  if (!codigo) return;
  _procesarCodigo(codigo.trim());
}
window.buscarPorBarcode = buscarPorBarcode;

// ─── ESCANEO POR CÁMARA (BarcodeDetector API / jsQR fallback) ───────────────

let _videoStream  = null;
let _scanInterval = null;
let _scanCanvas   = null;
let _scanCtx      = null;
let _barcodeDetector = null;

// Inicializar BarcodeDetector API si está disponible
if ('BarcodeDetector' in window) {
  try {
    _barcodeDetector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'code_128', 'qr_code', 'upc_a', 'upc_e'] });
  } catch(e) {}
}

export async function abrirScanerCamara() {
  const modal  = document.getElementById('modal-scanner-camara');
  const videoEl = document.getElementById('scanner-video');
  if (!modal || !videoEl) {
    // Fallback: usar input manual
    const manualModal = document.getElementById('modal-scanner');
    if (manualModal) {
      manualModal.classList.add('visible');
      setTimeout(() => document.getElementById('scanner-input')?.focus(), 300);
    }
    return;
  }

  try {
    _videoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    videoEl.srcObject = _videoStream;
    await videoEl.play();

    modal.classList.add('visible');

    // Canvas para extracción de frames
    _scanCanvas       = document.createElement('canvas');
    _scanCtx          = _scanCanvas.getContext('2d');

    // Iniciar escaneo
    _scanInterval = setInterval(() => _scanFrame(videoEl), 300);
  } catch(e) {
    toast('No se pudo acceder a la cámara. Usa el modo manual.', 'error', 4000);
    // Abrir modal manual como fallback
    const manualModal = document.getElementById('modal-scanner');
    if (manualModal) {
      manualModal.classList.add('visible');
      setTimeout(() => document.getElementById('scanner-input')?.focus(), 300);
    }
  }
}
window.abrirScanerCamara = abrirScanerCamara;

export function cerrarScanerCamara() {
  clearInterval(_scanInterval);
  _scanInterval = null;

  if (_videoStream) {
    _videoStream.getTracks().forEach(t => t.stop());
    _videoStream = null;
  }

  const modal   = document.getElementById('modal-scanner-camara');
  const videoEl = document.getElementById('scanner-video');
  if (modal)   modal.classList.remove('visible');
  if (videoEl) videoEl.srcObject = null;
}
window.cerrarScanerCamara = cerrarScanerCamara;

async function _scanFrame(videoEl) {
  if (!videoEl || videoEl.readyState < 2) return;

  _scanCanvas.width  = videoEl.videoWidth;
  _scanCanvas.height = videoEl.videoHeight;
  _scanCtx.drawImage(videoEl, 0, 0);

  try {
    if (_barcodeDetector) {
      // BarcodeDetector API (Chrome 83+, Edge 83+)
      const codes = await _barcodeDetector.detect(_scanCanvas);
      if (codes.length > 0) {
        const codigo = codes[0].rawValue;
        cerrarScanerCamara();
        _procesarCodigo(codigo);
      }
    } else if (window.jsQR) {
      // Fallback a jsQR
      const imgData = _scanCtx.getImageData(0, 0, _scanCanvas.width, _scanCanvas.height);
      const code    = window.jsQR(imgData.data, imgData.width, imgData.height);
      if (code) {
        cerrarScanerCamara();
        _procesarCodigo(code.data);
      }
    }
  } catch(e) {}
}

// ─── MODAL SCANNER MANUAL (TECLADO) ──────────────────────────────────────────

window.abrirScaner = () => {
  const inp = document.getElementById('scanner-input');
  if (inp) inp.value = '';
  const modal = document.getElementById('modal-scanner');
  if (modal) modal.classList.add('visible');
  setTimeout(() => inp?.focus(), 300);
};

// Enter en el input del scanner manual
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('scanner-input');
  if (inp) {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') buscarPorBarcode(inp.value);
    });
  }
});

console.log('[barcode-scanner] Módulo de escáner cargado ✅');
