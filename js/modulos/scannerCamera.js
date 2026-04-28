// Cámara escáner — lógica (extraído de miColmApp.html)
(function () {
  let _camStream = null;
  let _barDetector = null;
  let _scanLoop = null;
  let _scanning = false;
  let _destino = null; // 'prod-barcode' | callback fn

  // Abrir cámara y dirigir resultado a un input
  window.abrirCamaraScanner = function (destinoInputId) {
    _destino = destinoInputId || 'prod-barcode';
    document.getElementById('modal-camara-scanner').classList.add('visible');
    document.getElementById('cam-result-banner').classList.remove('visible');
    document.getElementById('cam-error-banner').classList.remove('visible');
    document.getElementById('cam-manual-input').value = '';
    _setStatus('Iniciando cámara...');
    _iniciarCamara();
    if (window._modalStack) {
      window._modalStack.push('modal-camara-scanner');
      history.pushState({ modalOpen: 'modal-camara-scanner', stackLen: window._modalStack.length }, '', window.location.href);
    }
  };

  window.cerrarCamaraScanner = function () {
    _detenerCamara();
    document.getElementById('modal-camara-scanner').classList.remove('visible');
    if (window._modalStack) {
      const idx = window._modalStack.lastIndexOf('modal-camara-scanner');
      if (idx !== -1) window._modalStack.splice(idx, 1);
    }
  };

  window.confirmarCodigoCamara = function () {
    const val = document.getElementById('cam-manual-input').value.trim();
    if (!val) return;
    _entregarCodigo(val);
  };

  function _setStatus(msg) {
    const el = document.getElementById('cam-status-text');
    if (el) el.innerHTML = msg;
  }

  function _mostrarResultado(code) {
    const banner = document.getElementById('cam-result-banner');
    const txt = document.getElementById('cam-result-text');
    if (txt) txt.textContent = '✅ Código: ' + code;
    if (banner) banner.classList.add('visible');
  }

  function _mostrarError(msg) {
    const banner = document.getElementById('cam-error-banner');
    const txt = document.getElementById('cam-error-text');
    if (txt) txt.textContent = msg;
    if (banner) banner.classList.add('visible');
    _setStatus('Ingresa el código manualmente ↓');
  }

  async function _iniciarCamara() {
    try {
      _camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const vid = document.getElementById('cam-video');
      vid.srcObject = _camStream;
      await vid.play();
      _setStatus('<strong>Apunta al código de barras</strong>');

      // Usar BarcodeDetector si está disponible (Chrome Android / algunos iOS)
      if ('BarcodeDetector' in window) {
        _barDetector = new BarcodeDetector({
          formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'data_matrix', 'codabar', 'itf'],
        });
        _scanning = true;
        _loopDetect();
      } else {
        // Fallback: solo entrada manual
        _setStatus('Tu navegador no soporta escaneo automático.<br><strong>Usa el campo manual ↓</strong>');
      }
    } catch (err) {
      _mostrarError('No se pudo acceder a la cámara. Revisa los permisos.');
      console.warn('Cam error:', err);
    }
  }

  function _loopDetect() {
    if (!_scanning) return;
    const vid = document.getElementById('cam-video');
    if (!vid || vid.readyState < 2) {
      _scanLoop = requestAnimationFrame(_loopDetect);
      return;
    }
    _barDetector
      .detect(vid)
      .then((codes) => {
        if (codes.length > 0) {
          const code = codes[0].rawValue;
          _scanning = false;
          cancelAnimationFrame(_scanLoop);
          _entregarCodigo(code);
        } else {
          _scanLoop = requestAnimationFrame(_loopDetect);
        }
      })
      .catch(() => {
        _scanLoop = requestAnimationFrame(_loopDetect);
      });
  }

  function _entregarCodigo(code) {
    _mostrarResultado(code);

    // Si viene del scanner de POS móvil, buscar por código de barras y agregar al carrito
    if (window._scannerDestinoPos) {
      window._scannerDestinoPos = false;
      setTimeout(() => {
        cerrarCamaraScanner();
        if (window.productos) {
          const prod = window.productos.find((p) => p.codigoBarras === code);
          if (prod) {
            if (window.agregarAlCarrito) window.agregarAlCarrito(prod.id);
            if (window.toast) toast('✅ ' + prod.nombre + ' agregado al carrito', 'success', 2500);
          } else {
            const inp = document.getElementById('pos-buscar');
            if (inp) {
              inp.value = code;
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              if (window.buscarProductos) window.buscarProductos(code);
            }
            if (window.toast) toast('🔍 Buscando: ' + code, 'info', 2000);
          }
        }
      }, 600);
      return;
    }

    // Poner en el input destino (comportamiento normal)
    const inp = document.getElementById(_destino);
    if (inp) {
      inp.value = code;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Activar modo "scanBtnActive" del escáner global si aplica
    if (window._bcScanner) window._bcScanner.scanBtnActive = false;
    // Toast y cerrar después de un momento
    setTimeout(() => {
      if (window.toast) toast('✅ Código capturado: ' + code, 'success', 2500);
      cerrarCamaraScanner();
    }, 700);
  }

  function _detenerCamara() {
    _scanning = false;
    if (_scanLoop) {
      cancelAnimationFrame(_scanLoop);
      _scanLoop = null;
    }
    if (_camStream) {
      _camStream.getTracks().forEach((t) => t.stop());
      _camStream = null;
    }
    const vid = document.getElementById('cam-video');
    if (vid) {
      vid.srcObject = null;
    }
  }

  // Cerrar al hacer clic en el fondo oscuro
  document.getElementById('modal-camara-scanner').addEventListener('click', function (e) {
    if (e.target === this) cerrarCamaraScanner();
  });
})();

