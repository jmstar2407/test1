// POS / Carrito / Dibujo / Facturacion
// Extraido de index.html para reducir el script inline principal.
(function () {
  // Este modulo asume que `js/app.js` ya expuso el estado y helpers
  // necesarios en `window`/scope global.

  window.abrirModalEditarItem = function (itemId) {
    const carrito = getCarrito();
    const item = carrito.find(i => i.id === itemId);
    if (!item) return;
    _meicItemId = itemId;

    document.getElementById('meic-nombre').textContent = item.nombre;
    const qty = parseFloat(Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(2));

    const precioUnitOriginal = item._precioInventario || item.precio;
    const totalOriginal = (item.comboActivo && item.comboPrecio && item.comboUnidades >= 2)
      ? window.calcularPrecioConCombo(qty, precioUnitOriginal, item.comboPrecio, item.comboUnidades)
      : precioUnitOriginal * qty;
    document.getElementById('meic-precio-original').textContent = 'RD$ ' + totalOriginal.toFixed(2);

    const totalActual = _meicTotalReal(item, qty);
    document.getElementById('meic-precio').value = totalActual.toFixed(2);
    document.getElementById('meic-qty').value = Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(2);
    const desc = item._descuento || 0;
    document.getElementById('meic-descuento').value = desc > 0 ? desc : '';

    meicActualizarPreview();

    const modal = document.getElementById('modal-editar-item-carrito');
    const panel = document.getElementById('modal-editar-item-panel');
    modal.style.display = 'block';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panel.style.transform = 'translateX(0)';
        panel.querySelectorAll('input[type="number"]').forEach(inp => {
          inp.addEventListener('wheel', function(e) { e.preventDefault(); }, { passive: false });
        });
      });
    });
  };

  window.cerrarModalEditarItem = function () {
    const panel = document.getElementById('modal-editar-item-panel');
    const modal = document.getElementById('modal-editar-item-carrito');
    panel.style.transform = 'translateX(100%)';
    setTimeout(() => { modal.style.display = 'none'; }, 330);
    _meicItemId = null;
  };

  window.meicActualizarPreview = function () {
    const precioTotal = parseFloat(document.getElementById('meic-precio').value) || 0;
    const qty = parseFloat(document.getElementById('meic-qty').value) || 0;
    const desc = parseFloat(document.getElementById('meic-descuento').value) || 0;
    const precioTotalConDesc = desc > 0 ? precioTotal * (1 - desc / 100) : precioTotal;
    const precioUnitConDesc = qty > 0 ? precioTotalConDesc / qty : 0;

    document.getElementById('meic-preview-precio').textContent = 'RD$ ' + precioUnitConDesc.toFixed(2) + (desc > 0 ? ' (−' + desc + '%)' : '');
    document.getElementById('meic-preview-qty').textContent = qty;
    document.getElementById('meic-preview-total').textContent = 'RD$ ' + precioTotalConDesc.toFixed(2);

    const infoEl = document.getElementById('meic-descuento-info');
    if (desc > 0 && precioTotal > 0) {
      infoEl.style.display = 'block';
      infoEl.textContent = 'Ahorro: RD$ ' + (precioTotal * desc / 100).toFixed(2);
    } else {
      infoEl.style.display = 'none';
    }

    if (_meicItemId && precioTotal > 0 && qty > 0) {
      const carrito = getCarrito();
      const idx = carrito.findIndex(i => i.id === _meicItemId);
      if (idx >= 0) {
        const carritoEl = document.getElementById('carrito-items');
        const itemEl = carritoEl ? carritoEl.querySelector(`.carrito-item[data-item-id="${_meicItemId}"]`) : null;
        if (itemEl) {
          const subEl = itemEl.querySelector('.item-subtotal');
          if (subEl) subEl.textContent = fmt(precioTotalConDesc);
          const qtyEl = itemEl.querySelector('.qty-num');
          if (qtyEl) qtyEl.textContent = qty;
          const precioEl = itemEl.querySelector('.item-precio');
          if (precioEl) precioEl.textContent = fmt(precioUnitConDesc) + ' c/u';
        }
        _meicRecalcularTotales(carrito, idx, precioTotalConDesc);
      }
    }
  };

  function _meicRecalcularTotales(carrito, idxEditado, precioTotalEditado) {
    const itbisPct = (window.config && config.itbisPct) || 18;
    const itbisCliente = config.itbisCliente === true;
    let subtotal = 0;
    let itbis = 0;
    carrito.forEach((item, i) => {
      let lineTotal;
      if (i === idxEditado) lineTotal = precioTotalEditado;
      else lineTotal = _meicTotalReal(item, item.qty);
      subtotal += lineTotal;
      if (itbisCliente && item.itbis !== false) itbis += lineTotal * (itbisPct / 100);
    });
    const total = subtotal + itbis;
    const fmtN = n => 'RD$ ' + n.toFixed(2);
    const subEl = document.getElementById('cart-subtotal');
    const itbisEl = document.getElementById('cart-itbis');
    const totalEl = document.getElementById('cart-total');
    if (subEl) subEl.textContent = fmtN(subtotal);
    if (itbisEl) itbisEl.textContent = fmtN(itbis);
    if (totalEl) totalEl.textContent = fmtN(total);
  }

  window.meicSyncTotalDesdeQty = function () {
    if (!_meicItemId) return;
    const carrito = getCarrito();
    const item = carrito.find(i => i.id === _meicItemId);
    if (!item) return;
    const nuevaQty = parseFloat(document.getElementById('meic-qty').value) || 0;
    if (nuevaQty > 0) {
      const nuevoTotal = _meicTotalReal(item, nuevaQty);
      document.getElementById('meic-precio').value = nuevoTotal.toFixed(2);
    }
  };

  window.meicCambiarQty = function (delta) {
    if (!_meicItemId) return;
    const carrito = getCarrito();
    const item = carrito.find(i => i.id === _meicItemId);
    const inpQty = document.getElementById('meic-qty');
    const qtyVieja = parseFloat(inpQty.value) || 1;
    const nuevaQty = Math.max(1, Math.floor(qtyVieja) + delta);
    inpQty.value = nuevaQty;
    if (item) {
      const nuevoTotal = _meicTotalReal(item, nuevaQty);
      document.getElementById('meic-precio').value = nuevoTotal.toFixed(2);
    }
    meicActualizarPreview();
  };

  window.meicGuardarCambios = function () {
    if (!_meicItemId) return;
    const carrito = getCarrito();
    const idx = carrito.findIndex(i => i.id === _meicItemId);
    if (idx < 0) return;

    const precioTotal = parseFloat(document.getElementById('meic-precio').value) || 0;
    const nuevaQty = parseFloat(document.getElementById('meic-qty').value) || 1;
    const desc = parseFloat(document.getElementById('meic-descuento').value) || 0;
    const item = carrito[idx];

    if (!item._precioInventario) item._precioInventario = item.precio;

    const precioTotalConDesc = desc > 0 ? precioTotal * (1 - desc / 100) : precioTotal;
    item._descuento = desc;
    item.qty = nuevaQty;

    const totalEsperadoConCombo = (item.comboActivo && item.comboPrecio && item.comboUnidades >= 2)
      ? window.calcularPrecioConCombo(nuevaQty, item.precio, item.comboPrecio, item.comboUnidades)
      : null;
    const totalEsperadoSinCombo = item.precio * nuevaQty;
    const fueEditadoManualmente = Math.abs(precioTotal - (totalEsperadoConCombo ?? totalEsperadoSinCombo)) > 0.005;

    if (fueEditadoManualmente) {
      const precioUnitFinal = nuevaQty > 0 ? precioTotalConDesc / nuevaQty : precioTotalConDesc;
      item._precioBase = precioUnitFinal;
      item.precio = precioUnitFinal;
      item.comboActivo = false;
    } else {
      item._precioBase = undefined;
      item.precio = item._precioInventario;
    }

    setCarrito(carrito);
    cerrarModalEditarItem();
    renderCarrito();
    if (_modoEdicionCarrito) setTimeout(_aplicarOverlaysEdicion, 80);
    if (window.toast) toast('Producto actualizado', 'ok', 2000);
  };

  const _origRenderCarritoModule = renderCarrito;
  renderCarrito = function () {
    _origRenderCarritoModule();
    if (_modoEdicionCarrito) requestAnimationFrame(_aplicarOverlaysEdicion);
  };

  function _actualizarBtnLimpiar() {
    const btn = document.querySelector('.btn-dibujo-sm.rojo');
    if (!btn) return;
    const tieneContenido = dibujoDataURL !== null;
    btn.classList.toggle('con-dibujo', tieneContenido);
  }
  window._actualizarBtnLimpiar = _actualizarBtnLimpiar;

  function _crearSignaturePad(canvas, dataURL) {
    if (signaturePad) {
      try { signaturePad.off(); } catch (e) {}
    }

    const wrapper = canvas.parentElement;
    const posRight = document.getElementById('pos-right');
    const realW = wrapper.offsetWidth || (posRight ? posRight.clientWidth - 32 : 0) || 320;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(realW * dpr);
    canvas.height = Math.round(256 * dpr);
    canvas.style.width = realW + 'px';
    canvas.style.height = '256px';

    signaturePad = new SignaturePad(canvas, {
      backgroundColor: 'white',
      penColor: 'black',
      minWidth: 1,
      maxWidth: 1,
      velocityFilterWeight: 0
    });

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const datos = dataURL !== undefined ? dataURL : dibujoDataURL;
    if (datos) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, realW, 256);
      img.src = datos;
      dibujoDataURL = datos;
    }

    signaturePad.addEventListener('endStroke', () => {
      dibujoDataURL = signaturePad.isEmpty() ? null : signaturePad.toDataURL();
      const tab = _getTabActiva();
      if (tab) {
        tab.dibujoDataURL = dibujoDataURL;
        _guardarDibujoTab(tab.id, dibujoDataURL);
      }
      _actualizarBtnLimpiar();
    });
  }

  function _redimensionarCanvas() {
    const canvas = document.getElementById('firmaCanvas');
    if (!canvas) return;
    const dataActual = dibujoDataURL || (signaturePad && !signaturePad.isEmpty() ? signaturePad.toDataURL() : null);
    _crearSignaturePad(canvas, dataActual);
  }
  window._redimensionarCanvas = _redimensionarCanvas;

  window.inicializarSignaturePad = function () {
    const canvas = document.getElementById('firmaCanvas');
    if (!canvas) return;
    _crearSignaturePad(canvas, dibujoDataURL);

    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (!document.getElementById('dibujo-container')?.classList.contains('visible')) return;
        const wrapper = canvas.parentElement;
        const newW = Math.round(wrapper.offsetWidth * (window.devicePixelRatio || 1));
        if (Math.abs(canvas.width - newW) > 2) _redimensionarCanvas();
      });
      ro.observe(canvas.parentElement);
    } else {
      window.addEventListener('resize', () => {
        if (document.getElementById('dibujo-container')?.classList.contains('visible')) _redimensionarCanvas();
      });
    }

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          const container = document.getElementById('dibujo-container');
          if (container && container.classList.contains('visible')) {
            if (window._restaurandoDibujo) return;
            setTimeout(_redimensionarCanvas, 300);
          }
        }
      });
    });
    observer.observe(document.getElementById('dibujo-container'), { attributes: true });
  };

  function actualizarEstadoDibujo(abierto) {
    const icon = document.getElementById('icon-toggle-dibujo');
    if (icon) icon.className = abierto ? 'fas fa-arrow-down' : 'fas fa-arrow-up';
    localStorage.setItem('dibujo_abierto', abierto ? '1' : '0');
  }

  window.toggleDibujo = () => {
    const container = document.getElementById('dibujo-container');
    if (!container) return;
    if (container.classList.contains('visible')) {
      container.classList.remove('visible');
      actualizarEstadoDibujo(false);
    } else {
      container.classList.add('visible');
      actualizarEstadoDibujo(true);
      setTimeout(_redimensionarCanvas, 300);
    }
  };

  window.restaurarEstadoDibujo = function () {
    const abierto = localStorage.getItem('dibujo_abierto') === '1';
    if (abierto) {
      const container = document.getElementById('dibujo-container');
      if (container) {
        window._restaurandoDibujo = true;
        container.classList.add('visible');
        actualizarEstadoDibujo(true);
        setTimeout(() => { window._restaurandoDibujo = false; }, 300);
      }
    } else {
      actualizarEstadoDibujo(false);
    }
  };

  window.limpiarDibujo = () => {
    if (!signaturePad) return;
    signaturePad.clear();
    dibujoDataURL = null;
    const tab = _getTabActiva();
    if (tab) {
      tab.dibujoDataURL = null;
      _guardarDibujoTab(tab.id, null);
    }
    _actualizarBtnLimpiar();
    toast('Dibujo eliminado', 'info');
  };
})();

