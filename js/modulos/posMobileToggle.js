// Mobile POS toggle — productos ↔ carrito (extraído de miColmApp.html)
// FAB solo visible en sección Facturación (POS)
(function () {
  let _mobVistaCarrito = false;

  function _esMobile() {
    return window.innerWidth <= 768;
  }

  // Mostrar/ocultar FAB según la página activa
  window._actualizarVisibilidadFab = function () {
    const fab = document.getElementById('mob-carrito-fab');
    const enPos = document.body.classList.contains('en-pos');
    if (!fab) return;
    fab.style.display = _esMobile() && enPos ? 'flex' : 'none';
  };

  window.mobToggleCarrito = function (forzar) {
    if (typeof forzar === 'boolean') _mobVistaCarrito = forzar;
    else _mobVistaCarrito = !_mobVistaCarrito;
    _aplicarVista();
  };

  function _aplicarVista() {
    if (!_esMobile()) return;
    const posRight = document.getElementById('pos-right');
    const posCenter = document.querySelector('.pos-center');
    const fab = document.getElementById('mob-carrito-fab');
    const fabLabel = document.getElementById('fab-label');
    const fabIcon = document.getElementById('fab-icon-i');
    if (!posRight || !posCenter || !fab) return;

    if (_mobVistaCarrito) {
      posRight.classList.add('mob-visible');
      posCenter.classList.add('mob-hidden');
      fab.classList.add('modo-carrito');
      fabLabel.textContent = 'Ver Productos';
      fabIcon.className = 'fas fa-store';
    } else {
      posRight.classList.remove('mob-visible');
      posCenter.classList.remove('mob-hidden');
      fab.classList.remove('modo-carrito');
      fabLabel.textContent = 'Ver Carrito';
      fabIcon.className = 'fas fa-shopping-cart';
    }
  }

  window._actualizarFabBadge = function (n) {
    const badge = document.getElementById('fab-badge');
    if (!badge) return;
    badge.textContent = n;
    badge.classList.toggle('visible', n > 0);
  };

  window.addEventListener('resize', () => {
    if (!_esMobile()) {
      const posRight = document.getElementById('pos-right');
      const posCenter = document.querySelector('.pos-center');
      if (posRight) posRight.classList.remove('mob-visible');
      if (posCenter) posCenter.classList.remove('mob-hidden');
      _mobVistaCarrito = false;
    }
    window._actualizarVisibilidadFab();
  });
})();

