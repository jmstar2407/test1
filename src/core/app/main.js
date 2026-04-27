    import {
      auth,
      db,
      storage,
      createUserWithEmailAndPassword,
      signInWithEmailAndPassword,
      signOut,
      onAuthStateChanged,
      collection,
      collectionGroup,
      doc,
      getDoc,
      getDocs,
      setDoc,
      addDoc,
      updateDoc,
      deleteDoc,
      query,
      where,
      orderBy,
      limit,
      onSnapshot,
      Timestamp,
      serverTimestamp,
      writeBatch,
      ref,
      uploadString,
      getDownloadURL,
    } from '../../services/firebase/init.js';
    import { fmt, fmtNum } from '../../shared/helpers/format.js';

    // ══════════════════════════════════════════════════════════════════════════
    // SISTEMA OFFLINE COMPLETO — Cola de imágenes pendientes + indicadores
    // ══════════════════════════════════════════════════════════════════════════

    // ── Helper: ejecuta una operación Firestore con timeout offline ──────────
    // Si no hay internet, Firestore encola la op internamente y resuelve
    // INMEDIATAMENTE desde el caché local. Si hay red, resuelve con el servidor.
    // Esto evita que los botones queden colgados con el spinner.
    async function _fsOp(fn, timeoutMs = 4000) {
      if (!navigator.onLine) {
        // Sin red: ejecutar sin esperar confirmación del servidor
        // Firestore offline encola la escritura y la resuelve del caché
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

    // ── Cola de imágenes pendientes (base64 guardadas localmente hasta tener red) ──
    const OFFLINE_IMG_QUEUE_KEY = 'offline_img_queue_v1';

    function _getImgQueue() {
      try { return JSON.parse(localStorage.getItem(OFFLINE_IMG_QUEUE_KEY) || '[]'); } catch { return []; }
    }
    function _saveImgQueue(queue) {
      try { localStorage.setItem(OFFLINE_IMG_QUEUE_KEY, JSON.stringify(queue)); } catch(e) { console.warn('No se pudo guardar cola de imágenes:', e); }
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
    // Actualiza el firestorePath de una entrada en la cola (útil cuando se crea un doc nuevo y se conoce su ID después)
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

    // ── Actualizar badge de operaciones pendientes ──
    function _actualizarBadgePendientes() {
      const queue = _getImgQueue();
      const badge = document.getElementById('offline-badge');
      if (!badge) return;
      const offline = !navigator.onLine;
      if (offline) {
        badge.style.display = 'flex';
        badge.innerHTML = '<i class="fas fa-wifi-slash"></i> SIN CONEXIÓN';
      } else if (queue.length > 0) {
        badge.style.display = 'flex';
        badge.style.background = '#e67700';
        badge.innerHTML = `<i class="fas fa-sync fa-spin"></i> Sincronizando ${queue.length} imagen${queue.length > 1 ? 'es' : ''}...`;
      } else {
        badge.style.display = 'none';
        badge.style.background = '#e03131';
      }
    }

    // ── Sincronizar imágenes pendientes cuando vuelve la conexión ──
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
        toast('✅ Datos sincronizados con Firebase', 'success', 3000);
      }
    }

    // ── INDICADOR OFFLINE/ONLINE ──────────────────────────────────────────────
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

    let _invStats = { total: 0, unidades: 0, dinero: 0, porCategoria: {} }; // caché de estadísticas, se recalcula solo cuando productos cambia
    let cajaActual = null;
    let config = { itbisPct: 18, itbisCliente: false, ncfPrefijo: 'B01', ncfSeq: 1 }; // itbisCliente arranca false hasta que Firebase confirme el valor real
    let modoPrueba = false; // Modo de prueba: no guarda facturas ni descuenta stock

    window.toggleModoPrueba = (activo) => {
      modoPrueba = activo;
      // Guardar en localStorage para persistir por sesión
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
    let _unsubProductos = {}; // suscripciones en tiempo real por categoría
    let _unsubConfig = null;  // suscripción en tiempo real de configuración
    let _unsubEmpleados = null; // suscripción en tiempo real de empleados

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
      // Actualizar visibilidad del botón "x" de dirección
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
        msg.innerHTML = `¿Eliminar <strong>"${tab.nombre}"</strong>?<br><span style="color:#888;font-size:13px;">Se perderán los ${qty} producto${qty !== 1 ? 's' : ''} en el carrito.</span>`;
      } else {
        msg.innerHTML = `¿Cerrar <strong>"${tab.nombre}"</strong>?<br><span style="color:#888;font-size:13px;">El carrito está vacío.</span>`;
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
      // Restaurar dibujo de la tab que quedó activa
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

    // Actualizar botones scroll al cambiar tamaño de ventana
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
        // Si ya está parchado, salir
        if (window._vkbOpenOriginal) return;
        if (typeof window.vkbClose !== 'function') return; // aún no cargó el módulo

        // En este punto el módulo ya cargó — buscamos vkbOpen dentro del closure
        // La forma más directa: sobreescribir attachVkbToInput para que los nuevos
        // listeners respeten la bandera, y además parchamos vkbOpen si está expuesto.
        // Como vkbOpen NO está expuesta globalmente, usamos otro truco:
        // guardamos el attachVkbToInput original y lo envolvemos.
        const origAttach = window.attachVkbToInput;
        window.attachVkbToInput = function (inputId) {
          if (!window._vkEnabled) return; // no conectar si está desactivado
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
          }, true); // captura = antes que el listener del módulo
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
        // Si se desactiva, cerrar el teclado si está abierto
        if (!window._vkEnabled && typeof window.vkbClose === 'function') {
          window.vkbClose();
        }
      };

      // Aplicar botón y parche cuando el DOM esté listo
      function init() {
        updateBtn();
        patchVkbOpen();
        // Reintentar el parche por si virtualKeyboard.js carga después
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
        showAuthMsg('Iniciando sesión...', 'success');
        await signInWithEmailAndPassword(auth, email, pass);
      } catch (e) {
        showAuthMsg('Credenciales incorrectas. Verifica tu email y contraseña.', 'error');
      }
    };


    // ==================== SELECTOR TIPO NEGOCIO ====================
    window.selTipoNegocio = (prefix, tipo) => {
      const container = document.getElementById(`${prefix}-reg-tipo-btns`);
      const hidden = document.getElementById(`${prefix}-reg-tipo`);
      if (!container || !hidden) return;
      hidden.value = tipo;
      const colores = {
        colmado:     { border: '#1971c2', bg: '#eff6ff', color: '#1971c2' },
        restaurante: { border: '#e67700', bg: '#fff9db', color: '#e67700' },
        farmacia:    { border: '#7c3aed', bg: '#f5f3ff', color: '#5b21b6' },
        bebida:      { border: '#2f9e44', bg: '#ebfbee', color: '#2f9e44' },
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
      if (!nombre || !email || !pass) { showAuthMsg('Nombre, email y contraseña son requeridos', 'error'); return; }
      if (pass.length < 6) { showAuthMsg('La contraseña debe tener mínimo 6 caracteres', 'error'); return; }
      try {
        showAuthMsg('Registrando negocio...', 'success');
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        const uid = cred.user.uid;
        // Crear negocio con ID único (no el UID del usuario para soportar múltiples negocios)
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
        showAuthMsg('Registro exitoso. Inicia sesión.', 'success');
        authTab('login');
      } catch (e) {
        let msg = 'Error al registrar. ';
        if (e.code === 'auth/email-already-in-use') msg += 'Ese email ya está registrado.';
        else msg += e.message;
        showAuthMsg(msg, 'error');
      }
    };

    // Logout total: desconecta completamente de Firebase Auth
    window.logoutTotal = async () => {
      _limpiarSesionNegocio();
      await signOut(auth);
    };

    // Logout de negocio: vuelve al selector sin cerrar sesión Firebase
    window.cambiarNegocio = () => {
      _limpiarSesionNegocio();
      if (currentUser) mostrarSelectorNegocios(currentUser);
    };

    // Alias legacy por si algún lugar llama logout()
    window.logout = window.logoutTotal;

    function _limpiarSesionNegocio() {
      unsubscribers.forEach(u => u && u());
      unsubscribers = [];
      if (unsubCategorias) { unsubCategorias(); unsubCategorias = null; }
      // Cancelar todas las suscripciones de productos por categoría
      Object.values(_unsubProductos).forEach(u => u && u());
      _unsubProductos = {};
      // Cancelar suscripciones de config y empleados
      if (_unsubConfig) { _unsubConfig(); _unsubConfig = null; }
      if (_unsubEmpleados) { _unsubEmpleados(); _unsubEmpleados = null; }
      empleadosCache = [];
      // Limpiar caché de grids DOM
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
          // Si offline, buscar en caché local
          if (!navigator.onLine) {
            lista.innerHTML = `<div style="text-align:center;padding:20px;color:#e67700;"><i class="fas fa-wifi-slash" style="font-size:2rem;display:block;margin-bottom:8px;"></i><strong>Sin conexión</strong><br><span style="font-size:13px;">Inicia sesión con internet al menos una vez para usar el modo offline.</span></div>`;
          } else {
            lista.innerHTML = `<div style="text-align:center;padding:20px;color:#aab4c8;"><i class="fas fa-store-slash" style="font-size:2rem;display:block;margin-bottom:8px;"></i>No tienes ningún negocio registrado.<br>Agrega tu primer negocio.</div>`;
          }
          return;
        }
        // Obtener datos de cada negocio (Firestore los sirve desde caché offline)
        const negocios = await Promise.all(negociosIds.map(async id => {
          try {
            const snap = await getDoc(doc(db, 'negocios', id));
            if (snap.exists()) {
              // Actualizar caché local
              try { localStorage.setItem(`negocio_data_${id}`, JSON.stringify(snap.data())); } catch(e) {}
              return { id, ...snap.data() };
            }
            // Fallback a caché local
            const cached = localStorage.getItem(`negocio_data_${id}`);
            return cached ? { id, ...JSON.parse(cached) } : null;
          } catch(e) {
            const cached = localStorage.getItem(`negocio_data_${id}`);
            return cached ? { id, ...JSON.parse(cached) } : null;
          }
        }));
        const negociosValidos = negocios.filter(Boolean);
        const offlineBanner = !navigator.onLine ? `<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#664d03;"><i class="fas fa-wifi-slash"></i> <strong>Modo offline</strong> — Los cambios se sincronizarán al volver la conexión</div>` : '';
        lista.innerHTML = offlineBanner + negociosValidos.map(neg => `
          <div onclick="entrarAlNegocio('${neg.id}')" style="
            display:flex;align-items:center;gap:14px;
            background:#f8f9ff;border:2px solid #e2e8f0;border-radius:14px;
            padding:16px 18px;cursor:pointer;transition:all 0.18s;
          " onmouseover="this.style.borderColor='#1971c2';this.style.background='#eff6ff'"
             onmouseout="this.style.borderColor='#e2e8f0';this.style.background='#f8f9ff'">
            <div style="width:48px;height:48px;background:linear-gradient(135deg,#1971c2,#1864ab);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">🏪</div>
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
      // 1. Buscar en colección "usuarios" (fuente principal)
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
      } catch (e) { /* continuar — puede requerir índice en Firestore */ }
      // 4. Cache local como último recurso
      try {
        const cachedNeg = localStorage.getItem(`negocio_${user.uid}`);
        if (cachedNeg) ids.add(cachedNeg);
      } catch (e) { /* continuar */ }
      return [...ids];
    }

    window.entrarAlNegocio = async (negId) => {
      showScreen('loading');
      try {
        // Firestore con persistentLocalCache sirve datos desde caché offline automáticamente
        const negSnap = await getDoc(doc(db, 'negocios', negId));
        if (!negSnap.exists()) {
          // Intentar cargar desde caché local si estamos offline
          const cachedNeg = localStorage.getItem(`negocio_data_${negId}`);
          if (cachedNeg) {
            negocioId = negId;
            negocioData = JSON.parse(cachedNeg);
            userRole = localStorage.getItem(`negocio_role_${negId}_${currentUser.uid}`) || 'admin';
            localStorage.setItem(`negocio_activo_${currentUser.uid}`, negId);
            await initApp();
            if (!navigator.onLine) toast('📱 Modo offline — datos del caché local', 'warning', 3000);
            return;
          }
          toast('Negocio no encontrado', 'error'); showScreen('selector'); return;
        }
        negocioId = negId;
        negocioData = negSnap.data();
        // Guardar en caché local para modo offline
        try { localStorage.setItem(`negocio_data_${negId}`, JSON.stringify(negocioData)); } catch(e) {}
        const empSnap = await getDoc(doc(db, 'negocios', negocioId, 'empleados', currentUser.uid));
        if (empSnap.exists()) { userRole = empSnap.data().rol; }
        else { userRole = negocioData.propietarioUid === currentUser.uid ? 'admin' : 'empleado'; }
        try { localStorage.setItem(`negocio_role_${negId}_${currentUser.uid}`, userRole); } catch(e) {}
        // Recordar el negocio activo
        localStorage.setItem(`negocio_activo_${currentUser.uid}`, negId);
        localStorage.setItem(`negocio_${currentUser.uid}`, negId);
        await initApp();
        if (!navigator.onLine) toast('📱 Modo offline — los cambios se sincronizarán al volver la conexión', 'warning', 4000);
      } catch (e) {
        // Si falla por offline, intentar con caché local
        if (!navigator.onLine || e.code === 'unavailable') {
          const cachedNeg = localStorage.getItem(`negocio_data_${negId}`);
          if (cachedNeg) {
            negocioId = negId;
            negocioData = JSON.parse(cachedNeg);
            userRole = localStorage.getItem(`negocio_role_${negId}_${currentUser.uid}`) || 'admin';
            localStorage.setItem(`negocio_activo_${currentUser.uid}`, negId);
            try { await initApp(); } catch(e2) { console.error(e2); }
            toast('📱 Modo offline — funcionando con datos locales', 'warning', 4000);
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
        msgEl.style.color = '#00b341'; msgEl.textContent = '¡Negocio creado!';
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
        // Verificar si había un negocio activo en sesión anterior
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

    async function loadNegocio(user) {
      // Mantenido por compatibilidad — ya no se usa directamente
      await mostrarSelectorNegocios(user);
    }

    async function initApp() {
      showScreen('loading');

      // ── CONFIG: onSnapshot sirve desde caché offline, actualiza en vivo si hay red ──
      if (_unsubConfig) { _unsubConfig(); _unsubConfig = null; }
      _unsubConfig = onSnapshot(
        doc(db, 'negocios', negocioId, 'configuraciones', 'general'),
        (snap) => {
          if (snap.exists()) {
            config = { itbisPct: 18, itbisCliente: true, ncfPrefijo: 'B01', ncfSeq: 1, ...snap.data() };
            // Reflejar en UI de config si ya está montada
            const el = document.getElementById('cfg-itbis-pct');
            if (el) el.value = config.itbisPct ?? 18;
          }
        },
        () => {} // ignorar error — usar config default
      );

      // ── EMPLEADOS: onSnapshot mantiene empleadosCache siempre actualizado ─────
      if (_unsubEmpleados) { _unsubEmpleados(); _unsubEmpleados = null; }
      _unsubEmpleados = onSnapshot(
        collection(db, 'negocios', negocioId, 'empleados'),
        (snap) => {
          empleadosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          // Si la página de config ya está visible, re-renderizar lista de empleados
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
      // Restaurar estado del panel de dibujo DESPUÉS de inicializar el pad y cargar el dibujo
      restaurarEstadoDibujo();
      // Actualizar color del botón limpiar según si hay dibujo guardado
      _actualizarBtnLimpiar();

      // Restaurar botones de grid según preferencia guardada
      const bg = document.getElementById('btn-grid-grande');
      const bp = document.getElementById('btn-grid-peq');
      if (bg) bg.classList.toggle('active', gridSize === 'grande');
      if (bp) bp.classList.toggle('active', gridSize === 'pequena');

      showScreen('app');
      showPage('pos');
      // Sincronizar imágenes pendientes si hay conexión
      if (navigator.onLine) {
        setTimeout(_sincronizarImagenesPendientes, 3000);
      }

      // Restaurar dirección del cliente de la tab activa al refrescar
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

    // ==================== SCREENS ====================
    function showScreen(screen) {
      document.getElementById('loading-screen').style.display = screen === 'loading' ? 'flex' : 'none';
      document.getElementById('auth-screen').style.display = screen === 'auth' ? 'flex' : 'none';
      document.getElementById('negocio-selector-screen').style.display = screen === 'selector' ? 'flex' : 'none';
      document.getElementById('app').style.display = screen === 'app' ? 'flex' : 'none';
    }

    // ==================== NAVBAR ====================
    function buildNavbar() {
      // Mostrar email del usuario en el menú
      const emailEl = document.getElementById('nav-email-txt');
      if (emailEl && currentUser) emailEl.textContent = currentUser.email;
      const btns = document.getElementById('nav-buttons');
      const pages = [
        { id: 'pos', label: 'Facturación', icon: 'fa-cash-register', roles: ['admin', 'empleado'] },
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
        // Slot para el botón de menú (3 puntos) — el elemento real se mueve aquí con CSS
        mobNav.innerHTML = pagesHtml + '<div class="mob-nav-menu-slot" id="mob-nav-menu-slot"></div>';
        // Mover el nav-menu-wrap al slot del bottom nav en móvil
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
      // FAB solo visible en la sección de facturación (POS)
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
        // Asegurar que el grid de la categoría activa sea visible
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

        // Detectar si las categorías realmente cambiaron antes de re-renderizar
        const catsStr = JSON.stringify(nuevasCats);
        const catsAnteriorStr = JSON.stringify(categorias);
        const catsChanged = catsStr !== catsAnteriorStr;

        categorias = nuevasCats;

        if (catsChanged) {
          renderCategoriasPos();
          populateCatSelects();
        }

        // Suscribir productos de categorías nuevas, desuscribir las eliminadas
        _sincronizarSuscripcionesProductos();
      });
    }

    function _sincronizarSuscripcionesProductos() {
      const catIds = new Set(categorias.map(c => c.id));

      // Desuscribir categorías eliminadas
      Object.keys(_unsubProductos).forEach(catId => {
        if (!catIds.has(catId)) {
          _unsubProductos[catId]();
          delete _unsubProductos[catId];
          // Eliminar productos de esa categoría
          productos = productos.filter(p => p.categoriaId !== catId);
        }
      });

      // Suscribir categorías nuevas
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

      // Detectar si algo realmente cambió para esta categoría
      const anterioresDeEstaCat = productos.filter(p => p.categoriaId === catId);
      const anteriorStr = JSON.stringify(anterioresDeEstaCat.map(p => ({ ...p })).sort((a,b) => a.id.localeCompare(b.id)));
      const nuevoStr = JSON.stringify(nuevosDeEstaCat.map(p => ({ ...p })).sort((a,b) => a.id.localeCompare(b.id)));

      if (anteriorStr === nuevoStr) return; // Sin cambios reales, no re-renderizar

      // Reemplazar productos de esta categoría
      productos = productos.filter(p => p.categoriaId !== catId).concat(nuevosDeEstaCat);
      productos.sort((a, b) => {
        if (a.categoriaId !== b.categoriaId) return 0;
        return (a.orden ?? 9999) - (b.orden ?? 9999);
      });

      _recalcularInvStats();
      actualizarConteosCategorias();

      // Actualizar contenido del grid de la categoría que cambió (sin eliminarlo del DOM)
      // Esto evita parpadeos y problemas de visibilidad
      _llenarGrid(catId);

      // Si "más vendidos" puede verse afectada, actualizarla también
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
        toast(_offlineAC ? '📱 Caja abierta localmente — se sincronizará con Firebase' : 'Caja abierta exitosamente ✅', _offlineAC ? 'warning' : 'success', _offlineAC ? 5000 : 3000);
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
      if (Math.abs(diff) < 0.01) { el.style.background = '#d4edda'; el.style.color = '#155724'; el.textContent = '✅ Caja cuadra perfectamente'; }
      else if (diff > 0) { el.style.background = '#fff3cd'; el.style.color = '#856404'; el.textContent = `⚠️ Sobrante: ${fmt(diff)}`; }
      else { el.style.background = '#f8d7da'; el.style.color = '#721c24'; el.textContent = `❌ Faltante: ${fmt(Math.abs(diff))}`; }
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
        toast(_offlineCC ? '📱 Caja cerrada localmente — se sincronizará con Firebase' : 'Caja cerrada correctamente ✅', _offlineCC ? 'warning' : 'success', _offlineCC ? 5000 : 3000);
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
        toast(_offlineRG ? '📱 Gasto registrado localmente — se sincronizará con Firebase' : 'Gasto registrado ✅', _offlineRG ? 'warning' : 'success', _offlineRG ? 5000 : 3000);
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
      tbody.innerHTML = movimientosCache.map(m => { const fecha = m.fecha?.toDate ? m.fecha.toDate() : new Date(); return `<tr><td>${fecha.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}</td><td><span class="badge ${m.tipo}">${m.tipo === 'ingreso' ? '🟢 Ingreso' : '🔴 Gasto'}</span></td><td>${m.descripcion || '-'}</td><td>${m.empleadoNombre || '-'}</td><td style="font-family:var(--font-mono);font-weight:700;color:${m.tipo === 'ingreso' ? '#00b341' : '#e03131'};">${m.tipo === 'ingreso' ? '+' : '-'}${fmt(m.monto)}</td></tr>`; }).join('');
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
        card.innerHTML = `<div class="caja-estado-icon">🟢</div><h2>Caja Abierta</h2><p>Apertura: ${apertura} • Por: ${cajaActual.empleadoNombre || '-'}</p><div class="caja-info-grid"><div class="caja-info-item"><label>Monto Inicial</label><span>${fmt(cajaActual.montoInicial || 0)}</span></div><div class="caja-info-item"><label>Ingresos</label><span style="color:#00b341">+${fmt(ingresos)}</span></div><div class="caja-info-item"><label>Gastos</label><span style="color:#e03131">-${fmt(gastos)}</span></div><div class="caja-info-item"><label>Total Esperado</label><span>${fmt(total)}</span></div></div><div class="caja-btns"><button class="btn-caja gasto" onclick="abrirModalGasto()"><i class="fas fa-minus-circle"></i> Registrar Gasto</button><button class="btn-caja cerrar" onclick="abrirModalCerrarCaja()"><i class="fas fa-lock"></i> Cerrar Caja</button></div>`;
      } else {
        card.innerHTML = `<div class="caja-estado-icon">🔴</div><h2>Caja Cerrada</h2><p>No hay caja abierta. Debes abrir la caja para poder realizar ventas.</p><div class="caja-btns"><button class="btn-caja abrir" onclick="abrirModalAbrirCaja()"><i class="fas fa-lock-open"></i> Abrir Caja</button></div>`;
      }
      cargarMovimientosHoy();
      cargarHistorialCaja();
    }

    function actualizarConteosCategorias() {
      // Actualizar conteo de categoría virtual Más Vendidos
      const mvCard = document.getElementById('pos-cat-__mas_vendidos__');
      if (mvCard) {
        const mvCount = productos.filter(p => p.masVendidos).length;
        const mvCountEl = mvCard.querySelector('.cat-count');
        if (mvCountEl) mvCountEl.textContent = `${mvCount} producto${mvCount !== 1 ? 's' : ''}`;
      }
      // Actualizar conteos de categorías reales
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

      // Construir categorías: Más Vendidos primero (virtual), luego las reales
      const masVendidosProds = productos.filter(p => p.masVendidos);
      const mvBgImg = negocioData?.masVendidosBg || './img/backgrounds/masvendidos_1.jpg';
      const catsMostrar = [
        { id: '__mas_vendidos__', nombre: 'Más Vendidos', emoji: '⭐', imagen: mvBgImg, _virtual: true, _count: masVendidosProds.length }
      ].concat(categorias.filter(c => c.id !== '__mas_vendidos__').map(c => ({ ...c, _virtual: false, _count: productos.filter(p => p.categoriaId === c.id).length })));

      if (!catsMostrar.length || (catsMostrar.length === 1 && categorias.length === 0)) {
        lista.innerHTML = `<div style="color:rgba(0,0,0,0.4);font-size:12px;text-align:center;padding:20px 8px;">Sin categorías</div>`;
        if (area) area.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><p>No hay categorías creadas.<br>Ve a Inventario para crear categorías y productos.</p></div>`;
        return;
      }

      lista.innerHTML = catsMostrar.map(c => {
        const numProds = c._count;
        const esMasVendidos = c._virtual;
        const bgContent = c.imagen
          ? `<img class="cat-bg-img" src="${c.imagen}" alt="${c.nombre}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
          : '';
        const emojiFallback = `<div class="cat-bg-emoji" ${c.imagen ? 'style="display:none"' : ''}>${c.emoji || '📦'}</div>`;
        return `<div class="pos-cat-card${esMasVendidos ? ' mas-vendidos-cat' : ''}" id="pos-cat-${c.id}" onclick="verProductosCategoria('${c.id}')">${bgContent}${emojiFallback}<span class="cat-label">${c.nombre}</span><span class="cat-count">${numProds} producto${numProds !== 1 ? 's' : ''}</span></div>`;
      }).join('');

      // Si no hay categoría activa, seleccionar Más Vendidos (primera)
      if (!categoriaActual) {
        categoriaActual = '__mas_vendidos__';
      }
      if (categoriaActual) {
        renderProductosCategoria(categoriaActual);
        const activeCard = document.getElementById(`pos-cat-${categoriaActual}`);
        if (activeCard) activeCard.classList.add('activa');
      }
    }

    // ── CACHÉ DE GRIDS POR CATEGORÍA ─────────────────────────────────────────
    // Cada categoría tiene su propio div.productos-grid en el DOM.
    // Al cambiar de categoría solo se muestra/oculta — sin destruir ni recrear.
    // _gridOrdenCache guarda con qué orden fue renderizado cada grid para invalidarlo si cambia.
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
        : '<div class="empty-state"><i class="fas fa-box-open"></i><p>Sin productos en esta categoría</p></div>';
      // Registrar con qué orden fue renderizado este grid
      if (!busqueda) _gridOrdenCache[catId] = ordenProductos;
    }

    function _mostrarGrid(catId) {
      const area = document.getElementById('pos-productos-area');
      if (!area) return;
      // Ocultar todos los grids cacheados y el de búsqueda
      Array.from(area.children).forEach(el => { el.style.display = 'none'; });
      // Mostrar el de esta categoría (crearlo si no existe)
      const grid = _getOrCreateGrid(catId);
      if (grid) grid.style.display = '';
    }

    window.verProductosCategoria = (catId) => {
      categoriaActual = catId;
      document.querySelectorAll('.pos-cat-card').forEach(el => el.classList.remove('activa'));
      const activeCard = document.getElementById(`pos-cat-${catId}`);
      if (activeCard) activeCard.classList.add('activa');
      // Re-renderizar si es primera visita O si cambió el orden desde la última vez
      if (_gridNecesitaActualizar(catId)) {
        _llenarGrid(catId);
      }
      _mostrarGrid(catId);
    };

    function renderProductosCategoria(catId, busqueda = '') {
      if (busqueda) {
        // Con búsqueda: grid temporal, no entra en caché
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
          : '<div class="empty-state"><i class="fas fa-box-open"></i><p>Sin productos en esta categoría</p></div>';
        return;
      }
      // Sin búsqueda: reconstruir el grid cacheado de esta categoría
      // (llamado por Firebase cuando hay un cambio real)
      _llenarGrid(catId);
      _mostrarGrid(catId);
    }

    function escapeHtml(str) { return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
    function normalizarTexto(str) { return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

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
      const stockValDisplay = stockHab ? fmtNum(p.stock) : '∞';
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
        // Limpiar grids de búsqueda y volver a mostrar la categoría cacheada
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

    // ── Menú contextual producto en POS ─────────────────
    window.mostrarMenuContextoProducto = function(e, prodId) {
      e.preventDefault();
      // Eliminar menú previo si existe
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
    // ── Orden de productos ───────────────────────────────
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

    // Restaurar tamaño de grid guardado
    (function () { const saved = localStorage.getItem('pos_grid_size'); if (saved === 'pequena' || saved === 'grande') { gridSize = saved; document.addEventListener('DOMContentLoaded', () => { const bg = document.getElementById('btn-grid-grande'); const bp = document.getElementById('btn-grid-peq'); if (bg) bg.classList.toggle('active', saved === 'grande'); if (bp) bp.classList.toggle('active', saved === 'pequena'); }); } })();
    (function () { const savedOrden = localStorage.getItem('pos_orden_productos') || 'original'; ordenProductos = savedOrden; document.addEventListener('DOMContentLoaded', () => { const ba = document.getElementById('btn-orden-az'); if (ba) ba.classList.toggle('active', savedOrden === 'az'); }); })();

    window.abrirScaner = () => {
      if (window.innerWidth <= 768) {
        // En móvil: abrir cámara scanner y dirigir resultado al buscador de productos
        if (window.abrirCamaraScanner) {
          // Usar un destino especial que agrega el producto al carrito por código de barras
          window._scannerDestinoPos = true;
          abrirCamaraScanner('pos-buscar');
        }
      } else {
        document.getElementById('scanner-input').value = '';
        abrirModal('modal-scanner');
        setTimeout(() => document.getElementById('scanner-input').focus(), 300);
      }
    };

    window.buscarPorBarcode = () => { const codigo = document.getElementById('scanner-input').value.trim(); if (!codigo) return; const prod = productos.find(p => p.codigoBarras === codigo); if (prod) { agregarAlCarritoObj(prod); cerrarModal('modal-scanner'); } else { toast('Producto no encontrado con ese código', 'error'); } };

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
      if (key === '⌫') {
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
      if (isNaN(val) || val <= 0) { res.textContent = 'Valor inválido'; if (btn) btn.disabled = true; return; }
      if (btn) btn.disabled = false;
      const unidadLabel = labelUnidad(_duProd.unidad || '');
      if (_duTab === 'cantidad') {
        const subtotal = val * _duProd.precio;
        res.innerHTML = `${val} ${unidadLabel} × ${fmt(_duProd.precio)} = <span class="du-resultado-valor">${fmt(subtotal)}</span>`;
      } else {
        // Por precio: calcular cuántas unidades
        const cantEquiv = val / _duProd.precio;
        res.innerHTML = `${fmt(val)} ÷ ${fmt(_duProd.precio)}/${unidadLabel} = <span class="du-resultado-valor">${cantEquiv.toFixed(2)} ${unidadLabel}</span>`;
      }
    }

    window.duConfirmar = () => {
      if (!_duProd || !_duValor) { toast('Ingresa una cantidad', 'error'); return; }
      const val = parseFloat(_duValor);
      if (isNaN(val) || val <= 0) { toast('Cantidad inválida', 'error'); return; }

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
        // Modo edición: reemplazar qty existente
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
      toast(`✅ ${qty.toFixed(2)} ${labelUnidad(_duProd.unidad)} de ${_duProd.nombre} ${accion}`, 'success');
    };

    // ===== TECLADO FÍSICO + INPUT NATIVO para modal-detalle-unidad =====
    (function () {

      // Sincronizar cuando el usuario escribe directo en el input (teclado físico nativo)
      document.addEventListener('DOMContentLoaded', () => {
        const inp = document.getElementById('du-valor');
        if (!inp) return;

        // Escuchar escritura directa en el input
        inp.addEventListener('input', () => {
          // Filtrar solo caracteres válidos: dígitos y punto decimal
          let val = inp.value.replace(/[^0-9.]/g, '');
          // Evitar más de un punto
          const parts = val.split('.');
          if (parts.length > 2) val = parts[0] + '.' + parts.slice(1).join('');
          if (inp.value !== val) inp.value = val;
          _duValor = val;
          duActualizarResultado();
        });

        // Interceptar keydown en el input para Enter y Escape
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { duConfirmar(); e.preventDefault(); }
          else if (e.key === 'Escape') { cerrarModal('modal-detalle-unidad'); e.preventDefault(); }
        });

        // Permite escribir directo con teclado físico aun sin foco en el input
        document.addEventListener('keydown', (e) => {
          const modal = document.getElementById('modal-detalle-unidad');
          if (!modal || !modal.classList.contains('active')) return;
          if (e.ctrlKey || e.altKey || e.metaKey) return;
          if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

          if (e.key >= '0' && e.key <= '9') {
            duTecla(e.key);
            e.preventDefault();
            return;
          }
          if (e.key === '.') {
            duTecla('.');
            e.preventDefault();
            return;
          }
          if (e.key === 'Backspace') {
            duTecla('⌫');
            e.preventDefault();
            return;
          }
          if (e.key === 'Enter') {
            duConfirmar();
            e.preventDefault();
            return;
          }
          if (e.key === 'Escape') {
            cerrarModal('modal-detalle-unidad');
            e.preventDefault();
          }
        });

        // Observar apertura del modal para enfocar el input
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
    // ===== FIN TECLADO FÍSICO =====

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
      // Siempre iniciar vacío al abrir el modal para capturar el nuevo valor de una vez
      _duValor = '';
      document.getElementById('du-nombre').textContent = item.nombre;
      document.getElementById('du-precio-ref').innerHTML = `Precio: <span class="du-precio-valor">${fmt(item._precioBase || item.precio)}</span> por ${labelUnidad(item.unidad)}`;
      document.getElementById('du-valor').value = '';
      document.getElementById('du-label-unidad').textContent = labelUnidad(item.unidad || '');
      document.getElementById('du-tab-cant').classList.add('activo');
      document.getElementById('du-tab-precio').classList.remove('activo');
      // Cambiar título y botón confirmar
      const h3 = document.querySelector('#modal-detalle-unidad .modal-header h3');
      if (h3) h3.innerHTML = '<i class="fas fa-pen"></i> Editar cantidad';
      const btnOk = document.getElementById('du-btn-confirmar');
      if (btnOk) { btnOk.innerHTML = 'Actualizar Carrito'; btnOk.disabled = true; }
      duActualizarResultado();
      abrirModal('modal-detalle-unidad');
      setTimeout(() => document.getElementById('du-valor')?.focus(), 140);
    };

    // Edición inline de cantidad/precio en carrito (para productos detallables)
    window.editarCantidadDetalle = (prodId, inputEl) => {
      const carrito = getCarrito();
      const idx = carrito.findIndex(i => i.id === prodId);
      if (idx < 0) return;
      const val = parseFloat(inputEl.value);
      if (isNaN(val) || val <= 0) { inputEl.value = carrito[idx].qty.toFixed(2); return; }
      carrito[idx].qty = val;
      setCarrito(carrito);
      // Solo actualizar totales sin re-renderizar todo el carrito (para no perder el foco)
      _actualizarTotalesCarrito();
    };

    window.editarPrecioDetalle = (prodId, inputEl) => {
      const carrito = getCarrito();
      const idx = carrito.findIndex(i => i.id === prodId);
      if (idx < 0) return;
      const precioUnitario = carrito[idx]._precioBase || carrito[idx].precio;
      const totalIngresado = parseFloat(inputEl.value);
      if (isNaN(totalIngresado) || totalIngresado <= 0) { inputEl.value = (carrito[idx].qty * precioUnitario).toFixed(2); return; }
      // Calcular nueva qty a partir del precio total ingresado
      const nuevaQty = totalIngresado / precioUnitario;
      carrito[idx].qty = nuevaQty;
      setCarrito(carrito);
      // Actualizar campo de cantidad también
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

    // ── Funciones de combo (definidas aquí para estar disponibles globalmente) ──
    // Calcula el precio total a cobrar por qty unidades aplicando lógica combo
    // Ej: combo 2x15, precio unit 10 → 3 uds=25, 4 uds=30, 5 uds=40
    window.calcularPrecioConCombo = function calcularPrecioConCombo(qty, precioUnit, comboPrecio, comboUnidades) {
      if (!comboPrecio || !comboUnidades || comboUnidades < 2 || !precioUnit) {
        return qty * precioUnit;
      }
      const combosCompletos = Math.floor(qty / comboUnidades);
      const sueltas = qty % comboUnidades;
      return (combosCompletos * comboPrecio) + (sueltas * precioUnit);
    };

    // Calcula cuántas unidades se dan por un monto (para preview en inventario)
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
        if (i.comboActivo && i.comboPrecio && i.comboUnidades >= 2) {
          return s + window.calcularPrecioConCombo(i.qty, i.precio, i.comboPrecio, i.comboUnidades);
        }
        if (i._precioBase !== undefined) return s + i._precioBase * i.qty; // detallable
        return s + i.precio * i.qty;
      }, 0);
      const itbisPct = config.itbisPct || 18;
      const itbisCliente = config.itbisCliente === true;
      const itbis = itbisCliente ? subtotal * (itbisPct / 100) : 0;
      const total = subtotal + itbis;
      document.getElementById('cart-subtotal').textContent = fmt(subtotal);
      document.getElementById('cart-itbis').textContent = fmt(itbis);
      document.getElementById('cart-total').textContent = fmt(total);
      // Mostrar/ocultar fila ITBIS
      const itbisRow = document.getElementById('cart-itbis-row');
      if (itbisRow) itbisRow.style.display = itbisCliente ? '' : 'none';
      // Actualizar subtotal de cada item detallable
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

    // Guarda el ID del último producto agregado para aplicar el efecto de glow
    let _ultimoItemAgregado = null;

    window.agregarAlCarrito = (prodId) => {
      if (!cajaActual) { toast('⚠️ La caja no está abierta', 'error'); return; }
      const prod = productos.find(p => p.id === prodId);
      if (!prod) return;
      if (prod.stockHabilitado !== false && prod.stock <= 0) { toast('Sin stock disponible', 'error'); return; }
      if (esUnidadDetallable(prod.unidad)) {
        // Agregar directo con qty=1, sin modal
        const carrito = getCarrito();
        const idx = carrito.findIndex(i => i.id === prod.id);
        if (idx >= 0) {
          carrito[idx].qty += 1;
        } else {
          // No asignar _precioBase si tiene combo activo
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
        if (prod.stockHabilitado !== false && carrito[idx].qty >= prod.stock) { toast('No hay más stock disponible', 'error'); return; }
        carrito[idx].qty++;
      } else {
        // No asignar _precioBase si tiene combo activo; la condición i._precioBase === undefined activa la lógica combo en facturas
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
      // Lógica de combo: calcular precio real según cantidad de unidades
      if (item.comboActivo && item.comboPrecio && item.comboUnidades >= 2) {
        const subtotalReal = window.calcularPrecioConCombo(item.qty, item.precio, item.comboPrecio, item.comboUnidades);
        const combosCompletos = Math.floor(item.qty / item.comboUnidades);
        const sueltas = item.qty % item.comboUnidades;
        return `<div class="carrito-item"><div class="img-producto" style="position:relative;">${item.imagen ? `<img src="${item.imagen}" alt="${item.nombre}" onerror="this.outerHTML='<div class=&quot;item-emoji&quot;>📦</div>'">` : `<div class="item-emoji">📦</div>`}${pesoNeto}</div><div class="item-info"><div class="item-nombre">${item.nombre}</div><div class="item-precio">${fmt(item.precio)} c/u · ${item.comboUnidades}x${fmt(item.comboPrecio)}</div><div><span class="item-subtotal">${fmt(subtotalReal)}</span></div></div><div class="item-ctrl"><button class="qty-btn minus" onclick="cambiarQty('${item.id}', -1)">−</button><span class="qty-num">${item.qty}</span><button class="qty-btn plus" onclick="cambiarQty('${item.id}', 1)">+</button></div></div>`;
      }
      return `<div class="carrito-item"><div class="img-producto" style="position:relative;">${item.imagen ? `<img src="${item.imagen}" alt="${item.nombre}" onerror="this.outerHTML='<div class=&quot;item-emoji&quot;>📦</div>'">` : `<div class="item-emoji">📦</div>`}${pesoNeto}</div><div class="item-info"><div class="item-nombre">${item.nombre}</div><div class="item-precio">${fmt(item.precio)} c/u</div><div><span class="item-subtotal">${fmt(item.precio * item.qty)}</span></div></div><div class="item-ctrl"><button class="qty-btn minus" onclick="cambiarQty('${item.id}', -1)">−</button><span class="qty-num">${item.qty}</span><button class="qty-btn plus" onclick="cambiarQty('${item.id}', 1)">+</button></div></div>`;
    }

    function _renderItemDetallable(item) {
      const precioBase = item._precioBase || item.precio;
      const unidadLabel = labelUnidad(item.unidad || '');
      const subtotal = precioBase * item.qty;
      const qtyDisplay = Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(2);
      const pesoNeto = item.pesoNeto ? `<span class="peso-neto-badge">${item.pesoNeto}</span>` : '';
      return `<div class="carrito-item">
        <div class="img-producto" style="position:relative;">${item.imagen ? `<img src="${item.imagen}" alt="${item.nombre}" onerror="this.outerHTML='<div class=&quot;item-emoji&quot;>📦</div>'" style="">` : `<div class="item-emoji" style="width:44px;height:44px;font-size:20px;">📦</div>`}${pesoNeto}</div>
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
      // Contar productos distintos (no suma de unidades/libras/onzas)
      count.textContent = carrito.length;

      // Actualizar nombre de la factura en el header
      const headerNombre = document.getElementById('carrito-header-nombre');
      if (headerNombre) {
        const tabActiva = _getTabActiva();
        headerNombre.textContent = tabActiva ? tabActiva.nombre : 'Carrito';
      }

      if (!carrito.length) {
        items.innerHTML = `<div class="carrito-empty"><i class="fas fa-shopping-cart"></i><p>Agrega productos al carrito</p></div>`;
      } else {
        // ── Render diferencial: preserva imágenes ya cargadas ──
        // Eliminar nodos que NO son carrito-item (ej: carrito-empty)
        Array.from(items.children).forEach(el => {
          if (!el.classList.contains('carrito-item')) el.remove();
        });

        // Recopilar nodos existentes por data-item-id
        const existingNodes = {};
        items.querySelectorAll('.carrito-item[data-item-id]').forEach(el => {
          existingNodes[el.dataset.itemId] = el;
        });

        const newIds = new Set(carrito.map(i => i.id));

        // Eliminar nodos que ya no están en el carrito
        Object.keys(existingNodes).forEach(id => {
          if (!newIds.has(id)) existingNodes[id].remove();
        });

        // Recorrer el carrito en orden y actualizar/crear cada nodo
        carrito.forEach((item, idx) => {
          const esDetallable = esUnidadDetallable(item.unidad);
          const existing = existingNodes[item.id];

          if (existing) {
            // ── Actualizar solo los valores dinámicos, SIN tocar la imagen ──
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

            // Asegurar posición correcta en el DOM
            const currentChildren = Array.from(items.children).filter(el => el.classList.contains('carrito-item'));
            if (currentChildren[idx] !== existing) {
              items.insertBefore(existing, currentChildren[idx] || null);
            }
          } else {
            // ── Crear nodo nuevo con atributo data-item-id ──
            const html = esDetallable ? _renderItemDetallable(item) : _renderItemNormal(item);
            const tpl = document.createElement('div');
            tpl.innerHTML = html.trim();
            const newEl = tpl.firstElementChild;
            newEl.dataset.itemId = item.id;

            // Insertar en la posición correcta
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
      // Mostrar/ocultar fila ITBIS según configuración
      const itbisRow = document.getElementById('cart-itbis-row');
      if (itbisRow) itbisRow.style.display = itbisCliente ? '' : 'none';
      const btnVaciar = document.getElementById('btn-vaciar-carrito');
      if (btnVaciar) btnVaciar.style.background = carrito.length ? 'var(--rojo)' : '#aab4c8';
      if (typeof window._actualizarFabBadge === 'function') window._actualizarFabBadge(carrito.length);

      // ── Efecto de iluminación al agregar producto ──
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

// ══════════════════════════════════════════════════
    // MODO EDICIÓN CARRITO + MODAL EDITAR ITEM
    // ══════════════════════════════════════════════════
    let _modoEdicionCarrito = false;
    let _meicItemId = null;

    window.toggleModoEdicionCarrito = function () {
      _modoEdicionCarrito = !_modoEdicionCarrito;
      const icon = document.getElementById('icon-editar-carrito');
      if (icon) {
        icon.className = _modoEdicionCarrito ? 'fas fa-times' : 'fas fa-pen';
      }
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
        } else {
          if (ov) ov.remove();
        }
      });
    }

    // ── Función interna: calcula el total real de un item respetando combo/detalle ──
    function _meicTotalReal(item, qty) {
      if (item._precioBase !== undefined && !item.comboActivo) {
        // Detallable (libra, kg, etc) o precio ya sobreescrito manualmente
        return (item._precioBase || item.precio) * qty;
      }
      if (item.comboActivo && item.comboPrecio && item.comboUnidades >= 2) {
        return window.calcularPrecioConCombo(qty, item.precio, item.comboPrecio, item.comboUnidades);
      }
      return item.precio * qty;
    }

    window.abrirModalEditarItem = function (itemId) {
      const carrito = getCarrito();
      const item = carrito.find(i => i.id === itemId);
      if (!item) return;
      _meicItemId = itemId;

      document.getElementById('meic-nombre').textContent = item.nombre;
      const qty = parseFloat(Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(2));

      // Total original del inventario (sin descuento manual)
      const precioUnitOriginal = item._precioInventario || item.precio;
      const totalOriginal = (item.comboActivo && item.comboPrecio && item.comboUnidades >= 2)
        ? window.calcularPrecioConCombo(qty, precioUnitOriginal, item.comboPrecio, item.comboUnidades)
        : precioUnitOriginal * qty;
      document.getElementById('meic-precio-original').textContent = 'RD$ ' + totalOriginal.toFixed(2);

      // Total actual real (con combo aplicado)
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

      // Actualizar carrito en tiempo real (visual)
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
          // Recalcular totales del footer — el item editado usa el total directo del input
          _meicRecalcularTotales(carrito, idx, precioTotalConDesc);
        }
      }
    };

    // precioTotalEditado = monto total ya con descuento para el item que se está editando
    function _meicRecalcularTotales(carrito, idxEditado, precioTotalEditado) {
      const itbisPct = (window.config && config.itbisPct) || 18;
      const itbisCliente = config.itbisCliente === true;
      let subtotal = 0;
      let itbis = 0;
      carrito.forEach((item, i) => {
        let lineTotal;
        if (i === idxEditado) {
          lineTotal = precioTotalEditado; // ya es el total real con combo+descuento
        } else {
          lineTotal = _meicTotalReal(item, item.qty);
        }
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

    // Al cambiar qty, recalcula el total respetando combo
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
      // Recalcular total respetando combo
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
      const nuevaQty   = parseFloat(document.getElementById('meic-qty').value) || 1;
      const desc       = parseFloat(document.getElementById('meic-descuento').value) || 0;
      const item       = carrito[idx];

      // Preservar precio original del inventario la primera vez
      if (!item._precioInventario) item._precioInventario = item.precio;

      const precioTotalConDesc = desc > 0 ? precioTotal * (1 - desc / 100) : precioTotal;

      item._descuento = desc;
      item.qty = nuevaQty;

      // Si el usuario modificó el total manualmente (distinto del total combo esperado),
      // desactivamos el combo y guardamos como precio unitario fijo.
      const totalEsperadoConCombo = (item.comboActivo && item.comboPrecio && item.comboUnidades >= 2)
        ? window.calcularPrecioConCombo(nuevaQty, item.precio, item.comboPrecio, item.comboUnidades)
        : null;
      const totalEsperadoSinCombo = item.precio * nuevaQty;

      const fueEditadoManualmente = Math.abs(precioTotal - (totalEsperadoConCombo ?? totalEsperadoSinCombo)) > 0.005;

      if (fueEditadoManualmente) {
        // El cajero sobreescribió el precio: guardar como precio unitario fijo, sin combo
        const precioUnitFinal = nuevaQty > 0 ? precioTotalConDesc / nuevaQty : precioTotalConDesc;
        item._precioBase = precioUnitFinal;
        item.precio = precioUnitFinal;
        item.comboActivo = false; // precio fijo manual: ignorar combo
      } else {
        // El total coincide con lo esperado: mantener precio original y combo intacto
        item._precioBase = undefined; // dejar que renderCarrito use combo
        item.precio = item._precioInventario;
      }

      setCarrito(carrito);
      cerrarModalEditarItem();
      renderCarrito();
      if (_modoEdicionCarrito) setTimeout(_aplicarOverlaysEdicion, 80);
      if (window.toast) toast('Producto actualizado', 'ok', 2000);
    };

    // Patch renderCarrito to re-apply overlays when in edit mode
    const _origRenderCarrito = renderCarrito;
    renderCarrito = function() {
      _origRenderCarrito();
      if (_modoEdicionCarrito) {
        requestAnimationFrame(_aplicarOverlaysEdicion);
      }
    };

    function _actualizarBtnLimpiar() {
      const btn = document.querySelector('.btn-dibujo-sm.rojo');
      if (!btn) return;
      const tieneContenido = dibujoDataURL !== null;
      btn.classList.toggle('con-dibujo', tieneContenido);
    }

    // ==================== DIBUJO ====================
    // Función central que (re)crea el SignaturePad ajustando el canvas al tamaño físico real
    function _crearSignaturePad(canvas, dataURL) {
      if (signaturePad) {
        try { signaturePad.off(); } catch (e) { }
      }

      // Ancho real en píxeles CSS del wrapper (lo que ocupa en pantalla)
      const wrapper = canvas.parentElement;
      const posRight = document.getElementById('pos-right');
      const realW = wrapper.offsetWidth
        || (posRight ? posRight.clientWidth - 32 : 0)
        || 320;
      const dpr = window.devicePixelRatio || 1;

      // Fijar el canvas al tamaño físico real × DPR para que SignaturePad calcule el offset bien
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

      // Escalar el contexto del canvas por DPR para nitidez en pantallas HiDPI
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      // Cargar datos si existen
      const datos = dataURL !== undefined ? dataURL : dibujoDataURL;
      if (datos) {
        const img = new Image();
        img.onload = () => {
          // Dibujar manualmente la imagen respetando la escala DPR
          ctx.drawImage(img, 0, 0, realW, 256);
        };
        img.src = datos;
        dibujoDataURL = datos;
      }

      // Listener único: guarda el trazo en la clave propia de la tab activa
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

    // Recrea el pad adaptando el canvas al ancho real actual
    function _redimensionarCanvas() {
      const canvas = document.getElementById('firmaCanvas');
      if (!canvas) return;
      const dataActual = dibujoDataURL
        || (signaturePad && !signaturePad.isEmpty() ? signaturePad.toDataURL() : null);
      _crearSignaturePad(canvas, dataActual);
    }

    function inicializarSignaturePad() {
      const canvas = document.getElementById('firmaCanvas');
      if (!canvas) return;

      // Crear pad con el dibujo de la tab activa al iniciar
      _crearSignaturePad(canvas, dibujoDataURL);

      // ResizeObserver: recrea el pad si el wrapper cambia de ancho (resize, resizer drag, etc.)
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
          if (!document.getElementById('dibujo-container')?.classList.contains('visible')) return;
          const wrapper = canvas.parentElement;
          const newW = Math.round(wrapper.offsetWidth * (window.devicePixelRatio || 1));
          if (Math.abs(canvas.width - newW) > 2) {
            _redimensionarCanvas();
          }
        });
        ro.observe(canvas.parentElement);
      } else {
        // Fallback para navegadores sin ResizeObserver
        window.addEventListener('resize', () => {
          if (document.getElementById('dibujo-container')?.classList.contains('visible')) {
            _redimensionarCanvas();
          }
        });
      }

      // Cuando el panel se abre: recrear el pad con el ancho real post-animación
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.attributeName === 'class') {
            const container = document.getElementById('dibujo-container');
            if (container && container.classList.contains('visible')) {
              if (window._restaurandoDibujo) return;
              // Esperar a que la animación CSS termine (~290ms) para medir el ancho real
              setTimeout(_redimensionarCanvas, 300);
            }
          }
        });
      });
      observer.observe(document.getElementById('dibujo-container'), { attributes: true });
    }

    function actualizarEstadoDibujo(abierto) {
      const icon = document.getElementById('icon-toggle-dibujo');
      if (icon) {
        icon.className = abierto ? 'fas fa-arrow-down' : 'fas fa-arrow-up';
      }
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
        // Esperar a que termine la transición CSS (~300ms) para medir el ancho real
        setTimeout(_redimensionarCanvas, 300);
      }
    };

    function restaurarEstadoDibujo() {
      const abierto = localStorage.getItem('dibujo_abierto') === '1';
      if (abierto) {
        const container = document.getElementById('dibujo-container');
        if (container) {
          // Bandera para que el MutationObserver no interfiera durante la restauración
          window._restaurandoDibujo = true;
          container.classList.add('visible');
          actualizarEstadoDibujo(true);
          setTimeout(() => { window._restaurandoDibujo = false; }, 300);
        }
      } else {
        actualizarEstadoDibujo(false);
      }
    }

    window.limpiarDibujo = () => {
      if (signaturePad) {
        signaturePad.clear();
        dibujoDataURL = null;
        const tab = _getTabActiva();
        if (tab) {
          tab.dibujoDataURL = null;
          _guardarDibujoTab(tab.id, null);
        }
        _actualizarBtnLimpiar();
        toast('Dibujo eliminado', 'info');
      }
    };

    // ==================== FACTURAR ====================
    window.abrirModalFacturar = () => {
      const carrito = getCarrito();
      if (!carrito.length) { toast('El carrito está vacío', 'error'); return; }
      if (!cajaActual) { toast('La caja no está abierta', 'error'); return; }
      const subtotal = carrito.reduce((s, i) => { if (i.comboActivo && i.comboPrecio && i.comboUnidades >= 2) return s + window.calcularPrecioConCombo(i.qty, i.precio, i.comboPrecio, i.comboUnidades); if (i._precioBase !== undefined) return s + i._precioBase * i.qty; return s + i.precio * i.qty; }, 0);
      const itbisPct = config.itbisPct || 18;
      const itbisCliente = config.itbisCliente === true;
      const itbis = itbisCliente ? subtotal * (itbisPct / 100) : 0;
      const total = subtotal + itbis;
      document.getElementById('factura-items-lista').innerHTML = carrito.map(item => {
        const precioBase = item._precioBase || item.precio;
        const subtItem = (item.comboActivo && item.comboPrecio && item.comboUnidades >= 2 && item._precioBase === undefined)
          ? window.calcularPrecioConCombo(item.qty, item.precio, item.comboPrecio, item.comboUnidades)
          : precioBase * item.qty;
        const qtyLabel = esUnidadDetallable(item.unidad) ? `${item.qty.toFixed(2)} ${labelUnidad(item.unidad)}` : `x${item.qty}`;
        let qtyLabelCombo;
        const tieneComboModal = item.comboActivo && item.comboPrecio && item.comboUnidades >= 2 && item._precioBase === undefined;
        if (tieneComboModal) {
          const combos = Math.floor(item.qty / item.comboUnidades);
          const sueltas = item.qty % item.comboUnidades;
          const precioComboUd = item.comboPrecio / item.comboUnidades;
          if (combos > 0 && sueltas > 0) {
            qtyLabelCombo = `${combos * item.comboUnidades} uds x ${fmt(precioComboUd)} + ${sueltas} ud${sueltas > 1 ? 's' : ''} x ${fmt(item.precio)}`;
          } else if (combos > 0) {
            qtyLabelCombo = `${item.qty} uds x ${fmt(precioComboUd)}`;
          } else {
            qtyLabelCombo = `${item.qty} ud${item.qty !== 1 ? 's' : ''} x ${fmt(item.precio)}`;
          }
        } else {
          qtyLabelCombo = qtyLabel;
        }
        const precioEfectivo = tieneComboModal && item.qty > 0 ? subtItem / item.qty : precioBase;
        return `<div class="factura-item-row"><span class="fi-nombre">${item.nombre}</span><span class="fi-precio">${fmt(precioEfectivo)}</span><span class="fi-qty">${qtyLabelCombo}</span><span class="fi-precio">${fmt(subtItem)}</span></div>`;
      }).join('');
      document.getElementById('mfact-subtotal').textContent = fmt(subtotal);
      document.getElementById('mfact-itbis-lbl').textContent = `ITBIS (${itbisPct}%)`;
      document.getElementById('mfact-itbis').textContent = fmt(itbis);
      document.getElementById('mfact-total').textContent = fmt(total);
      const itbisRow = document.getElementById('mfact-itbis-row');
      if (itbisRow) itbisRow.style.display = itbisCliente ? '' : 'none';
      document.getElementById('monto-recibido').value = '';
      const _cd = document.getElementById('cambio-display'); _cd.style.display = 'flex'; _cd.style.background = 'rgb(248, 215, 218)'; document.getElementById('cambio-valor').textContent = 'RD$ 0.00';
      mixtoResetear();
      const sel = document.getElementById('fact-empleado');
      sel.innerHTML = empleadosCache.map(e => `<option value="${e.id}">${e.nombre}</option>`).join('');
      const myEmp = empleadosCache.find(e => e.uid === currentUser.uid);
      if (myEmp) sel.value = myEmp.id;
      seleccionarMetodo('efectivo');
      estadoFacturaSeleccionado = 'pagada'; // default: confirmar pago
      actualizarBtnConfirmar();
      abrirModal('modal-facturar');
    };

    window.seleccionarMetodo = (metodo) => {
      metodoPagoSeleccionado = metodo;
      const metodos = ['efectivo', 'transferencia', 'tarjeta', 'mixto'];
      document.querySelectorAll('.mpago-btn').forEach((b, i) => {
        b.classList.toggle('selected', metodos[i] === metodo);
      });
      const efectivoSec = document.getElementById('efectivo-section');
      const mixtoSec = document.getElementById('mixto-section');
      if (metodo === 'efectivo') {
        efectivoSec.classList.add('visible');
        if (mixtoSec) mixtoSec.style.display = 'none';
      } else if (metodo === 'mixto') {
        efectivoSec.classList.remove('visible');
        if (mixtoSec) { mixtoSec.style.display = 'block'; mixtoActivarCampo('efectivo'); mixtoActualizarResumen(); }
      } else {
        efectivoSec.classList.remove('visible');
        if (mixtoSec) mixtoSec.style.display = 'none';
      }
      actualizarBtnConfirmar();
    };

    // ==================== PAGO MIXTO (POS) ====================
    let _mixtoActivo = 'efectivo'; // campo activo en teclado
    let _mixtoEfStr = '';
    let _mixtoElecStr = '';
    let _mixtoSubMetodo = 'transferencia'; // 'transferencia' | 'tarjeta'

    window.mixtoSelSubMetodo = (sub) => {
      _mixtoSubMetodo = sub;
      document.getElementById('mixto-sub-trans').classList.toggle('activo', sub === 'transferencia');
      document.getElementById('mixto-sub-tarj').classList.toggle('activo', sub === 'tarjeta');
      const lbl = document.getElementById('mixto-elec-label');
      const resLbl = document.getElementById('mixto-res-elec-lbl');
      if (sub === 'transferencia') {
        if (lbl) lbl.textContent = '🏦 TRANSFERENCIA';
        if (resLbl) resLbl.textContent = '🏦 Transferencia';
      } else {
        if (lbl) lbl.textContent = '💳 TARJETA';
        if (resLbl) resLbl.textContent = '💳 Tarjeta';
      }
    };

    window.mixtoActivarCampo = (campo) => {
      _mixtoActivo = campo;
      const ef = document.getElementById('mixto-campo-efectivo');
      const elec = document.getElementById('mixto-campo-elec');
      if (ef) ef.classList.toggle('mixto-campo-activo', campo === 'efectivo');
      if (elec) elec.classList.toggle('mixto-campo-activo', campo === 'elec');
    };

    window.mixtoPonerResto = (campo) => {
      const carrito = getCarrito();
      const subtotal = carrito.reduce((s, i) => { if (i.comboActivo && i.comboPrecio && i.comboUnidades >= 2) return s + window.calcularPrecioConCombo(i.qty, i.precio, i.comboPrecio, i.comboUnidades); if (i._precioBase !== undefined) return s + i._precioBase * i.qty; return s + i.precio * i.qty; }, 0);
      const itbisPct = config.itbisPct || 18;
      const itbisCliente = config.itbisCliente === true;
      const total = subtotal * (1 + (itbisCliente ? itbisPct / 100 : 0));
      if (campo === 'efectivo') {
        const elec = parseFloat(_mixtoElecStr) || 0;
        const resto = Math.max(0, total - elec);
        _mixtoEfStr = resto.toFixed(2);
      } else {
        const ef = parseFloat(_mixtoEfStr) || 0;
        const resto = Math.max(0, total - ef);
        _mixtoElecStr = resto.toFixed(2);
      }
      mixtoActivarCampo(campo);
      _mixtoRefrescarDisplays();
      mixtoActualizarResumen();
    };

    window.mixtoTecla = (val) => {
      let str = _mixtoActivo === 'efectivo' ? _mixtoEfStr : _mixtoElecStr;
      if (val === '⌫') { str = str.slice(0, -1); }
      else if (val === '.') { if (!str.includes('.')) str += '.'; }
      else if (val === 'OK') { mixtoActualizarResumen(); return; }
      else { if (str.length < 10) str += val; }
      if (_mixtoActivo === 'efectivo') _mixtoEfStr = str;
      else _mixtoElecStr = str;
      _mixtoRefrescarDisplays();
      mixtoActualizarResumen();
    };

    function _mixtoRefrescarDisplays() {
      const dispEf = document.getElementById('mixto-display-efectivo');
      const dispEl = document.getElementById('mixto-display-elec');
      if (dispEf) dispEf.innerHTML = _mixtoEfStr ? `RD$ ${_mixtoEfStr}` : '<span class="placeholder">Toca para ingresar</span>';
      if (dispEl) dispEl.innerHTML = _mixtoElecStr ? `RD$ ${_mixtoElecStr}` : '<span class="placeholder">Toca para ingresar</span>';
    }

    function mixtoActualizarResumen() {
      const carrito = getCarrito();
      const subtotal = carrito.reduce((s, i) => { if (i.comboActivo && i.comboPrecio && i.comboUnidades >= 2) return s + window.calcularPrecioConCombo(i.qty, i.precio, i.comboPrecio, i.comboUnidades); if (i._precioBase !== undefined) return s + i._precioBase * i.qty; return s + i.precio * i.qty; }, 0);
      const itbisPct = config.itbisPct || 18;
      const itbisCliente = config.itbisCliente === true;
      const total = subtotal * (1 + (itbisCliente ? itbisPct / 100 : 0));
      const ef = parseFloat(_mixtoEfStr) || 0;
      const elec = parseFloat(_mixtoElecStr) || 0;
      const totalPagado = ef + elec;
      const cambio = totalPagado - total;
      document.getElementById('mixto-res-ef').textContent = fmt(ef);
      document.getElementById('mixto-res-elec').textContent = fmt(elec);
      document.getElementById('mixto-res-total').textContent = fmt(totalPagado);
      const cambioRow = document.getElementById('mixto-res-cambio-row');
      if (cambioRow) {
        cambioRow.style.display = 'flex';
        if (cambio >= 0) {
          cambioRow.className = 'mixto-resumen-row cambio-ok';
          cambioRow.innerHTML = `<span class="lbl">✅ Cambio</span><span class="val">${fmt(cambio)}</span>`;
        } else {
          cambioRow.className = 'mixto-resumen-row cambio-falta';
          cambioRow.innerHTML = `<span class="lbl">❌ Falta</span><span class="val">${fmt(Math.abs(cambio))}</span>`;
        }
      }
      // Botones resto
      const btnRE = document.getElementById('mixto-btn-resto-ef');
      const btnREl = document.getElementById('mixto-btn-resto-elec');
      const restoEf = Math.max(0, total - (parseFloat(_mixtoElecStr) || 0));
      const restoEl = Math.max(0, total - ef);
      if (btnRE) btnRE.textContent = `↑ ${fmt(restoEf)}`;
      if (btnREl) btnREl.textContent = `↑ ${fmt(restoEl)}`;
      actualizarBtnConfirmar();
    }

    function mixtoResetear() {
      _mixtoEfStr = '';
      _mixtoElecStr = '';
      _mixtoActivo = 'efectivo';
      _mixtoSubMetodo = 'transferencia';
      _mixtoRefrescarDisplays();
    }

    window.setEstadoFactura = (estado) => { estadoFacturaSeleccionado = estado; document.getElementById('btn-estado-pagada').classList.toggle('selected', estado === 'pagada'); document.getElementById('btn-estado-pendiente').classList.toggle('selected', estado === 'pendiente'); };

    // ==================== CONFIRMAR FACTURA — LÓGICA DEL BOTÓN VERDE ====================
    function _facturaListaParaPagar() {
      const carrito = getCarrito();
      const subtotal = carrito.reduce((s, i) => { if (i.comboActivo && i.comboPrecio && i.comboUnidades >= 2) return s + window.calcularPrecioConCombo(i.qty, i.precio, i.comboPrecio, i.comboUnidades); if (i._precioBase !== undefined) return s + i._precioBase * i.qty; return s + i.precio * i.qty; }, 0);
      const itbisPct = config.itbisPct || 18;
      const itbisCliente = config.itbisCliente === true;
      const total = subtotal * (1 + (itbisCliente ? itbisPct / 100 : 0));
      if (metodoPagoSeleccionado === 'efectivo') {
        const recibido = parseFloat(document.getElementById('monto-recibido')?.value) || 0;
        return recibido >= total;
      }
      if (metodoPagoSeleccionado === 'mixto') {
        const ef = parseFloat(_mixtoEfStr) || 0;
        const elec = parseFloat(_mixtoElecStr) || 0;
        return (ef > 0 || elec > 0) && (ef + elec) >= total;
      }
      // transferencia / tarjeta — siempre listo
      return (metodoPagoSeleccionado === 'transferencia' || metodoPagoSeleccionado === 'tarjeta');
    }

    window.actualizarBtnConfirmar = () => {
      const btn = document.getElementById('btn-confirmar-factura');
      if (!btn) return;
      if (_facturaListaParaPagar()) {
        btn.classList.add('listo');
      } else {
        btn.classList.remove('listo');
      }
    };

    window.procesarComoPendiente = async () => {
      estadoFacturaSeleccionado = 'pendiente';
      await confirmarFactura();
      // estadoFacturaSeleccionado se resetea a 'pagada' dentro de confirmarFactura()
    };

    function _facturaTotalActual() {
      return getCarrito().reduce((s, i) => s + (i._precioBase || i.precio) * i.qty, 0) * (1 + (config.itbisCliente === true ? (config.itbisPct || 18) / 100 : 0));
    }
    window.ponerMontoExacto = () => {
      const inp = document.getElementById('monto-recibido');
      if (!inp) return;
      inp.value = _facturaTotalActual().toFixed(2);
      calcularCambio();
    };
    window.calcularCambio = () => { const total = _facturaTotalActual(); const recibido = parseFloat(document.getElementById('monto-recibido').value) || 0; const cambio = recibido - total; const disp = document.getElementById('cambio-display'); disp.style.display = 'flex'; if (recibido > 0) { document.getElementById('cambio-valor').textContent = fmt(Math.max(0, cambio)); disp.style.background = cambio >= 0 ? '#d4edda' : '#f8d7da'; } else { document.getElementById('cambio-valor').textContent = 'RD$ 0.00'; disp.style.background = 'rgb(248, 215, 218)'; } actualizarBtnConfirmar(); };

    window.tecNumero = (val) => { const inp = document.getElementById('monto-recibido'); if (val === 'C') { inp.value = ''; } else if (val === '⌫') { inp.value = inp.value.slice(0, -1); } else if (val === 'OK') { calcularCambio(); return; } else { inp.value += val; } calcularCambio(); };

    window.confirmarFactura = async () => {
      // ── 1. Determinar estado ──────────────────────────────────────
      if (!estadoFacturaSeleccionado) estadoFacturaSeleccionado = 'pagada';
      const esPendiente = estadoFacturaSeleccionado === 'pendiente';

      // ── 2. Validaciones de carrito ────────────────────────────────
      const carrito = getCarrito();
      if (!carrito.length) {
        toast('El carrito está vacío', 'error');
        return;
      }

      // ── 3. Validaciones de pago (solo para facturas pagadas) ──────
      if (!esPendiente) {
        if (metodoPagoSeleccionado === 'efectivo') {
          const montoRec = parseFloat(document.getElementById('monto-recibido').value) || 0;
          if (montoRec <= 0) {
            toast('Ingresa el monto recibido en efectivo', 'error');
            return;
          }
          const subtotal = carrito.reduce((s, i) => { if (i.comboActivo && i.comboPrecio && i.comboUnidades >= 2) return s + window.calcularPrecioConCombo(i.qty, i.precio, i.comboPrecio, i.comboUnidades); if (i._precioBase !== undefined) return s + i._precioBase * i.qty; return s + i.precio * i.qty; }, 0);
          const itbisCliente = config.itbisCliente === true;
          const total = subtotal * (1 + (itbisCliente ? (config.itbisPct || 18) / 100 : 0));
          if (montoRec < total) {
            toast(`Monto insuficiente. El total es ${fmt(total)}`, 'error');
            return;
          }
        }
        if (metodoPagoSeleccionado === 'mixto') {
          const ef   = parseFloat(_mixtoEfStr)   || 0;
          const elec = parseFloat(_mixtoElecStr)  || 0;
          const subtotal = carrito.reduce((s, i) => { if (i.comboActivo && i.comboPrecio && i.comboUnidades >= 2) return s + window.calcularPrecioConCombo(i.qty, i.precio, i.comboPrecio, i.comboUnidades); if (i._precioBase !== undefined) return s + i._precioBase * i.qty; return s + i.precio * i.qty; }, 0);
          const itbisCliente = config.itbisCliente === true;
          const total = subtotal * (1 + (itbisCliente ? (config.itbisPct || 18) / 100 : 0));
          if (ef <= 0 && elec <= 0) {
            toast('Ingresa los montos del pago mixto', 'error');
            return;
          }
          if ((ef + elec) < total - 0.01) {
            toast(`El total pagado (${fmt(ef + elec)}) no cubre el monto de la factura (${fmt(total)})`, 'error');
            return;
          }
        }
      }

      // ── 4. Bloquear botones mientras se procesa ───────────────────
      const btnConfirmar = document.getElementById('btn-confirmar-factura');
      const btnPendiente = document.getElementById('btn-pago-pendiente');
      const btnCancelar  = document.getElementById('modal-facturar')?.querySelector('.btn-sm.gris');
      [btnConfirmar, btnPendiente].forEach(b => { if (b) { b.disabled = true; } });
      if (btnConfirmar) btnConfirmar.innerHTML = '<span class="loader"></span> Procesando...';
      if (btnPendiente) btnPendiente.innerHTML = '<span class="loader"></span> Guardando...';

      // ── MODO DE PRUEBA: simular factura sin guardar ni descontar stock ──
      if (modoPrueba) {
        const subtotal = carrito.reduce((s, i) => { if (i.comboActivo && i.comboPrecio && i.comboUnidades >= 2) return s + window.calcularPrecioConCombo(i.qty, i.precio, i.comboPrecio, i.comboUnidades); if (i._precioBase !== undefined) return s + i._precioBase * i.qty; return s + i.precio * i.qty; }, 0);
        const itbisPct = config.itbisPct || 18;
        const itbisCliente = config.itbisCliente === true;
        const itbis = itbisCliente ? subtotal * (itbisPct / 100) : 0;
        const total = subtotal + itbis;
        const numFactura = `PRUEBA-${Date.now()}`;
        const ncf = `${config.ncfPrefijo || 'B01'}${String(config.ncfSeq || 1).padStart(8, '0')}`;
        const notaDibujo = (signaturePad && !signaturePad.isEmpty()) ? signaturePad.toDataURL() : null;
        const direccionCliente = document.getElementById('pos-direccion-cliente')?.value.trim() || '';
        const empId = document.getElementById('fact-empleado')?.value || '';
        const empNombre = empleadosCache.find(e => e.id === empId)?.nombre || 'Sistema';
        const montoRecibido = metodoPagoSeleccionado === 'efectivo'
          ? (parseFloat(document.getElementById('monto-recibido').value) || total)
          : total;

        const facturaSimulada = {
          numero: numFactura, ncf,
          fecha: { toDate: () => new Date() },
          items: carrito.map(i => {
            const pb = i._precioBase || i.precio;
            const itemSubtotal = (i.comboActivo && i.comboPrecio && i.comboUnidades >= 2 && i._precioBase === undefined)
                ? window.calcularPrecioConCombo(i.qty, i.precio, i.comboPrecio, i.comboUnidades)
                : pb * i.qty;
            return { id: i.id, nombre: i.nombre, precio: pb, qty: i.qty, unidad: i.unidad || null,
              comboActivo: i.comboActivo || false, comboPrecio: i.comboPrecio || 0, comboUnidades: i.comboUnidades || 0,
              subtotal: itemSubtotal };
          }),
          subtotal, itbis, itbisPct, total,
          metodoPago: metodoPagoSeleccionado,
          montoRecibido,
          estado: estadoFacturaSeleccionado,
          empleadoId: empId, empleadoNombre: empNombre,
          cajaId: cajaActual?.id || '',
          uid: currentUser?.uid || '',
          dibujoNota: notaDibujo,
          ...(direccionCliente ? { direccionCliente } : {}),
          ...(metodoPagoSeleccionado === 'mixto' ? {
            mixtoEfectivo: parseFloat(_mixtoEfStr) || 0,
            mixtoElectronico: parseFloat(_mixtoElecStr) || 0,
            mixtoSubMetodo: _mixtoSubMetodo
          } : {})
        };

        // Cerrar modal y limpiar sin tocar Firebase ni stock
        cerrarModal('modal-facturar');
        const tabActual = _getTabActiva();
        if (tabActual) { tabActual.carrito = []; tabActual.direccion = ''; tabActual.dibujoDataURL = null; _guardarDibujoTab(tabActual.id, null); }
        _guardarTabsEnStorage();
        const dirInput = document.getElementById('pos-direccion-cliente');
        if (dirInput) dirInput.value = '';
        if (signaturePad) signaturePad.clear();
        dibujoDataURL = null;
        const montoInput = document.getElementById('monto-recibido');
        if (montoInput) montoInput.value = '';
        const cambioDisp = document.getElementById('cambio-display');
        if (cambioDisp) cambioDisp.style.display = 'none';
        estadoFacturaSeleccionado = 'pagada';
        metodoPagoSeleccionado = 'efectivo';
        _mixtoEfStr = ''; _mixtoElecStr = '';
        renderCarrito(); renderFacturasTabs();

        facturaActualParaImprimir = { ...facturaSimulada, id: 'prueba' };
        mostrarTicket(facturaActualParaImprimir);
        toast('🧪 Factura de prueba generada (no guardada, stock sin cambios)', 'warning', 5000);

        if (btnConfirmar) { btnConfirmar.innerHTML = '<i class="fas fa-check"></i> Confirmar Factura'; btnConfirmar.disabled = false; }
        if (btnPendiente) { btnPendiente.innerHTML = '<i class="fas fa-clock"></i> Pago Pendiente'; btnPendiente.disabled = false; }
        return;
      }

      // ── Detección offline ANTES de operar ──────────────────────────
      const _offline = !navigator.onLine;

      try {
        // ── 5. Calcular totales ───────────────────────────────────────
        const subtotal = carrito.reduce((s, i) => { if (i.comboActivo && i.comboPrecio && i.comboUnidades >= 2) return s + window.calcularPrecioConCombo(i.qty, i.precio, i.comboPrecio, i.comboUnidades); if (i._precioBase !== undefined) return s + i._precioBase * i.qty; return s + i.precio * i.qty; }, 0);
        const itbisPct = config.itbisPct || 18;
        const itbisCliente = config.itbisCliente === true;
        const itbis = itbisCliente ? subtotal * (itbisPct / 100) : 0;
        const total = subtotal + itbis;

        // ── 6. Datos de empleado y NCF ────────────────────────────────
        const empId = document.getElementById('fact-empleado')?.value || '';
        const empNombre = empleadosCache.find(e => e.id === empId)?.nombre || 'Sistema';
        const ncfSeq = config.ncfSeq || 1;
        const ncf = `${config.ncfPrefijo || 'B01'}${String(ncfSeq).padStart(8, '0')}`;
        const numFactura = `F-${Date.now()}`;
        const notaDibujo = (signaturePad && !signaturePad.isEmpty()) ? signaturePad.toDataURL() : null;
        const direccionCliente = document.getElementById('pos-direccion-cliente')?.value.trim() || '';
        const montoRecibido = metodoPagoSeleccionado === 'efectivo'
          ? (parseFloat(document.getElementById('monto-recibido').value) || total)
          : total;

        // ── 7. Construir objeto factura ───────────────────────────────
        const facturaData = {
          numero: numFactura,
          ncf,
          fecha: serverTimestamp(),
          items: carrito.map(i => {
            const pb = i._precioBase || i.precio;
            const itemSubtotal = (i.comboActivo && i.comboPrecio && i.comboUnidades >= 2 && i._precioBase === undefined)
                ? window.calcularPrecioConCombo(i.qty, i.precio, i.comboPrecio, i.comboUnidades)
                : pb * i.qty;
            return { id: i.id, nombre: i.nombre, precio: pb, qty: i.qty, unidad: i.unidad || null,
              comboActivo: i.comboActivo || false, comboPrecio: i.comboPrecio || 0, comboUnidades: i.comboUnidades || 0,
              subtotal: itemSubtotal };
          }),
          subtotal,
          itbis,
          itbisPct,
          total,
          metodoPago: metodoPagoSeleccionado,
          montoRecibido,
          estado: estadoFacturaSeleccionado,
          empleadoId: empId,
          empleadoNombre: empNombre,
          cajaId: cajaActual?.id || '',
          uid: currentUser?.uid || '',
          dibujoNota: notaDibujo,
          ...(direccionCliente ? { direccionCliente } : {}),
          ...(metodoPagoSeleccionado === 'mixto' ? {
            mixtoEfectivo: parseFloat(_mixtoEfStr) || 0,
            mixtoElectronico: parseFloat(_mixtoElecStr) || 0,
            mixtoSubMetodo: _mixtoSubMetodo
          } : {})
        };

        // ── 8. Guardar en Firestore (offline-safe con _fsOp) ──────────
        let factRef;
        if (esPendiente) {
          factRef = await _fsOp(() => addDoc(collection(db, 'negocios', negocioId, 'facturas-pendientes'), facturaData));
        } else {
          factRef = await _fsOp(() => addDoc(collection(db, 'negocios', negocioId, 'facturas'), facturaData));
          // Movimiento de caja y actualización de saldo (encolados offline automáticamente)
          _fsOp(() => addDoc(collection(db, 'negocios', negocioId, 'movimientos'), {
            tipo: 'ingreso',
            descripcion: `Venta ${numFactura}`,
            monto: total,
            fecha: serverTimestamp(),
            uid: currentUser?.uid || '',
            empleadoNombre: empNombre,
            facturaId: factRef.id,
            cajaId: cajaActual?.id || ''
          }));
          if (cajaActual?.id) {
            cajaActual.ingresos = (cajaActual.ingresos || 0) + total;
            _fsOp(() => updateDoc(doc(db, 'negocios', negocioId, 'caja', cajaActual.id), {
              ingresos: cajaActual.ingresos
            }));
          }
        }

        // ── 9. Actualizar NCF (local inmediato + Firestore en cola) ───
        config.ncfSeq = ncfSeq + 1;
        _fsOp(() => updateDoc(doc(db, 'negocios', negocioId, 'configuraciones', 'general'), { ncfSeq: config.ncfSeq }));

        // ── 10. Descontar stock localmente y encolar en Firestore ──────
        const batch = writeBatch(db);
        for (const item of carrito) {
          if (!item.categoriaId || !item.id) continue;
          const prodRef = doc(db, 'negocios', negocioId, 'categorias', item.categoriaId, 'productos', item.id);
          const nuevoStock = Math.max(0, (item.stock || 0) - item.qty);
          batch.update(prodRef, { stock: nuevoStock });
          // Actualizar array local inmediatamente para que la UI refleje el cambio
          const pi = productos.findIndex(p => p.id === item.id);
          if (pi >= 0) productos[pi].stock = nuevoStock;
        }
        _fsOp(() => batch.commit()); // No await — encolar sin bloquear

        // ── 11. Cerrar modal y limpiar carrito ────────────────────────
        cerrarModal('modal-facturar');

        const tabActual = _getTabActiva();
        if (tabActual) {
          tabActual.carrito = [];
          tabActual.direccion = '';
          tabActual.dibujoDataURL = null;
          _guardarDibujoTab(tabActual.id, null);
        }
        _guardarTabsEnStorage();

        const dirInput = document.getElementById('pos-direccion-cliente');
        if (dirInput) dirInput.value = '';
        if (signaturePad) signaturePad.clear();
        dibujoDataURL = null;
        const montoInput = document.getElementById('monto-recibido');
        if (montoInput) montoInput.value = '';
        const cambioDisp = document.getElementById('cambio-display');
        if (cambioDisp) cambioDisp.style.display = 'none';

        estadoFacturaSeleccionado = 'pagada';
        metodoPagoSeleccionado = 'efectivo';
        _mixtoEfStr = '';
        _mixtoElecStr = '';

        renderCarrito();
        renderFacturasTabs();

        // ── 12. Mostrar ticket y notificación ─────────────────────────
        facturaActualParaImprimir = { ...facturaData, id: factRef.id, fecha: { toDate: () => new Date() } };
        mostrarTicket(facturaActualParaImprimir);

        if (_offline) {
          const tipoMsgOffline = esPendiente
            ? '📱 Factura pendiente guardada localmente — se sincronizará con Firebase al volver la conexión'
            : '📱 Factura guardada localmente con éxito — se sincronizará con Firebase al volver la conexión';
          toast(tipoMsgOffline, 'warning', 6000);
        } else {
          const tipoMsg = esPendiente ? '⏳ Factura guardada como pago pendiente' : '✅ Factura procesada exitosamente';
          toast(tipoMsg, 'success', 4000);
        }

      } catch (e) {
        console.error('Error al procesar factura:', e);
        toast('Error al procesar la factura: ' + (e.message || 'Error desconocido'), 'error', 5000);
      } finally {
        // ── 13. Siempre restaurar botones de inmediato ────────────────
        if (btnConfirmar) {
          btnConfirmar.innerHTML = '<i class="fas fa-check"></i> Confirmar Factura';
          btnConfirmar.disabled = false;
        }
        if (btnPendiente) {
          btnPendiente.innerHTML = '<i class="fas fa-clock"></i> Pago Pendiente';
          btnPendiente.disabled = false;
        }
      }
    };

    function mostrarTicket(factura) { const body = document.getElementById('modal-ticket-body'); body.innerHTML = generarHTMLTicket(factura); abrirModal('modal-ticket'); }

    function generarHTMLTicket(factura) {
      const fecha = factura.fecha?.toDate ? factura.fecha.toDate() : new Date();
      let dibujoHtml = '';
      if (factura.dibujoNota) {
        dibujoHtml = `<div style="margin-top:12px; border-top:1px dashed #ccc; padding-top:8px;"><strong>Nota:</strong><br><img src="${factura.dibujoNota}" style="max-width:100%; height:auto; border:1px solid #ddd; border-radius:8px; margin-top:6px;"></div>`;
      }
      // Método de pago — texto legible
      const metodoLabel = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', mixto: 'Mixto' }[factura.metodoPago] || factura.metodoPago;
      // Bloque de pago según método
      let pagoHtml = '';
      if (factura.estado === 'pendiente') {
        // Pago pendiente: solo mostrar "Pago pendiente" como método, sin recibido ni cambio
        pagoHtml = `<div class="ticket-row" style="padding:0px 8px 0px 0px;"><span>Método</span><span>Pago pendiente</span></div>`;
      } else {
        pagoHtml = `<div class="ticket-row" style="padding:0px 8px 0px 0px;"><span>Método</span><span>${metodoLabel}</span></div>`;
        if (factura.metodoPago === 'efectivo') {
          pagoHtml += `<div class="ticket-row"  style="padding:0px 8px 0px 0px;"><span>Recibido</span><span>${fmt(factura.montoRecibido)}</span></div><div class="ticket-row"  style="padding:0px 8px 0px 0px;"><span>Cambio</span><span>${fmt(Math.max(0, (factura.montoRecibido || 0) - factura.total))}</span></div>`;
        } else if (factura.metodoPago === 'mixto') {
          const subLbl = { transferencia: 'Transferencia', tarjeta: 'Tarjeta' }[factura.mixtoSubMetodo] || factura.mixtoSubMetodo || 'Electrónico';
          const cambioMixto = ((factura.mixtoEfectivo || 0) + (factura.mixtoElectronico || 0)) - factura.total;
          pagoHtml += `<div class="ticket-row"><span> Efectivo</span><span>${fmt(factura.mixtoEfectivo || 0)}</span></div><div class="ticket-row"><span>${subLbl}</span><span>${fmt(factura.mixtoElectronico || 0)}</span></div>`;
          if (cambioMixto > 0) pagoHtml += `<div class="ticket-row" style="padding:0px 8px 0px 0px;"><span>Cambio</span><span>${fmt(cambioMixto)}</span></div>`;
        } 
      }
      const itemsHtml = (factura.items || []).map(i => {
        const precioBase = i._precioBase || i.precio;
        const qty = i.qty;
        const subtotal = i.subtotal ?? (precioBase * qty);
        let qtyStr;
        if (i.unidad && esUnidadDetallable(i.unidad)) {
          qtyStr = `${parseFloat(qty).toFixed(2)} ${labelUnidad(i.unidad)} x ${fmt(precioBase)}`;
        } else if (i.comboActivo && i.comboPrecio && i.comboUnidades >= 2) {
          const combos = Math.floor(qty / i.comboUnidades);
          const sueltas = qty % i.comboUnidades;
          const precioComboUd = i.comboPrecio / i.comboUnidades;
          if (combos > 0 && sueltas > 0) {
            qtyStr = `Cant.: ${combos * i.comboUnidades} uds x ${precioComboUd.toFixed(2)} + ${sueltas} ud${sueltas > 1 ? 's' : ''} x ${i.precio.toFixed(2)}`;
          } else if (combos > 0) {
            qtyStr = `Cant.: ${qty} uds x ${precioComboUd.toFixed(2)}`;
          } else {
            qtyStr = `Cant.: ${qty} ud${qty !== 1 ? 's' : ''} x ${i.precio.toFixed(2)}`;
          }
        } else {
          qtyStr = `Cant.: ${qty} ud${qty !== 1 ? 's' : ''} x ${precioBase.toFixed(2)}`;
        }
        return `<div style="padding:2px 8px 2px 4px;border-bottom:1px dashed #e0e0e0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <span style="font-weight:700;font-size:12px;">${i.nombre}</span>
            <span style="font-family:monospace;font-size:12px;font-weight:700;white-space:nowrap;margin-left:8px;">${fmt(subtotal)}</span>
          </div>
          <div style="font-size:12px;color:#000;margin-top:1px;font-weight:400;">${qtyStr}</div>
        </div>`;
      }).join('');
      return `<div class="ticket">
        <div class="ticket-header">
          <div style="font-size:16px;font-weight:800;">${negocioData?.nombre || 'Colmado'}</div>
          <div>${negocioData?.direccion || ''}</div>
          <div>${negocioData?.telefono || ''}</div>
          ${negocioData?.rnc ? `<div>RNC: ${negocioData.rnc}</div>` : ''}
          <div style="margin-top:6px;">━━━━━━━━━━━━━━━━━━━━━━</div>
          <div>Factura: ${factura.numero}</div>
          ${factura.ncf ? `<div>NCF: ${factura.ncf}</div>` : ''}
          <div>${fecha.toLocaleString('es-DO')}</div>
          ${factura.direccionCliente ? `<div style="margin-top:4px;"><span style="font-weight:800;font-size:13px;">Dirección:</span><br><span style="font-size:16px;">${factura.direccionCliente}</span></div>` : ''}
        </div>
        <div style="margin:6px 4px 0;">
          <div style="font-size:11px;color:#999;letter-spacing:0.5px;">--------------------------------------</div>
          <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;padding:2px 8px 2px 0px;">
            <span>PRODUCTO</span><span>PRECIO</span>
          </div>
          <div style="font-size:11px;color:#999;letter-spacing:0.5px;">--------------------------------------</div>
          ${itemsHtml}
        </div>
        <div class="ticket-total">
          <div class="ticket-row" style="padding:0px 8px 0px 0px;"><span>Subtotal</span><span>${fmt(factura.subtotal)}</span></div>
          ${factura.itbis > 0 ? `<div class="ticket-row"style="padding:0px 8px 0px 0px;"><span>ITBIS (${factura.itbisPct}%)</span><span>${fmt(factura.itbis)}</span></div>` : ''}
          <div class="ticket-row" style="padding:0px 8px 0px 0px; font-size:16px;"><span>TOTAL</span><span>${fmt(factura.total)}</span></div>
          ${pagoHtml}
        </div>
        ${dibujoHtml}
        <div style="text-align:center;margin-top:12px;font-size:11px;">¡Gracias por su compra!</div>
      </div>`;
    }

    // ── Función interna de impresión via iframe (compatible con HTTP y HTTPS) ──
    function _imprimirContenido(content) {
      const estilos = `body{font-family:monospace;font-size:12px;max-width:300px;margin:0 auto;}.ticket-row{display:flex;justify-content:space-between;margin-bottom:4px;}.ticket-header{text-align:center;border-bottom:1px dashed #ccc;padding-bottom:8px;margin-bottom:8px;}.ticket-total{border-top:1px dashed #ccc;padding-top:6px;margin-top:6px;font-weight:700;}`;
      let iframe = document.getElementById('_print_iframe_hidden');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = '_print_iframe_hidden';
        iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;';
        document.body.appendChild(iframe);
      }
      const doc = iframe.contentWindow.document;
      doc.open();
      doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${estilos}</style></head><body>${content}</body></html>`);
      doc.close();
      setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); }, 300);
    }

    window.imprimirTicket = () => {
      _imprimirContenido(document.getElementById('modal-ticket-body').innerHTML);
    };

    window.imprimirFacturaActual = () => {
      _imprimirContenido(document.getElementById('modal-ver-factura-body').innerHTML);
    };

    window.nuevaVenta = () => {
      cerrarModal('modal-ticket');
      const tabActual = _getTabActiva();
      if (tabActual) { tabActual.carrito = []; tabActual.direccion = ''; tabActual.dibujoDataURL = null; _guardarTabsEnStorage(); }
      renderFacturasTabs(); renderCarrito(); categoriaActual = null; renderCategoriasPos();
      const dirInput = document.getElementById('pos-direccion-cliente');
      if (dirInput) dirInput.value = '';
    };

    window.abrirModalVaciarCarrito = () => { if (!getCarrito().length) { toast('El carrito ya está vacío', 'info'); return; } abrirModal('modal-vaciar-carrito'); };
    window.confirmarVaciarCarrito = () => {
      setCarrito([]);
      // Si solo queda una tab, renombrarla a "Factura 1"
      if (facturasTabs.length === 1) {
        facturasTabs[0].nombre = 'Factura 1';
        _guardarTabsEnStorage();
      }
      renderCarrito();
      cerrarModal('modal-vaciar-carrito');
      toast('Carrito vaciado', 'info');
    };

    // ==================== FACTURAS PAGE ====================
    let facturasTabActual = 'pendientes'; // 'pendientes' | 'pagadas'
    let facturasPendientesCache = [];

    // Cambiar tab visible
    window.switchFacturasTab = (tab) => {
      facturasTabActual = tab;
      const btnPend = document.getElementById('btn-tab-pendientes');
      const btnPag = document.getElementById('btn-tab-pagadas');
      if (tab === 'pendientes') {
        btnPend.style.background = '#f59f00';
        btnPend.style.borderColor = '#f59f00';
        btnPend.style.color = '#fff';
        btnPend.style.boxShadow = '0 2px 10px rgba(245,159,0,0.3)';
        btnPag.style.background = 'white';
        btnPag.style.borderColor = '#aab4c8';
        btnPag.style.color = '#4a5568';
        btnPag.style.boxShadow = 'none';
        renderTablaFacturas(filtrarCache(facturasPendientesCache));
      } else {
        btnPag.style.background = '#28a745';
        btnPag.style.borderColor = '#28a745';
        btnPag.style.color = '#fff';
        btnPag.style.boxShadow = '0 2px 10px rgba(40,167,69,0.3)';
        btnPend.style.background = 'white';
        btnPend.style.borderColor = '#aab4c8';
        btnPend.style.color = '#4a5568';
        btnPend.style.boxShadow = 'none';
        renderTablaFacturas(filtrarCache(facturasCache));
      }
    };

    function filtrarCache(lista) {
      const buscar = (document.getElementById('fact-buscar')?.value || '').toLowerCase();
      const metodo = document.getElementById('fact-metodo')?.value || '';
      const fechaIni = document.getElementById('fact-fecha-ini')?.value || '';
      const fechaFin = document.getElementById('fact-fecha-fin')?.value || '';
      return lista.filter(f => {
        if (buscar && !f.numero?.toLowerCase().includes(buscar)) return false;
        if (metodo && f.metodoPago !== metodo) return false;
        if (fechaIni || fechaFin) {
          const fecha = f.fecha?.toDate ? f.fecha.toDate() : null;
          if (!fecha) return false;
          if (fechaIni && fecha < new Date(fechaIni)) return false;
          if (fechaFin && fecha > new Date(fechaFin + 'T23:59:59')) return false;
        }
        return true;
      });
    }

    async function cargarFacturas() {
      // Cargar facturas pagadas
      const qPag = query(collection(db, 'negocios', negocioId, 'facturas'), orderBy('fecha', 'desc'), limit(100));
      const snapPag = await getDocs(qPag);
      facturasCache = snapPag.docs.map(d => ({ id: d.id, ...d.data() }));

      // Cargar facturas pendientes
      const qPend = query(collection(db, 'negocios', negocioId, 'facturas-pendientes'), orderBy('fecha', 'desc'), limit(100));
      const snapPend = await getDocs(qPend);
      facturasPendientesCache = snapPend.docs.map(d => ({ id: d.id, ...d.data() }));

      // Actualizar badge
      const badge = document.getElementById('badge-pendientes');
      if (badge) badge.textContent = facturasPendientesCache.length;

      // Render según tab activa
      if (facturasTabActual === 'pendientes') {
        renderTablaFacturas(filtrarCache(facturasPendientesCache));
      } else {
        renderTablaFacturas(filtrarCache(facturasCache));
      }
    }

    function renderTablaFacturas(facturas) {
      const tbody = document.getElementById('tbody-facturas');
      if (!tbody) return;
      const esPendientes = facturasTabActual === 'pendientes';
      if (!facturas.length) {
        tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><i class="fas fa-file-invoice"></i><p>${esPendientes ? 'Sin facturas pendientes' : 'Sin facturas pagadas'}</p></div></td></tr>`;
        return;
      }
      tbody.innerHTML = facturas.map(f => {
        const fechaObj = f.fecha?.toDate ? f.fecha.toDate() : null;
        const hora = fechaObj ? fechaObj.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', hour12: true }) : '-';
        const fecha = fechaObj ? fechaObj.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
        const accionPagar = esPendientes
          ? `<button class="btn-sm verde" onclick="abrirModalPagarPendiente('${f.id}')" style="padding:6px 12px;font-size:12px;margin-left:4px;display:inline-flex;align-items:center;gap:5px;"><i class="fas fa-cash-register"></i> Pagar factura</button>`
          : '';
        return `<tr>
          <td style="font-family:var(--font-mono);font-weight:700;">${f.numero || '-'}</td>
          <td style="font-size:12px;font-weight:700;color:#1a2135;">${f.direccionCliente || '-'}</td>
          <td style="font-family:var(--font-mono);font-size:12px;"><strong>${hora}</strong><br><span style="font-weight:400;color:#718096;">${fecha}</span></td>
          <td style="font-family:var(--font-mono);font-weight:700;">${fmt(f.total)}</td>
          <td>${f.metodoPago || '-'}</td>
          <td>${f.empleadoNombre || '-'}</td>
          <td style="font-family:var(--font-mono);font-size:11px;">${f.ncf || '-'}</td>
          <td><span class="badge ${esPendientes ? 'pendiente' : 'pagada'}">${esPendientes ? '⏳ Pendiente' : '✅ Pagada'}</span></td>
          <td>
            <button class="btn-sm gris" onclick="verFactura('${f.id}','${esPendientes ? 'pend' : 'pag'}')" style="padding:6px 10px;font-size:12px;"><i class="fas fa-eye"></i></button>
            ${accionPagar}
          </td>
        </tr>`;
      }).join('');
    }

    window.filtrarFacturas = () => {
      if (facturasTabActual === 'pendientes') {
        renderTablaFacturas(filtrarCache(facturasPendientesCache));
      } else {
        renderTablaFacturas(filtrarCache(facturasCache));
      }
    };

    window.limpiarFiltrosFacturas = () => {
      document.getElementById('fact-buscar').value = '';
      document.getElementById('fact-fecha-ini').value = '';
      document.getElementById('fact-fecha-fin').value = '';
      document.getElementById('fact-metodo').value = '';
      window.filtrarFacturas();
    };

    window.verFactura = (id, tipo) => {
      const lista = tipo === 'pend' ? facturasPendientesCache : facturasCache;
      const f = lista.find(f => f.id === id);
      if (!f) return;
      document.getElementById('modal-ver-factura-body').innerHTML = generarHTMLTicket(f);
      abrirModal('modal-ver-factura');
    };

    // ===== MODAL PAGAR FACTURA PENDIENTE =====
    let pfpFacturaId = null;
    let pfpMetodo = 'efectivo';
    let pfpMontoStr = '';

    window.abrirModalPagarPendiente = (id) => {
      pfpFacturaId = id;
      pfpMetodo = 'efectivo';
      pfpMontoStr = '';
      const f = facturasPendientesCache.find(x => x.id === id);
      if (!f) return;
      const infoEl = document.getElementById('pfp-info');
      infoEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:800;font-size:15px;color:#1a2135;">${f.numero || '-'}</div>
            <div style="color:#666;font-size:12px;">${f.fecha?.toDate ? f.fecha.toDate().toLocaleString('es-DO') : '-'} • ${f.empleadoNombre || '-'}</div>
          </div>
          <div style="font-family:var(--font-mono);font-weight:800;font-size:1.3rem;color:#00b341;">${fmt(f.total)}</div>
        </div>`;
      pfpActualizarDisplay();
      pfpSelMetodo('efectivo');
      pfpMixtoResetear();
      const cambioDis = document.getElementById('pfp-cambio-display');
      if (cambioDis) cambioDis.style.display = 'none';
      abrirModal('modal-pagar-factura-pendiente');
    };

    window.pfpSelMetodo = (metodo) => {
      pfpMetodo = metodo;
      const colores = { efectivo: '#28a745', transferencia: '#1971c2', tarjeta: '#6f42c1', mixto: '#e67700' };
      ['efectivo', 'transferencia', 'tarjeta', 'mixto'].forEach(m => {
        const btn = document.getElementById(`pfp-btn-${m}`);
        if (btn) {
          if (m === metodo) {
            btn.style.background = colores[m];
            btn.style.borderColor = colores[m];
            btn.style.color = 'white';
          } else {
            btn.style.background = '#e2e8f0';
            btn.style.borderColor = '#e2e8f0';
            btn.style.color = '#4a5568';
          }
        }
      });
      const sec = document.getElementById('pfp-efectivo-section');
      const mixtoSec = document.getElementById('pfp-mixto-section');
      if (sec) sec.style.display = metodo === 'efectivo' ? 'block' : 'none';
      if (mixtoSec) { mixtoSec.style.display = metodo === 'mixto' ? 'block' : 'none'; }
      if (metodo === 'mixto') { pfpMixtoActivar('efectivo'); pfpMixtoActualizarResumen(); }
    };

    // ==================== PAGO MIXTO (FACTURAS PENDIENTES) ====================
    let _pfpMixtoActivo = 'efectivo';
    let _pfpMixtoEfStr = '';
    let _pfpMixtoElecStr = '';
    let _pfpMixtoSub = 'transferencia';

    window.pfpMixtoSelSub = (sub) => {
      _pfpMixtoSub = sub;
      document.getElementById('pfp-sub-trans').classList.toggle('activo', sub === 'transferencia');
      document.getElementById('pfp-sub-tarj').classList.toggle('activo', sub === 'tarjeta');
      const lbl = document.getElementById('pfp-mixto-elec-lbl');
      const resLbl = document.getElementById('pfp-mx-res-el-lbl');
      if (sub === 'transferencia') { if (lbl) lbl.textContent = '🏦 TRANSFERENCIA'; if (resLbl) resLbl.textContent = '🏦 Transferencia'; }
      else { if (lbl) lbl.textContent = '💳 TARJETA'; if (resLbl) resLbl.textContent = '💳 Tarjeta'; }
    };

    window.pfpMixtoActivar = (campo) => {
      _pfpMixtoActivo = campo;
      document.getElementById('pfp-mixto-campo-ef').classList.toggle('mixto-campo-activo', campo === 'efectivo');
      document.getElementById('pfp-mixto-campo-elec').classList.toggle('mixto-campo-activo', campo === 'elec');
    };

    window.pfpMixtoResto = (campo) => {
      const f = facturasPendientesCache.find(x => x.id === pfpFacturaId);
      if (!f) return;
      const total = f.total;
      if (campo === 'efectivo') { const elec = parseFloat(_pfpMixtoElecStr) || 0; _pfpMixtoEfStr = Math.max(0, total - elec).toFixed(2); }
      else { const ef = parseFloat(_pfpMixtoEfStr) || 0; _pfpMixtoElecStr = Math.max(0, total - ef).toFixed(2); }
      pfpMixtoActivar(campo);
      _pfpMixtoRefrescar();
      pfpMixtoActualizarResumen();
    };

    window.pfpMixtoTecla = (val) => {
      let str = _pfpMixtoActivo === 'efectivo' ? _pfpMixtoEfStr : _pfpMixtoElecStr;
      if (val === '⌫') str = str.slice(0, -1);
      else if (val === '.') { if (!str.includes('.')) str += '.'; }
      else if (val === 'OK') { pfpMixtoActualizarResumen(); return; }
      else { if (str.length < 10) str += val; }
      if (_pfpMixtoActivo === 'efectivo') _pfpMixtoEfStr = str; else _pfpMixtoElecStr = str;
      _pfpMixtoRefrescar();
      pfpMixtoActualizarResumen();
    };

    function _pfpMixtoRefrescar() {
      const dE = document.getElementById('pfp-mixto-disp-ef');
      const dEl = document.getElementById('pfp-mixto-disp-el');
      if (dE) dE.innerHTML = _pfpMixtoEfStr ? `RD$ ${_pfpMixtoEfStr}` : '<span class="placeholder">Toca para ingresar</span>';
      if (dEl) dEl.innerHTML = _pfpMixtoElecStr ? `RD$ ${_pfpMixtoElecStr}` : '<span class="placeholder">Toca para ingresar</span>';
    }

    function pfpMixtoActualizarResumen() {
      const f = facturasPendientesCache.find(x => x.id === pfpFacturaId);
      if (!f) return;
      const ef = parseFloat(_pfpMixtoEfStr) || 0;
      const elec = parseFloat(_pfpMixtoElecStr) || 0;
      const tot = ef + elec;
      const cambio = tot - f.total;
      const rEf = document.getElementById('pfp-mx-res-ef');
      const rEl = document.getElementById('pfp-mx-res-el');
      const rTot = document.getElementById('pfp-mx-res-tot');
      const rCambio = document.getElementById('pfp-mx-cambio-row');
      if (rEf) rEf.textContent = fmt(ef);
      if (rEl) rEl.textContent = fmt(elec);
      if (rTot) rTot.textContent = fmt(tot);
      if (rCambio) {
        rCambio.style.display = 'flex';
        if (cambio >= 0) { rCambio.className = 'mixto-resumen-row cambio-ok'; rCambio.innerHTML = `<span class="lbl">✅ Cambio</span><span class="val">${fmt(cambio)}</span>`; }
        else { rCambio.className = 'mixto-resumen-row cambio-falta'; rCambio.innerHTML = `<span class="lbl">❌ Falta</span><span class="val">${fmt(Math.abs(cambio))}</span>`; }
      }
    }

    function pfpMixtoResetear() {
      _pfpMixtoEfStr = ''; _pfpMixtoElecStr = ''; _pfpMixtoActivo = 'efectivo'; _pfpMixtoSub = 'transferencia';
      _pfpMixtoRefrescar();
    }

    window.pfpTecla = (val) => {
      if (val === '⌫') {
        pfpMontoStr = pfpMontoStr.slice(0, -1);
      } else if (val === '.') {
        if (!pfpMontoStr.includes('.')) pfpMontoStr += '.';
      } else {
        if (pfpMontoStr.length < 10) pfpMontoStr += val;
      }
      pfpActualizarDisplay();
    };

    function pfpActualizarDisplay() {
      const val = parseFloat(pfpMontoStr) || 0;
      const disp = document.getElementById('pfp-monto-display');
      if (disp) disp.textContent = pfpMontoStr ? `RD$ ${pfpMontoStr}` : 'RD$ 0.00';
      // Calcular cambio
      const f = facturasPendientesCache.find(x => x.id === pfpFacturaId);
      if (f && val > 0) {
        const cambio = val - f.total;
        const cambioDis = document.getElementById('pfp-cambio-display');
        if (cambioDis) {
          cambioDis.style.display = 'block';
          if (cambio >= 0) {
            cambioDis.style.background = '#d4edda';
            cambioDis.style.color = '#155724';
            cambioDis.textContent = `✅ Cambio: ${fmt(cambio)}`;
          } else {
            cambioDis.style.background = '#f8d7da';
            cambioDis.style.color = '#721c24';
            cambioDis.textContent = `❌ Falta: ${fmt(Math.abs(cambio))}`;
          }
        }
      } else {
        const cambioDis = document.getElementById('pfp-cambio-display');
        if (cambioDis) cambioDis.style.display = 'none';
      }
    }

    window.confirmarPagarFacturaPendiente = async () => {
      if (!pfpFacturaId) return;
      const f = facturasPendientesCache.find(x => x.id === pfpFacturaId);
      if (!f) return;
      if (pfpMetodo === 'efectivo') {
        const montoRec = parseFloat(pfpMontoStr) || 0;
        if (montoRec <= 0) { toast('Ingresa el monto recibido en efectivo', 'error'); return; }
        if (montoRec < f.total) { toast('El monto recibido es menor al total', 'error'); return; }
      }
      if (pfpMetodo === 'mixto') {
        const ef = parseFloat(_pfpMixtoEfStr) || 0;
        const elec = parseFloat(_pfpMixtoElecStr) || 0;
        if (ef <= 0 && elec <= 0) { toast('Ingresa los montos del pago mixto', 'error'); return; }
        if ((ef + elec) < f.total) { toast('El total pagado no cubre el monto de la factura', 'error'); return; }
      }
      const btn = document.getElementById('btn-confirmar-pagar-pendiente');
      btn.innerHTML = '<span class="loader"></span> Procesando...';
      btn.disabled = true;
      const _offlinePfp = !navigator.onLine;
      try {
        const montoRec = pfpMetodo === 'efectivo' ? (parseFloat(pfpMontoStr) || f.total) : f.total;
        const cambio = pfpMetodo === 'efectivo' ? Math.max(0, montoRec - f.total) : 0;
        const empNombre = await getEmpNombre();
        const fechaPago = serverTimestamp();

        const facturaPageData = {
          ...f,
          id: undefined,
          estado: 'pagada',
          metodoPago: pfpMetodo,
          montoRecibido: montoRec,
          cambio,
          fechaPago,
          ...(pfpMetodo === 'mixto' ? {
            mixtoEfectivo: parseFloat(_pfpMixtoEfStr) || 0,
            mixtoElectronico: parseFloat(_pfpMixtoElecStr) || 0,
            mixtoSubMetodo: _pfpMixtoSub
          } : {})
        };
        delete facturaPageData.id;

        const newFactRef = await _fsOp(() => addDoc(collection(db, 'negocios', negocioId, 'facturas'), facturaPageData));
        _fsOp(() => deleteDoc(doc(db, 'negocios', negocioId, 'facturas-pendientes', pfpFacturaId)));

        if (cajaActual) {
          _fsOp(() => addDoc(collection(db, 'negocios', negocioId, 'movimientos'), {
            tipo: 'ingreso', descripcion: `Pago factura ${f.numero}`, monto: f.total,
            fecha: fechaPago, uid: currentUser.uid, empleadoNombre: empNombre,
            facturaId: newFactRef.id, cajaId: cajaActual.id
          }));
          let newIngresos = (cajaActual.ingresos || 0) + f.total;
          let newGastos = cajaActual.gastos || 0;
          if (pfpMetodo === 'efectivo' && cambio > 0) {
            _fsOp(() => addDoc(collection(db, 'negocios', negocioId, 'movimientos'), {
              tipo: 'gasto', descripcion: `Cambio devuelto factura ${f.numero}`, monto: cambio,
              fecha: fechaPago, uid: currentUser.uid, empleadoNombre: empNombre,
              facturaId: newFactRef.id, cajaId: cajaActual.id
            }));
            newGastos += cambio;
          }
          cajaActual.ingresos = newIngresos; cajaActual.gastos = newGastos;
          _fsOp(() => updateDoc(doc(db, 'negocios', negocioId, 'caja', cajaActual.id), { ingresos: newIngresos, gastos: newGastos }));
        }

        // Actualizar cache local de facturas pendientes
        const pfpIdx = facturasPendientesCache.findIndex(x => x.id === pfpFacturaId);
        if (pfpIdx >= 0) facturasPendientesCache.splice(pfpIdx, 1);

        cerrarModal('modal-pagar-factura-pendiente');
        toast(_offlinePfp ? '📱 Factura marcada como pagada localmente — se sincronizará con Firebase' : 'Factura pagada exitosamente ✅', _offlinePfp ? 'warning' : 'success', _offlinePfp ? 5000 : 4000);
        await cargarFacturas();
      } catch (e) {
        toast('Error: ' + e.message, 'error');
        console.error(e);
      }
      btn.innerHTML = '<i class="fas fa-check"></i> Confirmar Pago';
      btn.disabled = false;
    };

    // Mantener compatibilidad con marcarPagada (por si se llama desde algún lado)
    window.marcarPagada = (id) => window.abrirModalPagarPendiente(id);

    // ==================== INVENTARIO - NUEVA VERSIÓN CON BÚSQUEDA, DRAG TÁCTIL Y MOVER PRODUCTO ENTRE CATEGORÍAS ====================
    function _actualizarBtnCatAccion(modo, catId) {
      const btn = document.getElementById('btn-cat-accion');
      if (!btn) return;
      if (modo === 'lista') {
        btn.className = 'btn-sm verde';
        btn.onclick = abrirModalCategoria;
        btn.innerHTML = '<i class="fas fa-folder-plus"></i> Categoría';
      } else if (modo === 'categoria') {
        btn.className = 'btn-sm amarillo';
        btn.onclick = () => editarCategoria(catId);
        btn.innerHTML = '<i class="fas fa-edit"></i> Editar categoría';
      } else if (modo === 'masvendidos') {
        btn.className = 'btn-sm amarillo';
        btn.onclick = (e) => editarImagenMasVendidos(e);
        btn.innerHTML = '<i class="fas fa-image"></i> Editar imagen';
      }
    }

    function _recalcularInvStats() {
      let total = 0, unidades = 0, dinero = 0;
      const porCategoria = {};
      for (const p of productos) {
        total++;
        const catId = p.categoriaId;
        if (!porCategoria[catId]) porCategoria[catId] = { total: 0, unidades: 0, dinero: 0 };
        porCategoria[catId].total++;
        if (p.stockHabilitado !== false && p.stock > 0) {
          const stock = parseFloat(p.stock) || 0;
          const valor = parseFloat(p.costo) > 0 ? parseFloat(p.costo) : parseFloat(p.precio) || 0;
          unidades += stock;
          dinero += valor * stock;
          porCategoria[catId].unidades += stock;
          porCategoria[catId].dinero += valor * stock;
        }
      }
      _invStats = { total, unidades, dinero, porCategoria };
    }

    function renderInventario() {
      const fmtUds = v => v % 1 === 0 ? String(v) : v.toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      const elTotalProds = document.getElementById('inv-stat-total-prods');
      const elDinero = document.getElementById('inv-stat-dinero');
      if (elTotalProds) elTotalProds.innerHTML = `${_invStats.total} <span style="font-size:0.75rem;font-weight:600;color:#16a34a;background:#dcfce7;border-radius:20px;padding:2px 8px;vertical-align:middle;">${fmtUds(_invStats.unidades)} uds en stock</span>`;
      if (elDinero) elDinero.textContent = 'RD$ ' + _invStats.dinero.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      if (inventarioCategoriaActual === '__mas_vendidos__') {
        renderMasVendidosInventario();
      } else if (inventarioCategoriaActual) {
        renderProductosInventario(inventarioCategoriaActual, inventarioBusquedaActual);
      } else {
        renderCategoriasInventario();
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

    // Soporte táctil para drag & drop
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

    // ===== MÁS VENDIDOS INVENTARIO: imagen de fondo editable =====
    window.editarImagenMasVendidos = (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        try {
          const dataUrl = await comprimirImagen(file, 400, 0.92);
          const url = await subirImagenBase64(dataUrl, `negocios/${negocioId}/mas_vendidos_bg_${Date.now()}`);
          // Guardar en Firestore (campo en el negocio)
          await updateDoc(doc(db, 'negocios', negocioId), { masVendidosBg: url });
          negocioData.masVendidosBg = url;
          renderInventario();
          renderCategoriasPos(); // actualizar imagen en el POS también
          toast('Imagen de Más Vendidos actualizada', 'success');
        } catch (err) { toast('Error subiendo imagen: ' + err.message, 'error'); }
      };
      input.click();
    };

    function renderMasVendidosInventario() {
      _actualizarBtnCatAccion('masvendidos');
      const area = document.getElementById('inv-contenido');
      if (!area) return;
      const masVendidosProds = productos.filter(p => p.masVendidos);
      masVendidosProds.sort((a, b) => (a.ordenMV ?? a.orden ?? 9999) - (b.ordenMV ?? b.orden ?? 9999));

      const header = `<div class="productos-header-inv">
        <button class="back-btn" onclick="volverCategoriasInventario()"><i class="fas fa-arrow-left"></i> Categorías</button>
        <strong>⭐ Más Vendidos</strong>
        <span style="font-size:12px;color:#888;margin-left:8px;">${masVendidosProds.length} producto${masVendidosProds.length !== 1 ? 's' : ''}</span>
        <span style="font-size:11px;color:#aaa;margin-left:8px;">Activa "Ordenar" para reorganizar</span>
      </div>`;

      if (!masVendidosProds.length) {
        area.innerHTML = header + `<div class="empty-state"><i class="fas fa-star"></i><p>No hay productos marcados como Más Vendidos.<br>Edita un producto y activa el toggle "⭐ Más Vendidos".</p></div>`;
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'productos-grid-inv' + (modoOrdenActivo ? ' modo-orden' : '');
      grid.id = 'prod-drag-grid';

      const attachMVDragEvents = (card, prod) => {
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
          newOrder.forEach((id, i) => { const p = productos.find(x => x.id === id); if (p) p.ordenMV = i + 1; });
          [...grid.children].forEach((c, i) => {
            const badge = c.querySelector('.orden-badge');
            if (badge) badge.textContent = i + 1;
          });
          await guardarOrdenMasVendidos(newOrder);
        });
        attachTouchDrag(card, prod.id, 'prod', grid);
      };

      masVendidosProds.forEach((p, index) => {
        const stockHab = p.stockHabilitado !== false;
        const sinStock = stockHab && p.stock <= 0;
        const bajoStock = stockHab && p.stock > 0 && p.stock <= (p.stockMin || 5);
        const stockValDisplay = stockHab ? fmtNum(p.stock || 0) : '∞';
        const card = document.createElement('div');
        card.className = `prod-card-inv${sinStock ? ' sin-stock' : ''}`;
        card.draggable = modoOrdenActivo;
        card.dataset.id = p.id;
        card.innerHTML = `
          <span class="orden-badge" style="background:#e67700;">${index + 1}</span>
          <div class="drag-grip-overlay"><i class="fas fa-grip-lines"></i></div>
          <div class="img-producto-inv" style="position:relative;">
            ${p.imagen ? `<img src="${p.imagen}" alt="${p.nombre}" loading="lazy" onerror="this.outerHTML='<div class=&quot;prod-emoji-inv&quot;><i class=&quot;fas fa-shopping-cart&quot;></i></div>'" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">` : `<div class="prod-emoji-inv"><i class="fas fa-shopping-cart"></i></div>`}
            ${p.pesoNeto ? `<span class="peso-neto-badge">${escapeHtml(p.pesoNeto)}</span>` : ''}
          </div>
          <div class="prod-info-inv">
            <div class="prod-nombre-inv">${escapeHtml(p.nombre || '')}</div>
            ${p.codigoBarras ? `<div class="prod-codigo-inv">${escapeHtml(p.codigoBarras)}</div>` : ''}
            <div class="prod-precios-inv"><span class="precio-venta">${fmt(p.precio)}</span>${p.costo ? `<span class="precio-costo">Costo: ${fmt(p.costo)}</span>` : ''}</div>
            <div class="prod-stock-inv ${bajoStock ? 'bajo' : ''} ${sinStock ? 'sin' : ''}">Stock: ${stockValDisplay} ${p.unidad || ''}</div>
          </div>`;
        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
          if (modoOrdenActivo) return;
          if (e.target.closest('.drag-grip-overlay')) return;
          editarProducto(p.id);
        });
        attachMVDragEvents(card, p);
        grid.appendChild(card);
      });

      area.innerHTML = header;
      area.appendChild(grid);
    }

    async function guardarOrdenMasVendidos(newOrder) {
      const indicator = document.getElementById('guardando-orden-indicator');
      if (indicator) indicator.classList.add('visible');
      try {
        const batch = writeBatch(db);
        newOrder.forEach((id, i) => {
          const p = productos.find(x => x.id === id);
          if (p && p.categoriaId) {
            batch.update(doc(db, 'negocios', negocioId, 'categorias', p.categoriaId, 'productos', id), { ordenMV: i + 1 });
          }
        });
        await batch.commit();
      } catch (e) {
        toast('Error guardando orden: ' + e.message, 'error');
      } finally {
        if (indicator) setTimeout(() => indicator.classList.remove('visible'), 1400);
      }
    }
    // ===== FIN MÁS VENDIDOS INVENTARIO =====

    function renderCategoriasInventario() {
      _actualizarBtnCatAccion('lista');
      const area = document.getElementById('inv-contenido');
      if (!area) return;
      if (!categorias.length) {
        area.innerHTML = `<div class="empty-state"><i class="fas fa-folder-open"></i><p>No hay categorías creadas.<br>Haz clic en "Categoría" para agregar.</p></div>`;
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

      // Tarjeta especial "Más Vendidos" al inicio del grid
      const mvCard = document.createElement('div');
      mvCard.className = 'cat-card-inv mv-inv-card';
      mvCard.dataset.id = '__mas_vendidos__';
      const mvCount = productos.filter(p => p.masVendidos).length;
      const mvBg = negocioData?.masVendidosBg || './img/backgrounds/masvendidos_1.jpg';
      mvCard.innerHTML = `
        <div class="drag-grip-overlay" style="display:none;"></div>
        ${mvBg ? `<img src="${mvBg}" alt="Más Vendidos" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px 10px 0 0;display:block;" onerror="this.src='./img/backgrounds/masvendidos_1.jpg'">` : `<div style="width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:52px;background:linear-gradient(135deg,#f59f00,#e67700);border-radius:10px 10px 0 0;">⭐</div>`}
        <div class="cat-info-inv">
          <div class="cat-nombre-inv" style="color:#e67700;">⭐ Más Vendidos</div>
          <div class="cat-stats-inv">${mvCount} producto${mvCount !== 1 ? 's' : ''} destacados</div>
        </div>`;
      mvCard.style.cursor = 'pointer';
      mvCard.style.border = '2px solid #f59f00';
      mvCard.style.boxShadow = '0 4px 16px rgba(245,159,0,0.25)';
      mvCard.addEventListener('click', (e) => {
        if (modoOrdenActivo) return;
        if (e.target.closest('.cat-actions-inv')) return;
        inventarioCategoriaActual = '__mas_vendidos__';
        renderInventario();
      });
      grid.appendChild(mvCard);

      categorias.forEach((cat, index) => {
        const card = document.createElement('div');
        card.className = 'cat-card-inv';
        card.draggable = modoOrdenActivo;
        card.dataset.id = cat.id;

        const imgHtml = cat.imagen
          ? `<img src="${cat.imagen}" alt="${cat.nombre}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px 10px 0 0;display:block;" onerror="this.style.display='none'">`
          : `<span class="cat-emoji-inv">${cat.emoji || '📦'}</span>`;

        card.innerHTML = `
          <span class="orden-badge">${index + 1}</span>
          <div class="drag-grip-overlay"><i class="fas fa-grip-lines"></i></div>
          ${imgHtml}
          <div class="cat-info-inv">
            <div class="cat-nombre-inv">${cat.nombre}</div>
            <div class="cat-stats-inv">${productos.filter(p => p.categoriaId === cat.id).length} productos</div>
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
      _actualizarBtnCatAccion('categoria', categoriaId);
      const area = document.getElementById('inv-contenido');
      const categoria = categorias.find(c => c.id === categoriaId);
      let prods = productos.filter(p => p.categoriaId === categoriaId);
      if (busqueda) prods = prods.filter(p => p.nombre?.toLowerCase().includes(busqueda.toLowerCase()) || (p.codigoBarras || '').includes(busqueda));
      if (!area) return;

      // Stats de la categoría — leer del caché, sin recalcular
      const cs = _invStats.porCategoria[categoriaId] || { total: 0, unidades: 0, dinero: 0 };
      const fmtUdsCat = v => v % 1 === 0 ? String(v) : v.toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      const catTotalProds = cs.total;
      const catTotalUnidades = cs.unidades;
      const catDinero = cs.dinero;
      const catStatsHtml = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 14px 0;">
        <div style="display:flex;align-items:center;gap:8px;background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:10px;padding:8px 14px;flex:1;min-width:140px;">
          <span style="font-size:1.3rem;">📦</span>
          <div>
            <div style="font-size:10px;color:#166534;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;">Productos</div>
            <div style="font-size:1.15rem;font-weight:800;color:#15803d;">${catTotalProds} <span style="font-size:0.72rem;font-weight:600;background:#dcfce7;color:#16a34a;border-radius:20px;padding:1px 7px;">${fmtUdsCat(catTotalUnidades)} uds</span></div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:10px;padding:8px 14px;flex:1;min-width:140px;">
          <span style="font-size:1.3rem;">💰</span>
          <div>
            <div style="font-size:10px;color:#1e40af;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;">Invertido</div>
            <div style="font-size:1.15rem;font-weight:800;color:#1d4ed8;">RD$ ${catDinero.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
        </div>
      </div>`;

      const header = `<div class="productos-header-inv"><div><button class="back-btn" onclick="volverCategoriasInventario()"><i class="fas fa-arrow-left"></i> Categorías</button></div><div style="text-align: center; width: 140px;"><strong>${categoria?.nombre || 'Productos'}</strong></div><div><button class="btn-sm verde" onclick="abrirModalProductoDesdeCategoria('${categoriaId}')" style="margin-left:auto;"><i class="fas fa-plus"></i> Producto</button></div></div>` + catStatsHtml;

      if (!prods.length) {
        area.innerHTML = header + `<div class="empty-state"><i class="fas fa-box-open"></i><p>No hay productos en esta categoría</p></div>`;
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
        const stockHab = p.stockHabilitado !== false;
        const sinStock = stockHab && p.stock <= 0;
        const bajoStock = stockHab && p.stock > 0 && p.stock <= (p.stockMin || 5);
        const stockValDisplay = stockHab ? fmtNum(p.stock || 0) : '∞';
        const card = document.createElement('div');
        card.className = `prod-card-inv${sinStock ? ' sin-stock' : ''}`;
        card.draggable = modoOrdenActivo;
        card.dataset.id = p.id;

        const nombreResaltado = resaltarTextoInv(p.nombre || '', busqueda);
        const barcodeResaltado = p.codigoBarras ? resaltarTextoInv(p.codigoBarras, busqueda) : '';

        card.innerHTML = `
          <span class="orden-badge" style="background:#00b341;">${index + 1}</span>
          <div class="drag-grip-overlay"><i class="fas fa-grip-lines"></i></div>
          <div class="img-producto-inv" style="position:relative;">
            ${p.imagen ? `<img src="${p.imagen}" alt="${p.nombre}" loading="lazy" onerror="this.outerHTML='<div class=&quot;prod-emoji-inv&quot;><i class=&quot;fas fa-shopping-cart&quot;></i></div>'" style="">` : `<div class="prod-emoji-inv"><i class="fas fa-shopping-cart"></i></div>`}
            ${p.pesoNeto ? `<span class="peso-neto-badge">${escapeHtml(p.pesoNeto)}</span>` : ''}
          </div>
          <div class="prod-info-inv">
            <div class="prod-nombre-inv">${nombreResaltado}</div>
            ${p.codigoBarras ? `<div class="prod-codigo-inv">${barcodeResaltado}</div>` : ''}
            <div class="prod-precios-inv"><span class="precio-venta">${fmt(p.precio)}</span>${p.costo ? `<span class="precio-costo">Costo: ${fmt(p.costo)}</span>` : ''}</div>
            <div class="prod-stock-inv ${bajoStock ? 'bajo' : ''} ${sinStock ? 'sin' : ''}">Stock: ${stockValDisplay} ${p.unidad || ''}</div>
            ${p.masVendidos ? `<div class="prod-actions-inv"><span style="font-size:10px;background:#fff3bf;color:#e67700;border-radius:20px;padding:2px 8px;font-weight:700;">⭐ Más Vendidos</span></div>` : ''}
          </div>`;

        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
          if (modoOrdenActivo) return;
          if (e.target.closest('.drag-grip-overlay')) return;
          editarProducto(p.id);
        });

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

    window.filtrarInventarioBusqueda = (texto) => {
      inventarioBusquedaActual = texto;
      const dropdown = document.getElementById('inv-buscar-dropdown');

      if (!texto || texto.length < 1) {
        if (dropdown) dropdown.style.display = 'none';
        renderInventario();
        return;
      }

      // Buscar en todos los productos
      const q = texto.toLowerCase();
      const found = productos.filter(p => p.nombre?.toLowerCase().includes(q) || (p.codigoBarras || '').includes(q));

      if (dropdown) {
        if (!found.length) {
          dropdown.style.display = 'block';
          dropdown.innerHTML = `<div style="padding:14px 16px;color:var(--gris-suave);font-size:14px;text-align:center;">Sin resultados para "<strong>${escapeHtml(texto)}</strong>"</div>`;
        } else {
          dropdown.style.display = 'block';
          dropdown.innerHTML = found.slice(0, 12).map(p => {
            const cat = categorias.find(c => c.id === p.categoriaId);
            const nombreH = resaltarTextoInv(p.nombre || '', texto);
            const stockHab = p.stockHabilitado !== false;
            const sinStock = stockHab && p.stock <= 0;
            const stockTxt = !stockHab ? '∞' : (sinStock ? '<span style="color:#e03131">Sin stock</span>' : `Stock: ${fmtNum(p.stock)}`);
            return `<div class="inv-search-item" onclick="irAProductoInventario('${p.categoriaId}','${p.id}')" style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;border-bottom:1px solid #f0f0f0;transition:background 0.15s;" onmouseover="this.style.background='#f8f9ff'" onmouseout="this.style.background=''">
              ${p.imagen ? `<img src="${p.imagen}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;flex-shrink:0;" onerror="this.outerHTML='<span style=&quot;font-size:22px&quot;>📦</span>'">` : `<span style="font-size:22px">📦</span>`}
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${nombreH}</div>
                <div style="font-size:11px;color:var(--gris-suave);">${cat ? cat.nombre : ''} • ${stockTxt}</div>
              </div>
              <div style="font-weight:700;color:#00b341;font-size:13px;flex-shrink:0;">${fmt(p.precio)}</div>
            </div>`;
          }).join('') + (found.length > 12 ? `<div style="padding:10px 14px;font-size:12px;color:var(--gris-suave);text-align:center;">+${found.length - 12} más resultados</div>` : '');
        }
      }
    };

    window.irAProductoInventario = (catId, prodId) => {
      const dropdown = document.getElementById('inv-buscar-dropdown');
      if (dropdown) dropdown.style.display = 'none';
      document.getElementById('inv-buscar').value = '';
      inventarioBusquedaActual = '';
      inventarioCategoriaActual = catId;
      renderInventario();
      // Resaltar el producto después de un tick
      setTimeout(() => {
        const card = document.querySelector(`[data-id="${prodId}"]`);
        if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.style.transition = 'box-shadow 0.3s'; card.style.boxShadow = '0 0 0 3px #1971c2'; setTimeout(() => { card.style.boxShadow = ''; }, 1800); }
      }, 100);
    };

    // Cerrar dropdown al hacer click fuera
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('inv-buscar-dropdown');
      const input = document.getElementById('inv-buscar');
      if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
        dropdown.style.display = 'none';
      }
    });

    window.abrirModalProductoDesdeCategoria = (categoriaId) => {
      productoEnEdicion = null;
      document.getElementById('modal-prod-titulo').innerHTML = '<i class="fas fa-box"></i> Nuevo Producto';
      ['prod-nombre', 'prod-peso-neto', 'prod-barcode', 'prod-precio', 'prod-stock', 'prod-stock-min'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('prod-costo').value = '';
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
      document.getElementById('prod-detalle-enabled').checked = false; _syncDetalleToggleUI(false); const _selU = document.getElementById('prod-unidad'); _selU.innerHTML = '<option>Unidad</option><option>Caja</option><option>Paquete</option><option>Docena</option>'; _selU.value = 'Unidad';
      document.getElementById('prod-itbis').value = '1';
      // Reset stock toggle
      document.getElementById('prod-stock-enabled').checked = true;
      document.getElementById('stock-fields-wrap').style.display = 'block';
      setMasVendidosToggle(false);
      document.getElementById('prod-combo-enabled').checked = false; _syncComboToggleUI(false); document.getElementById('prod-combo-precio').value = ''; document.getElementById('prod-combo-unidades').value = ''; document.getElementById('combo-preview-txt').textContent = 'Configura el precio del combo y las unidades para ver el resumen.';
      populateCatSelects();
      document.getElementById('prod-categoria').value = categoriaId;
      const btnElimPD = document.getElementById('btn-eliminar-producto');
      if (btnElimPD) btnElimPD.style.display = 'none';
      abrirModal('modal-producto');
    };

    window.editarCategoria = async (catId) => { const cat = categorias.find(c => c.id === catId); if (!cat) return; document.getElementById('cat-nombre').value = cat.nombre || ''; document.getElementById('cat-emoji').value = cat.emoji || ''; const icon = document.getElementById('cat-img-icon'); const hint = document.getElementById('cat-img-hint'); if (cat.imagen) { document.getElementById('cat-img-preview').src = cat.imagen; document.getElementById('cat-img-preview').style.display = 'block'; if (icon) icon.style.display = 'none'; if (hint) hint.style.display = 'none'; } else { document.getElementById('cat-img-preview').src = ''; document.getElementById('cat-img-preview').style.display = 'none'; if (icon) icon.style.display = 'block'; if (hint) hint.style.display = 'block'; } window.categoriaEditandoId = catId; const titulo = document.getElementById('modal-cat-titulo'); if (titulo) titulo.innerHTML = '<i class="fas fa-edit"></i> Editar Categoría'; const btnElim = document.getElementById('btn-eliminar-categoria'); if (btnElim) btnElim.style.display = 'inline-flex'; abrirModal('modal-categoria'); };

    window.eliminarCategoria = async (catId) => {
      if (catId === '__mas_vendidos__') { toast('La categoría "Más Vendidos" no se puede eliminar', 'error'); return; }
      const productosEnCat = productos.filter(p => p.categoriaId === catId);
      if (productosEnCat.length > 0) { toast(`No se puede eliminar la categoría. Tiene ${productosEnCat.length} productos.`, 'error'); return; }
      if (!confirm('¿Eliminar esta categoría?')) return;
      const _offlineDelCat = !navigator.onLine;
      try {
        await _fsOp(() => deleteDoc(doc(db, 'negocios', negocioId, 'categorias', catId)));
        // Eliminar del array local inmediatamente
        const ci = categorias.findIndex(c => c.id === catId);
        if (ci >= 0) categorias.splice(ci, 1);
        renderInventario();
        renderCategoriasPos();
        populateCatSelects();
        toast(_offlineDelCat ? '📱 Categoría eliminada localmente — se sincronizará con Firebase' : 'Categoría eliminada ✅', _offlineDelCat ? 'warning' : 'success', _offlineDelCat ? 5000 : 3000);
      } catch (e) { toast('Error: ' + e.message, 'error'); }
    };

    window.eliminarCategoriaDesdeModal = async () => { const catId = window.categoriaEditandoId; if (!catId) return; cerrarModal('modal-categoria'); await eliminarCategoria(catId); };

    window.eliminarProductoDesdeModal = async () => { const prodId = document.getElementById('prod-id').value; if (!prodId) return; cerrarModal('modal-producto'); await eliminarProducto(prodId); };

    const guardarCategoriaOriginal = window.guardarCategoria;
    window.guardarCategoria = async () => {
      const nombre = document.getElementById('cat-nombre').value.trim();
      const emoji = document.getElementById('cat-emoji').value.trim() || '📦';
      if (!nombre) { toast('Ingresa el nombre de la categoría', 'error'); return; }

      // Anti-doble-click
      const btnGuardar = document.querySelector('#modal-categoria .modal-footer .btn-sm.verde');
      if (btnGuardar && btnGuardar.disabled) return;
      if (btnGuardar) { btnGuardar.disabled = true; btnGuardar.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Guardando...'; }

      let imagen = '';
      const preview = document.getElementById('cat-img-preview');
      const _catImgStoragePath = `cats/${negocioId}/${Date.now()}`;
      if (preview.src && preview.src !== window.location.href && preview.style.display !== 'none' && !preview.src.includes('firebasestorage')) {
        imagen = await subirImagenBase64(preview.src, _catImgStoragePath);
      } else if (window.categoriaEditandoId) {
        const catExistente = categorias.find(c => c.id === window.categoriaEditandoId);
        if (catExistente?.imagen && preview.src === catExistente.imagen) { imagen = catExistente.imagen; }
      }
      const _offlineCat = !navigator.onLine;
      try {
        if (window.categoriaEditandoId) {
          const catId = window.categoriaEditandoId;
          await _fsOp(() => updateDoc(doc(db, 'negocios', negocioId, 'categorias', catId), { nombre, emoji, imagen }));
          if (imagen && !imagen.startsWith('http')) {
            _actualizarFirestoreEnCola(imagen, `negocios/${negocioId}/categorias/${catId}`, 'imagen');
          }
          // Actualizar array local inmediatamente
          const ci = categorias.findIndex(c => c.id === catId);
          if (ci >= 0) categorias[ci] = { ...categorias[ci], nombre, emoji, imagen };
          toast(_offlineCat ? '📱 Categoría actualizada localmente — se sincronizará con Firebase' : 'Categoría actualizada ✅', _offlineCat ? 'warning' : 'success', _offlineCat ? 5000 : 3000);
          delete window.categoriaEditandoId;
        } else {
          const nextOrden = categorias.length + 1;
          const newCatRef = await _fsOp(() => addDoc(collection(db, 'negocios', negocioId, 'categorias'), { nombre, emoji, imagen, orden: nextOrden, creadoEn: serverTimestamp() }));
          if (imagen && !imagen.startsWith('http')) {
            _actualizarFirestoreEnCola(imagen, `negocios/${negocioId}/categorias/${newCatRef.id}`, 'imagen');
          }
          // Agregar al array local inmediatamente
          categorias.push({ id: newCatRef.id, nombre, emoji, imagen, orden: nextOrden });
          toast(_offlineCat ? '📱 Categoría creada localmente — se sincronizará con Firebase' : 'Categoría creada ✅', _offlineCat ? 'warning' : 'success', _offlineCat ? 5000 : 3000);
        }
        cerrarModal('modal-categoria');
        document.getElementById('cat-img-preview').src = '';
        document.getElementById('cat-img-preview').style.display = 'none';
        renderInventario();
        renderCategoriasPos();
        populateCatSelects();
      } catch (e) {
        toast('Error: ' + e.message, 'error');
      } finally {
        if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.innerHTML = '<i class="fas fa-save"></i> Guardar Categoría'; }
      }
    };

    window.abrirModalCategoria = () => { delete window.categoriaEditandoId; document.getElementById('cat-nombre').value = ''; document.getElementById('cat-emoji').value = ''; document.getElementById('cat-img-preview').src = ''; document.getElementById('cat-img-preview').style.display = 'none'; const icon = document.getElementById('cat-img-icon'); const hint = document.getElementById('cat-img-hint'); if (icon) icon.style.display = 'block'; if (hint) hint.style.display = 'block'; const titulo = document.getElementById('modal-cat-titulo'); if (titulo) titulo.innerHTML = '<i class="fas fa-folder-plus"></i> Nueva Categoría'; const btnElim = document.getElementById('btn-eliminar-categoria'); if (btnElim) btnElim.style.display = 'none'; abrirModal('modal-categoria'); };

    function populateCatSelects() {
      const selects = ['prod-categoria'];
      // Excluir la categoría virtual de Más Vendidos del selector
      const catsReales = categorias.filter(c => c.id !== '__mas_vendidos__');
      selects.forEach(id => { const sel = document.getElementById(id); if (!sel) return; const prev = sel.value; sel.innerHTML = '<option value="">Selecciona categoría...</option>' + catsReales.map(c => `<option value="${c.id}">${c.emoji || '📦'} ${c.nombre}</option>`).join(''); if (prev && catsReales.find(c => c.id === prev)) sel.value = prev; });
    }

    // Toggle Más Vendidos — solo setea el checked del checkbox nativo
    window.toggleMasVendidosSlider = () => { }; // ya no se usa, se deja vacío por retrocompatibilidad

    function setMasVendidosToggle(val) {
      const chk = document.getElementById('prod-mas-vendidos');
      if (chk) chk.checked = !!val;
    }

    window.abrirModalProducto = () => {
      productoEnEdicion = null;
      document.getElementById('modal-prod-titulo').innerHTML = '<i class="fas fa-box"></i> Nuevo Producto';
      ['prod-nombre', 'prod-peso-neto', 'prod-barcode', 'prod-precio', 'prod-stock', 'prod-stock-min'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('prod-costo').value = '';
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
      document.getElementById('prod-detalle-enabled').checked = false; _syncDetalleToggleUI(false); const _selU = document.getElementById('prod-unidad'); _selU.innerHTML = '<option>Unidad</option><option>Caja</option><option>Paquete</option><option>Docena</option>'; _selU.value = 'Unidad';
      document.getElementById('prod-itbis').value = '1';
      // Reset stock toggle
      document.getElementById('prod-stock-enabled').checked = true;
      document.getElementById('stock-fields-wrap').style.display = 'block';
      setMasVendidosToggle(false);
      document.getElementById('prod-combo-enabled').checked = false; _syncComboToggleUI(false); document.getElementById('prod-combo-precio').value = ''; document.getElementById('prod-combo-unidades').value = ''; document.getElementById('combo-preview-txt').textContent = 'Configura el precio del combo y las unidades para ver el resumen.';
      populateCatSelects();
      if (inventarioCategoriaActual) {
        document.getElementById('prod-categoria').value = inventarioCategoriaActual;
      }
      const btnElimP = document.getElementById('btn-eliminar-producto');
      if (btnElimP) btnElimP.style.display = 'none';
      abrirModal('modal-producto');
    };

    window.editarProducto = (id) => { const p = productos.find(pr => pr.id === id); if (!p) return; productoEnEdicion = p; document.getElementById('modal-prod-titulo').innerHTML = '<i class="fas fa-edit"></i> Editar Producto'; document.getElementById('prod-id').value = p.id; document.getElementById('prod-nombre').value = p.nombre || ''; document.getElementById('prod-peso-neto').value = p.pesoNeto || ''; document.getElementById('prod-barcode').value = p.codigoBarras || ''; document.getElementById('prod-precio').value = p.precio || ''; document.getElementById('prod-costo').value = p.costo || ''; const stockHab = p.stockHabilitado !== false; document.getElementById('prod-stock-enabled').checked = stockHab; document.getElementById('stock-fields-wrap').style.display = stockHab ? 'block' : 'none'; document.getElementById('prod-stock').value = stockHab ? (p.stock >= 0 ? p.stock : '') : ''; document.getElementById('prod-stock-min').value = p.stockMin || ''; const detalleActivo = !!p.productoDetalle; document.getElementById('prod-detalle-enabled').checked = detalleActivo; _syncDetalleToggleUI(detalleActivo); const selUnidad = document.getElementById('prod-unidad'); selUnidad.innerHTML = detalleActivo ? '<option>Libra</option><option>Kilogramo</option><option>Onza</option><option>Litro</option>' : '<option>Unidad</option><option>Caja</option><option>Paquete</option><option>Docena</option>'; selUnidad.value = p.unidad || (detalleActivo ? 'Libra' : 'Unidad'); document.getElementById('prod-itbis').value = p.itbis !== false ? '1' : '0'; setMasVendidosToggle(!!p.masVendidos); const comboActivo = !!p.comboActivo; document.getElementById('prod-combo-enabled').checked = comboActivo; _syncComboToggleUI(comboActivo); if (comboActivo) { document.getElementById('prod-combo-precio').value = p.comboPrecio || ''; document.getElementById('prod-combo-unidades').value = p.comboUnidades || ''; setTimeout(actualizarComboPreview, 50); } else { document.getElementById('prod-combo-precio').value = ''; document.getElementById('prod-combo-unidades').value = ''; } populateCatSelects(); document.getElementById('prod-categoria').value = p.categoriaId || ''; const icon = document.getElementById('prod-img-icon'); const h1 = document.getElementById('prod-img-hint1'); const h2 = document.getElementById('prod-img-hint2'); const rh = document.getElementById('prod-img-replace-hint'); if (p.imagen) { document.getElementById('prod-img-preview').src = p.imagen; document.getElementById('prod-img-preview').style.display = 'block'; if (icon) icon.style.display = 'none'; if (h1) h1.style.display = 'none'; if (h2) h2.style.display = 'none'; if (rh) rh.style.display = 'block'; } else { document.getElementById('prod-img-preview').src = ''; document.getElementById('prod-img-preview').style.display = 'none'; if (icon) icon.style.display = 'block'; if (h1) h1.style.display = 'block'; if (h2) h2.style.display = 'block'; if (rh) rh.style.display = 'none'; } const btnElimP = document.getElementById('btn-eliminar-producto'); if (btnElimP) btnElimP.style.display = 'inline-flex'; abrirModal('modal-producto'); };

    window.toggleStockFields = function() {
      const enabled = document.getElementById('prod-stock-enabled').checked;
      const wrap = document.getElementById('stock-fields-wrap');
      if (wrap) wrap.style.display = enabled ? 'block' : 'none';
    };

    window.toggleDetalleUnidad = function() {
      const activo = document.getElementById('prod-detalle-enabled').checked;
      _syncDetalleToggleUI(activo);
      const sel = document.getElementById('prod-unidad');
      const unidadActual = sel.value;
      sel.innerHTML = activo
        ? `<option>Libra</option><option>Kilogramo</option><option>Onza</option><option>Litro</option>`
        : `<option>Unidad</option><option>Caja</option><option>Paquete</option><option>Docena</option>`;
      const opts = Array.from(sel.options).map(o => o.value);
      if (opts.includes(unidadActual)) sel.value = unidadActual;
    };

    function _syncDetalleToggleUI(activo) {
      const track = document.getElementById('prod-detalle-track');
      const thumb = document.getElementById('prod-detalle-thumb');
      const lbl   = document.getElementById('prod-detalle-label');
      if (track) track.style.background = activo ? '#2f9e44' : '#cbd5e0';
      if (thumb) thumb.style.transform  = activo ? 'translateX(16px)' : 'translateX(0)';
      if (lbl)   lbl.style.background   = activo ? '#d3f9d8' : '#f1f3f9';
    }

    window.toggleComboFields = function() {
      const activo = document.getElementById('prod-combo-enabled').checked;
      const wrap = document.getElementById('combo-fields-wrap');
      const track = document.getElementById('combo-toggle-track');
      const thumb = document.getElementById('combo-toggle-thumb');
      const lbl = document.getElementById('combo-toggle-label');
      if (wrap) wrap.style.display = activo ? 'block' : 'none';
      if (track) track.style.background = activo ? '#f59f00' : '#cbd5e0';
      if (thumb) thumb.style.transform = activo ? 'translateX(16px)' : 'translateX(0)';
      if (lbl) lbl.style.background = activo ? '#fff3bf' : '#f1f3f9';
      if (activo) actualizarComboPreview();
    };

    window.actualizarComboPreview = function() {
      const precioUnit = parseFloat(document.getElementById('prod-precio').value) || 0;
      const comboPrecio = parseFloat(document.getElementById('prod-combo-precio').value) || 0;
      const comboUnidades = parseInt(document.getElementById('prod-combo-unidades').value) || 0;
      const preview = document.getElementById('combo-preview-txt');
      if (!preview) return;
      if (!comboPrecio || !comboUnidades || comboUnidades < 2) {
        preview.textContent = 'Configura el precio del combo y las unidades (mínimo 2) para ver el resumen.';
        return;
      }
      if (!precioUnit) {
        preview.textContent = 'Define el precio de venta unitario primero.';
        return;
      }
      // Ejemplo: con 40 pesos cuántas unidades?
      const ejemploMonto = 40;
      const udsEjemplo = calcularUnidadesCombo(ejemploMonto, precioUnit, comboPrecio, comboUnidades);
      const precioEfectivo = (comboPrecio / comboUnidades).toFixed(2);
      preview.innerHTML = `<strong>${fmt(comboPrecio)}</strong> = ${comboUnidades} unidades (${fmt(precioEfectivo)} c/u efectivo) · Ej: con <strong>${fmt(ejemploMonto)}</strong> → <strong>${udsEjemplo} unidades</strong>`;
    };



    function _syncComboToggleUI(activo) {
      const track = document.getElementById('combo-toggle-track');
      const thumb = document.getElementById('combo-toggle-thumb');
      const lbl = document.getElementById('combo-toggle-label');
      const wrap = document.getElementById('combo-fields-wrap');
      if (track) track.style.background = activo ? '#f59f00' : '#cbd5e0';
      if (thumb) thumb.style.transform = activo ? 'translateX(16px)' : 'translateX(0)';
      if (lbl) lbl.style.background = activo ? '#fff3bf' : '#f1f3f9';
      if (wrap) wrap.style.display = activo ? 'block' : 'none';
    }

    window.guardarProducto = async () => {
      const nombre = document.getElementById('prod-nombre').value.trim();
      const precio = parseFloat(document.getElementById('prod-precio').value);
      let catId = document.getElementById('prod-categoria').value;
      if (!nombre || isNaN(precio) || !catId) { toast('Nombre, precio y categoría son requeridos', 'error'); return; }

      // Anti-doble-click
      const btnGuardar = document.querySelector('#modal-producto .modal-footer .btn-sm.verde');
      if (btnGuardar && btnGuardar.disabled) return;
      if (btnGuardar) { btnGuardar.disabled = true; btnGuardar.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Guardando...'; }

      const data = {
        nombre,
        precio,
        costo: parseFloat(document.getElementById('prod-costo').value) || 0,
        stock: document.getElementById('prod-stock-enabled').checked ? (parseFloat(document.getElementById('prod-stock').value) || 0) : -1,
        stockMin: document.getElementById('prod-stock-enabled').checked ? (parseFloat(document.getElementById('prod-stock-min').value) || 5) : 0,
        stockHabilitado: document.getElementById('prod-stock-enabled').checked,
        codigoBarras: document.getElementById('prod-barcode').value.trim(),
        pesoNeto: document.getElementById('prod-peso-neto').value.trim(),
        productoDetalle: document.getElementById('prod-detalle-enabled').checked,
        unidad: document.getElementById('prod-unidad').value,
        itbis: document.getElementById('prod-itbis').value === '1',
        masVendidos: !!document.getElementById('prod-mas-vendidos').checked,
        comboActivo: !!document.getElementById('prod-combo-enabled').checked,
        comboPrecio: document.getElementById('prod-combo-enabled').checked ? (parseFloat(document.getElementById('prod-combo-precio').value) || 0) : 0,
        comboUnidades: document.getElementById('prod-combo-enabled').checked ? (parseInt(document.getElementById('prod-combo-unidades').value) || 0) : 0,
        categoriaId: catId,
        actualizadoEn: serverTimestamp()
      };

      const preview = document.getElementById('prod-img-preview');
      if (preview.src && !preview.src.startsWith('http') && preview.style.display !== 'none') {
        data.imagen = await subirImagenBase64(preview.src, `prods/${negocioId}/${Date.now()}`);
      } else if (productoEnEdicion?.imagen) {
        data.imagen = productoEnEdicion.imagen;
      }

      const _offlineProd = !navigator.onLine;
      try {
        const prodId = document.getElementById('prod-id').value;
        if (prodId) {
          if (productoEnEdicion && productoEnEdicion.categoriaId !== catId) {
            const newRef = await _fsOp(() => addDoc(collection(db, 'negocios', negocioId, 'categorias', catId, 'productos'), { ...data, creadoEn: serverTimestamp() }));
            if (data.imagen && !data.imagen.startsWith('http')) {
              _actualizarFirestoreEnCola(data.imagen, `negocios/${negocioId}/categorias/${catId}/productos/${newRef.id}`, 'imagen');
            }
            _fsOp(() => deleteDoc(doc(db, 'negocios', negocioId, 'categorias', productoEnEdicion.categoriaId, 'productos', prodId)));
            toast(_offlineProd ? '📱 Producto movido localmente — se sincronizará con Firebase' : 'Producto movido a nueva categoría', _offlineProd ? 'warning' : 'success', _offlineProd ? 5000 : 3000);
          } else {
            await _fsOp(() => updateDoc(doc(db, 'negocios', negocioId, 'categorias', catId, 'productos', prodId), data));
            if (data.imagen && !data.imagen.startsWith('http')) {
              _actualizarFirestoreEnCola(data.imagen, `negocios/${negocioId}/categorias/${catId}/productos/${prodId}`, 'imagen');
            }
            toast(_offlineProd ? '📱 Producto actualizado localmente — se sincronizará con Firebase' : 'Producto actualizado ✅', _offlineProd ? 'warning' : 'success', _offlineProd ? 5000 : 3000);
          }
          // Actualizar array local inmediatamente para reflejar cambio en UI
          const pi = productos.findIndex(p => p.id === prodId);
          if (pi >= 0) productos[pi] = { ...productos[pi], ...data, id: prodId };
        } else {
          data.creadoEn = serverTimestamp();
          const newProdRef = await _fsOp(() => addDoc(collection(db, 'negocios', negocioId, 'categorias', catId, 'productos'), data));
          if (data.imagen && !data.imagen.startsWith('http')) {
            _actualizarFirestoreEnCola(data.imagen, `negocios/${negocioId}/categorias/${catId}/productos/${newProdRef.id}`, 'imagen');
          }
          // Agregar al array local inmediatamente
          productos.push({ ...data, id: newProdRef.id, categoriaId: catId });
          toast(_offlineProd ? '📱 Producto creado localmente — se sincronizará con Firebase' : 'Producto creado ✅', _offlineProd ? 'warning' : 'success', _offlineProd ? 5000 : 3000);
        }
        cerrarModal('modal-producto');
        renderInventario();
        // Limpiar caché de grids para que refleje los cambios
        const catGrid = document.getElementById(`productos-grid-${catId}`);
        if (catGrid) catGrid.remove();
        delete _gridCache[catId];
        renderCategoriasPos();
      } catch (e) {
        toast('Error: ' + e.message, 'error');
      } finally {
        if (btnGuardar) { btnGuardar.disabled = false; btnGuardar.innerHTML = '<i class="fas fa-save"></i> Guardar'; }
      }
    };

    window.eliminarProducto = async (id) => {
      if (!confirm('¿Eliminar este producto?')) return;
      const p = productos.find(pr => pr.id === id);
      if (!p) return;
      const _offlineDel = !navigator.onLine;
      try {
        await _fsOp(() => deleteDoc(doc(db, 'negocios', negocioId, 'categorias', p.categoriaId, 'productos', id)));
        // Eliminar del array local inmediatamente
        const pi = productos.findIndex(pr => pr.id === id);
        if (pi >= 0) productos.splice(pi, 1);
        // Limpiar caché del grid
        const catGrid = document.getElementById(`productos-grid-${p.categoriaId}`);
        if (catGrid) catGrid.remove();
        delete _gridCache[p.categoriaId];
        renderInventario();
        renderCategoriasPos();
        toast(_offlineDel ? '📱 Producto eliminado localmente — se sincronizará con Firebase' : 'Producto eliminado ✅', _offlineDel ? 'warning' : 'success', _offlineDel ? 5000 : 3000);
      } catch (e) { toast('Error: ' + e.message, 'error'); }
    };

    // subirImagenBase64 — versión con soporte offline completo:
    // Si hay internet sube directo. Offline: guarda en cola local IndexedDB y
    // devuelve base64 para que la app funcione sin interrupciones.
    async function subirImagenBase64(dataUrl, storagePath, firestorePath, field) {
      if (!dataUrl || dataUrl.startsWith('http')) return dataUrl;
      if (!navigator.onLine) {
        _addToImgQueue({ path: storagePath, dataUrl, firestorePath: firestorePath || null, field: field || 'imagen', savedAt: Date.now() });
        console.log('[Offline] Imagen encolada:', storagePath);
        return dataUrl;
      }
      try {
        const imgRef = ref(storage, storagePath);
        await uploadString(imgRef, dataUrl, 'data_url');
        return await getDownloadURL(imgRef);
      } catch (e) {
        console.warn('Error subiendo imagen, encolando offline:', e);
        _addToImgQueue({ path: storagePath, dataUrl, firestorePath: firestorePath || null, field: field || 'imagen', savedAt: Date.now() });
        return dataUrl;
      }
    }

    function comprimirImagen(file, maxHeight = 400, quality = 0.82) {
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

    // ==================== ESCÁNER GLOBAL DE CÓDIGO DE BARRAS ====================
    // Detecta escaneos desde cualquier lector HID (teclado externo) en toda la app.
    // Lógica: los lectores escriben el código muy rápido y terminan con Enter.
    // Estado del escáner
    const _bcScanner = {
      buffer: '',
      lastTime: 0,
      SPEED_MS: 60,      // ms máximos entre caracteres de un escaneo real
      MIN_LEN: 4,        // longitud mínima para considerarlo código de barras
      scanBtnActive: false  // true cuando el usuario pulsó el botón de escanear en modal-editar
    };

    // El botón de escanear en el modal de producto activa el modo "permitir reemplazo"
    window.escanearBarcodeProducto = () => {
      _bcScanner.scanBtnActive = true;
      // Si hay cámara disponible, abrir el modal de cámara
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        abrirCamaraScanner('prod-barcode');
      } else {
        toast('📷 Escanea el código de barras ahora...', 'info', 3000);
      }
      // Lo desactivamos después de 6 segundos por seguridad
      setTimeout(() => { _bcScanner.scanBtnActive = false; }, 6000);
    };

    document.addEventListener('keydown', (e) => {
      // Ignorar si el foco está en un textarea o input de texto libre
      // (excepto el caso del scanner-input y prod-barcode que manejamos explícitamente)
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      const type = (document.activeElement?.type || '').toLowerCase();
      const isTextInput = (tag === 'textarea') ||
        (tag === 'input' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(type));

      const now = Date.now();
      const timeDiff = now - _bcScanner.lastTime;
      _bcScanner.lastTime = now;

      // --- DETERMINAR CONTEXTO ACTIVO ---
      const modalProdVisible = document.getElementById('modal-producto')?.classList.contains('visible');

      // Si el modal de producto está abierto y el foco NO está en prod-barcode,
      // interceptamos el escáner de barras para redirigirlo siempre a prod-barcode
      if (modalProdVisible && isTextInput && document.activeElement?.id !== 'prod-barcode') {
        const activeId = document.activeElement?.id;
        // Solo interceptar si viene de un escáner (rápido) o si acumulamos buffer
        if (e.key.length === 1 && timeDiff < _bcScanner.SPEED_MS) {
          // Es un carácter rápido (escáner) → acumular en buffer y bloquear el input actual
          e.preventDefault();
          _bcScanner.buffer += e.key;
          return;
        }
        if (e.key === 'Enter' && _bcScanner.buffer.length >= _bcScanner.MIN_LEN) {
          // Enter del escáner → no procesar en el input activo
          e.preventDefault();
          const code = _bcScanner.buffer.trim();
          _bcScanner.buffer = '';
          // Redirigir a prod-barcode
          const barcodeInput = document.getElementById('prod-barcode');
          const esEdicion = !!productoEnEdicion;
          if (esEdicion) {
            if (_bcScanner.scanBtnActive || !barcodeInput.value.trim()) {
              barcodeInput.value = code;
              _bcScanner.scanBtnActive = false;
              toast('✅ Código de barras capturado', 'success', 2000);
            }
          } else {
            barcodeInput.value = code;
            toast('✅ Código de barras capturado', 'success', 2000);
          }
          return;
        }
        // Tecla lenta o no alfanumérica → dejar pasar normalmente
        if (e.key === 'Enter') {
          _bcScanner.buffer = '';
        }
        return;
      }

      if (e.key === 'Enter') {
        const code = _bcScanner.buffer.trim();
        _bcScanner.buffer = '';

        if (code.length < _bcScanner.MIN_LEN) return;

        const modalScannerVisible = document.getElementById('modal-scanner')?.classList.contains('visible');
        const pagePos = document.getElementById('page-pos')?.classList.contains('active');
        const pageInv = document.getElementById('page-inventario')?.classList.contains('active');

        // 1) Modal scanner ya abierto → comportamiento original
        if (modalScannerVisible) {
          document.getElementById('scanner-input').value = code;
          buscarPorBarcode();
          return;
        }

        // 2) Modal producto visible → llenar campo código de barras
        if (modalProdVisible) {
          const barcodeInput = document.getElementById('prod-barcode');
          const esEdicion = !!productoEnEdicion; // true si hay producto en edición
          if (esEdicion) {
            // Solo reemplazar si el botón de escanear fue presionado O si el campo está vacío
            if (_bcScanner.scanBtnActive || !barcodeInput.value.trim()) {
              barcodeInput.value = code;
              _bcScanner.scanBtnActive = false;
              toast('✅ Código de barras capturado', 'success', 2000);
            }
            // Si el campo tiene valor y no se presionó el botón, ignorar silenciosamente
          } else {
            // Modal nuevo producto → siempre llenar
            barcodeInput.value = code;
            toast('✅ Código de barras capturado', 'success', 2000);
          }
          return;
        }

        // 3) POS (facturación) → agregar al carrito si coincide
        if (pagePos && !modalProdVisible && !modalScannerVisible) {
          const prod = productos.find(p => p.codigoBarras === code);
          if (prod) {
            agregarAlCarritoObj(prod);
            toast(`🛒 ${prod.nombre} agregado`, 'success', 1800);
          } else {
            toast(`⚠️ Código "${code}" no encontrado`, 'error', 2500);
          }
          return;
        }

        // 4) Inventario → abrir modal de edición si coincide
        if (pageInv && !modalProdVisible) {
          const prod = productos.find(p => p.codigoBarras === code);
          if (prod) {
            editarProducto(prod.id);
            toast(`✏️ Editando: ${prod.nombre}`, 'info', 2000);
          } else {
            toast(`⚠️ Código "${code}" no encontrado`, 'error', 2500);
          }
          return;
        }

        return;
      }

      // Acumular caracteres del buffer solo si vienen rápido (lector de barras)
      // o si el foco NO está en un campo de texto (para no interferir con tipeo normal)
      if (e.key.length === 1) {
        if (timeDiff < _bcScanner.SPEED_MS || !isTextInput) {
          // Si el foco está en un input de texto y el tipeo es lento → no acumular
          if (isTextInput && timeDiff >= _bcScanner.SPEED_MS && _bcScanner.buffer.length === 0) {
            return;
          }
          _bcScanner.buffer += e.key;
        } else {
          // Tipeo lento → reiniciar buffer con este caracter
          _bcScanner.buffer = e.key;
        }
      }
    });
    // ==================== FIN ESCÁNER GLOBAL ====================

    // ==================== EMPLEADOS ====================
    // loadEmpleados reemplazado por onSnapshot en initApp — función vacía por compatibilidad
    async function loadEmpleados() { /* datos ya cargados via onSnapshot en initApp */ }

    function renderEmpleados() { const lista = document.getElementById('empleados-lista'); if (!lista) return; if (!empleadosCache.length) { lista.innerHTML = '<div class="empty-state"><i class="fas fa-users"></i><p>Sin empleados</p></div>'; return; } lista.innerHTML = empleadosCache.map(e => `<div class="empleado-row"><div class="empleado-avatar">${(e.nombre || 'E')[0].toUpperCase()}</div><div class="empleado-info"><div class="emp-nombre">${e.nombre}</div><div class="emp-email">${e.email}</div></div><span class="emp-rol ${e.rol}">${e.rol}</span>${e.uid !== currentUser.uid ? `<button class="btn-sm" onclick="eliminarEmpleado('${e.id}')" style="background:#ffe3e3;color:#e03131;padding:6px 10px;font-size:12px;"><i class="fas fa-trash"></i></button>` : ''}</div>`).join(''); }

    window.abrirModalEmpleado = () => { ['emp-nombre', 'emp-email', 'emp-pass'].forEach(id => document.getElementById(id).value = ''); document.getElementById('emp-rol').value = 'empleado'; abrirModal('modal-empleado'); };

    window.guardarEmpleado = async () => {
      const nombre = document.getElementById('emp-nombre').value.trim();
      const email = document.getElementById('emp-email').value.trim();
      const pass = document.getElementById('emp-pass').value;
      const rol = document.getElementById('emp-rol').value;
      if (!nombre || !email || !pass) { toast('Todos los campos son requeridos', 'error'); return; }
      if (pass.length < 6) { toast('La contraseña debe tener mínimo 6 caracteres', 'error'); return; }
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        const uid = cred.user.uid;
        localStorage.setItem(`negocio_${uid}`, negocioId);
        await setDoc(doc(db, 'negocios', negocioId, 'empleados', uid), { nombre, email, rol, uid, activo: true, creadoEn: serverTimestamp() });
        // Registrar el negocio en el perfil del empleado para que aparezca en su selector
        const userRef = doc(db, 'usuarios', uid);
        await setDoc(userRef, { email, negociosAdmin: [negocioId] }, { merge: true });
        empleadosCache.push({ id: uid, nombre, email, rol, uid });
        renderEmpleados();
        cerrarModal('modal-empleado');
        toast('Empleado agregado', 'success');
      } catch (e) {
        let msg = 'Error: ';
        if (e.code === 'auth/email-already-in-use') msg += 'Ese email ya existe';
        else msg += e.message;
        toast(msg, 'error');
      }
    };

    window.eliminarEmpleado = async (id) => { if (!confirm('¿Eliminar este empleado?')) return; try { await deleteDoc(doc(db, 'negocios', negocioId, 'empleados', id)); empleadosCache = empleadosCache.filter(e => e.id !== id); renderEmpleados(); toast('Empleado eliminado', 'success'); } catch (e) { toast('Error: ' + e.message, 'error'); } };

    // ==================== CONFIG ====================
    function renderConfig() {
      if (!negocioData) return;
      // Cargar estado modo prueba desde localStorage
      try {
        const saved = localStorage.getItem(`modo_prueba_${negocioId}`);
        if (saved !== null) modoPrueba = saved === '1';
      } catch(e) {}
      _aplicarModoPrueba();
      document.getElementById('cfg-nombre').value = negocioData.nombre || '';
      document.getElementById('cfg-rnc').value = negocioData.rnc || '';
      document.getElementById('cfg-direccion').value = negocioData.direccion || '';
      document.getElementById('cfg-ncf-prefijo').value = config.ncfPrefijo || 'B01';
      document.getElementById('cfg-ncf-seq').value = config.ncfSeq || 1;
      document.getElementById('cfg-itbis-pct').value = config.itbisPct || 18;
      document.getElementById('cfg-itbis-cliente').checked = config.itbisCliente === true;
      // Inicializar selectores de países
      initPaisSelects();
      // Cargar teléfono y whatsapp con auto-detección
      const telVal = negocioData.telefono || '';
      const wsVal = negocioData.whatsapp || '';
      document.getElementById('cfg-telefono').value = telVal;
      document.getElementById('cfg-whatsapp').value = wsVal;
      if (telVal) autoDetectPaisTel(telVal, 'cfg-tel-pais', 'cfg-tel-preview');
      else updateTelPreview('cfg-tel-pais', '', 'cfg-tel-preview');
      if (wsVal) autoDetectPaisTel(wsVal, 'cfg-ws-pais', 'cfg-ws-preview');
      else updateTelPreview('cfg-ws-pais', '', 'cfg-ws-preview');
    }

    window.guardarConfig = async () => { try { const telPaisSel = document.getElementById('cfg-tel-pais'); const wsPaisSel = document.getElementById('cfg-ws-pais'); const telPais = PAISES_TEL.find(p => p.code === telPaisSel?.value); const wsPais = PAISES_TEL.find(p => p.code === wsPaisSel?.value); const telRaw = document.getElementById('cfg-telefono').value.trim(); const wsRaw = document.getElementById('cfg-whatsapp').value.trim(); const telFull = telPais && telRaw ? (telRaw.startsWith('+') ? telRaw : telPais.dial + telRaw.replace(/\D/g, '')) : telRaw; const wsFull = wsPais && wsRaw ? (wsRaw.startsWith('+') ? wsRaw : wsPais.dial + wsRaw.replace(/\D/g, '')) : wsRaw; const negUpdate = { nombre: document.getElementById('cfg-nombre').value.trim(), rnc: document.getElementById('cfg-rnc').value.trim(), direccion: document.getElementById('cfg-direccion').value.trim(), telefono: telFull, whatsapp: wsFull }; const cfgUpdate = { ncfPrefijo: document.getElementById('cfg-ncf-prefijo').value.trim() || 'B01', ncfSeq: parseInt(document.getElementById('cfg-ncf-seq').value) || 1, itbisPct: parseFloat(document.getElementById('cfg-itbis-pct').value) || 18, itbisCliente: document.getElementById('cfg-itbis-cliente').checked }; await updateDoc(doc(db, 'negocios', negocioId), negUpdate); await updateDoc(doc(db, 'negocios', negocioId, 'configuraciones', 'general'), cfgUpdate); negocioData = { ...negocioData, ...negUpdate }; config = { ...config, ...cfgUpdate }; document.getElementById('nav-negocio-nombre').textContent = negocioData.nombre || 'Mi Colmado'; toast('Configuración guardada', 'success'); } catch (e) { toast('Error: ' + e.message, 'error'); } };

    // ==================== ESTADÍSTICAS ====================
    window.estadisticasHoy = () => { const hoy = new Date(); document.getElementById('stats-fecha-ini').value = hoy.toISOString().split('T')[0]; document.getElementById('stats-fecha-fin').value = hoy.toISOString().split('T')[0]; calcularEstadisticas(); };

    window.calcularEstadisticas = async () => { const fechaIni = document.getElementById('stats-fecha-ini').value; const fechaFin = document.getElementById('stats-fecha-fin').value; let q; if (fechaIni && fechaFin) { const ini = Timestamp.fromDate(new Date(fechaIni)); const fin = Timestamp.fromDate(new Date(fechaFin + 'T23:59:59')); q = query(collection(db, 'negocios', negocioId, 'facturas'), where('fecha', '>=', ini), where('fecha', '<=', fin), orderBy('fecha', 'asc')); } else { q = query(collection(db, 'negocios', negocioId, 'facturas'), orderBy('fecha', 'desc'), limit(100)); } const snap = await getDocs(q); const facturas = snap.docs.map(d => ({ id: d.id, ...d.data() })); const pagadas = facturas.filter(f => f.estado === 'pagada'); const totalVentas = pagadas.reduce((s, f) => s + (f.total || 0), 0); const numFacturas = pagadas.length; let prodsVendidos = 0; const prodConteo = {}; pagadas.forEach(f => { (f.items || []).forEach(i => { prodsVendidos += i.qty || 0; prodConteo[i.nombre] = (prodConteo[i.nombre] || 0) + (i.qty || 0); }); }); document.getElementById('stat-ventas-total').textContent = fmt(totalVentas); document.getElementById('stat-num-facturas').textContent = numFacturas; document.getElementById('stat-prods-vendidos').textContent = prodsVendidos; document.getElementById('stat-promedio').textContent = numFacturas ? fmt(totalVentas / numFacturas) : 'RD$ 0'; renderCharts(pagadas, prodConteo); await calcularContabilidad(fechaIni, fechaFin); };

    async function calcularContabilidad(fechaIni, fechaFin) { let q; if (fechaIni && fechaFin) { const ini = Timestamp.fromDate(new Date(fechaIni)); const fin = Timestamp.fromDate(new Date(fechaFin + 'T23:59:59')); q = query(collection(db, 'negocios', negocioId, 'movimientos'), where('fecha', '>=', ini), where('fecha', '<=', fin)); } else { q = query(collection(db, 'negocios', negocioId, 'movimientos'), limit(500)); } const snap = await getDocs(q); const movs = snap.docs.map(d => d.data()); const ingresos = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0); const egresos = movs.filter(m => m.tipo === 'gasto').reduce((s, m) => s + (m.monto || 0), 0); document.getElementById('contab-ingresos').textContent = fmt(ingresos); document.getElementById('contab-egresos').textContent = fmt(egresos); document.getElementById('contab-ganancia').textContent = fmt(ingresos - egresos); }

    function renderCharts(facturas, prodConteo) {
      const ventasPorDia = {}; facturas.forEach(f => { const fecha = f.fecha?.toDate ? f.fecha.toDate().toLocaleDateString('es-DO') : 'Sin fecha'; ventasPorDia[fecha] = (ventasPorDia[fecha] || 0) + (f.total || 0); });
      if (chartVentas) chartVentas.destroy(); const ctxV = document.getElementById('chart-ventas'); if (ctxV) { chartVentas = new Chart(ctxV, { type: 'bar', data: { labels: Object.keys(ventasPorDia), datasets: [{ label: 'Ventas', data: Object.values(ventasPorDia), backgroundColor: '#00b341', borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } }); }
      const topProds = Object.entries(prodConteo).sort((a, b) => b[1] - a[1]).slice(0, 8); if (chartProductos) chartProductos.destroy(); const ctxP = document.getElementById('chart-productos'); if (ctxP) { chartProductos = new Chart(ctxP, { type: 'bar', data: { labels: topProds.map(p => p[0]), datasets: [{ label: 'Cantidad', data: topProds.map(p => p[1]), backgroundColor: '#1971c2', borderRadius: 6 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } }); }
      const metodos = { efectivo: 0, transferencia: 0, tarjeta: 0 }; facturas.forEach(f => { if (metodos.hasOwnProperty(f.metodoPago)) metodos[f.metodoPago] += f.total || 0; }); if (chartMetodos) chartMetodos.destroy(); const ctxM = document.getElementById('chart-metodos'); if (ctxM) { chartMetodos = new Chart(ctxM, { type: 'doughnut', data: { labels: ['Efectivo', 'Transferencia', 'Tarjeta'], datasets: [{ data: [metodos.efectivo, metodos.transferencia, metodos.tarjeta], backgroundColor: ['#00b341', '#1971c2', '#ffd100'] }] }, options: { responsive: true, plugins: { legend: { position: 'bottom' } } } }); }
    }

    window.exportarMovimientos = () => { let csv = 'Hora,Tipo,Descripción,Empleado,Monto\n'; movimientosCache.forEach(m => { const fecha = m.fecha?.toDate ? m.fecha.toDate().toLocaleTimeString('es-DO') : '-'; csv += `"${fecha}","${m.tipo}","${m.descripcion}","${m.empleadoNombre || '-'}","${m.monto}"\n`; }); const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `movimientos_${new Date().toLocaleDateString('es-DO')}.csv`; a.click(); };

    // ── MODAL HISTORY MANAGER ────────────────────────────────────────────
    // Mantiene un stack de modales abiertos. Cada vez que se abre un modal
    // se empuja una entrada al historial del navegador, y cuando el usuario
    // presiona "atrás" (popstate) se cierra el modal más reciente en lugar
    // de salir de la página.
    const _modalStack = [];
    window._modalStack = _modalStack;

    window.abrirModal = (id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.add('visible');
      _modalStack.push(id);
      // Empujamos una entrada al historial para "capturar" el botón atrás
      history.pushState({ modalOpen: id, stackLen: _modalStack.length }, '', window.location.href);
    };

    window.cerrarModal = (id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('visible');
      // Quitar del stack (puede estar en cualquier posición si se cerró programáticamente)
      const idx = _modalStack.lastIndexOf(id);
      if (idx !== -1) _modalStack.splice(idx, 1);
    };

    // Interceptar el botón atrás del navegador / gesto en móvil
    window.addEventListener('popstate', (e) => {
      if (_modalStack.length > 0) {
        // Cerrar el modal más reciente
        const topId = _modalStack[_modalStack.length - 1];
        const el = document.getElementById(topId);
        if (el) el.classList.remove('visible');
        _modalStack.pop();
        // Si todavía quedan modales en el stack, re-empujamos una entrada
        // para que el próximo "atrás" también sea interceptado
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
          // Usar cerrarModal para que también limpie el stack y el historial
          if (_modalStack.length > 0) {
            history.back(); // dispara popstate → cierra el modal
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
        success: { bg: '#00b341', icon: '✅' },
        error:   { bg: '#e03131', icon: '❌' },
        info:    { bg: '#1971c2', icon: 'ℹ️'  },
        warning: { bg: '#f59f00', icon: '⚠️'  },
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

    setTimeout(() => { if (document.getElementById('loading-screen').style.display !== 'none') { const authState = auth.currentUser; if (!authState) showScreen('auth'); } }, 2500);

    // ==================== PAÍSES TELÉFONO ====================
    const PAISES_TEL = [
      { code: 'DO', flag: '🇩🇴', name: 'Rep. Dominicana', dial: '+1', areaCodes: ['809', '829', '849'] },
      { code: 'US', flag: '🇺🇸', name: 'Estados Unidos', dial: '+1', areaCodes: ['201', '202', '203', '212', '213', '305', '310', '312', '347', '404', '415', '424', '469', '512', '602', '646', '702', '713', '718', '786', '917'] },
      { code: 'MX', flag: '🇲🇽', name: 'México', dial: '+52', areaCodes: ['55', '33', '81'] },
      { code: 'CO', flag: '🇨🇴', name: 'Colombia', dial: '+57', areaCodes: ['1', '2', '4', '5', '6', '7', '8'] },
      { code: 'VE', flag: '🇻🇪', name: 'Venezuela', dial: '+58', areaCodes: ['212', '412', '414', '416', '424', '426'] },
      { code: 'PR', flag: '🇵🇷', name: 'Puerto Rico', dial: '+1', areaCodes: ['787', '939'] },
      { code: 'HT', flag: '🇭🇹', name: 'Haití', dial: '+509', areaCodes: [] },
      { code: 'CU', flag: '🇨🇺', name: 'Cuba', dial: '+53', areaCodes: [] },
      { code: 'PA', flag: '🇵🇦', name: 'Panamá', dial: '+507', areaCodes: [] },
      { code: 'GT', flag: '🇬🇹', name: 'Guatemala', dial: '+502', areaCodes: [] },
      { code: 'HN', flag: '🇭🇳', name: 'Honduras', dial: '+504', areaCodes: [] },
      { code: 'SV', flag: '🇸🇻', name: 'El Salvador', dial: '+503', areaCodes: [] },
      { code: 'NI', flag: '🇳🇮', name: 'Nicaragua', dial: '+505', areaCodes: [] },
      { code: 'CR', flag: '🇨🇷', name: 'Costa Rica', dial: '+506', areaCodes: [] },
      { code: 'EC', flag: '🇪🇨', name: 'Ecuador', dial: '+593', areaCodes: [] },
      { code: 'PE', flag: '🇵🇪', name: 'Perú', dial: '+51', areaCodes: [] },
      { code: 'CL', flag: '🇨🇱', name: 'Chile', dial: '+56', areaCodes: [] },
      { code: 'AR', flag: '🇦🇷', name: 'Argentina', dial: '+54', areaCodes: [] },
      { code: 'BO', flag: '🇧🇴', name: 'Bolivia', dial: '+591', areaCodes: [] },
      { code: 'PY', flag: '🇵🇾', name: 'Paraguay', dial: '+595', areaCodes: [] },
      { code: 'UY', flag: '🇺🇾', name: 'Uruguay', dial: '+598', areaCodes: [] },
      { code: 'BR', flag: '🇧🇷', name: 'Brasil', dial: '+55', areaCodes: [] },
      { code: 'ES', flag: '🇪🇸', name: 'España', dial: '+34', areaCodes: [] },
      { code: 'CA', flag: '🇨🇦', name: 'Canadá', dial: '+1', areaCodes: ['416', '604', '613', '647', '780', '905'] },
    ];

    function initPaisSelects() {
      ['cfg-tel-pais', 'cfg-ws-pais'].forEach(selId => {
        const sel = document.getElementById(selId);
        if (!sel || sel.options.length > 1) return;
        sel.innerHTML = PAISES_TEL.map(p =>
          `<option value="${p.code}">${p.flag} ${p.dial}</option>`
        ).join('');
        sel.value = 'DO'; // default RD
      });
    }

    function autoDetectPaisTel(numero, selId, previewId) {
      const sel = document.getElementById(selId);
      if (!sel) return;
      const digits = numero.replace(/\D/g, '');
      let detectado = null;
      // Detectar por código de área (primeros 3 dígitos sin +1)
      const area3 = digits.substring(0, 3);
      const area2 = digits.substring(0, 2);
      for (const p of PAISES_TEL) {
        if (p.areaCodes.includes(area3) || p.areaCodes.includes(area2)) {
          detectado = p;
          break;
        }
      }
      // Si el número empieza con + detectar por dial code
      if (!detectado && numero.startsWith('+')) {
        for (const p of PAISES_TEL) {
          const dialDigits = p.dial.replace('+', '');
          if (digits.startsWith(dialDigits) && dialDigits.length > 1) {
            detectado = p; break;
          }
        }
      }
      if (detectado) sel.value = detectado.code;
      updateTelPreview(selId, numero, previewId);
    }

    function updateTelPreview(selId, numero, previewId) {
      const sel = document.getElementById(selId);
      const prev = document.getElementById(previewId);
      if (!prev || !sel) return;
      const pais = PAISES_TEL.find(p => p.code === sel.value);
      if (!pais || !numero) { prev.textContent = ''; return; }
      const digits = numero.replace(/\D/g, '');
      const full = pais.dial + digits;
      prev.textContent = `${pais.flag} Número completo: ${full}`;
    }

    window.onChangeTelPais = (code, inputId, previewId) => {
      const input = document.getElementById(inputId);
      if (input) updateTelPreview(
        document.getElementById(previewId)?.id.includes('ws') ? 'cfg-ws-pais' : 'cfg-tel-pais',
        input.value, previewId
      );
    };

    // ==================== BROADCAST CHANNEL ====================
    // Un único canal compartido. Dos roles según si esta pestaña tiene ?c=&p= en la URL:
    //
    //  A) PESTAÑA PRINCIPAL (sin params): escucha y procesa pedidos entrantes de otras pestañas.
    //  B) PESTAÑA NUEVA (con params):     intenta ceder el pedido a la pestaña principal y cerrarse.
    //     Si en 800 ms nadie responde, carga el pedido ella misma (fallback normal).
    (function () {
      const params = new URLSearchParams(window.location.search);
      const cParam = params.get('c');
      const pParam = params.get('p');
      const esPestañaNueva = !!(cParam && pParam); // esta pestaña se abrió con el enlace

      const bc = new BroadcastChannel('miColmApp_pedidos');
      window._bcColmApp = bc;

      if (!esPestañaNueva) {
        // ── ROL A: pestaña principal ──
        // Responde a sondeos y procesa pedidos delegados por otras pestañas.
        bc.onmessage = async (ev) => {
          const { tipo, c, p } = ev.data || {};
          if (tipo === 'hay_alguien') {
            bc.postMessage({ tipo: 'app_activa' });
          }
          if (tipo === 'pedido_entrante' && c && p) {
            bc.postMessage({ tipo: 'pedido_recibido', p });
            await window._manejarPedidoEntranteConParams(c, p);
          }
        };

      } else {
        // ── ROL B: pestaña nueva con ?c=&p= ──
        // Intenta ceder el pedido a la pestaña principal antes de cargarlo aquí.
        let cedido = false;

        bc.onmessage = (ev) => {
          if (ev.data?.tipo === 'app_activa' && !cedido) {
            // Hay una pestaña principal activa → delegarle el pedido
            bc.postMessage({ tipo: 'pedido_entrante', c: cParam, p: pParam });
          }
          if (ev.data?.tipo === 'pedido_recibido' && ev.data?.p === pParam && !cedido) {
            cedido = true;
            bc.close();
            history.replaceState({}, '', window.location.pathname);
            window.close();
            // Fallback si el browser bloquea window.close()
            setTimeout(() => {
              if (!window.closed) {
                document.body.innerHTML = `
                  <div style="font-family:sans-serif;display:flex;flex-direction:column;align-items:center;
                    justify-content:center;min-height:100vh;gap:16px;background:#f5f7fa;color:#1a2135;">
                    <div style="font-size:3rem;">✅</div>
                    <div style="font-weight:700;font-size:1.1rem;">Pedido cargado en miColmApp</div>
                    <div style="color:#475569;font-size:.9rem;">Puedes cerrar esta pestaña.</div>
                  </div>`;
              }
            }, 400);
          }
        };

        // Sondear si hay una pestaña principal activa
        bc.postMessage({ tipo: 'hay_alguien' });

        // Si en 800 ms nadie respondió → no hay pestaña principal, cargar aquí mismo
        setTimeout(() => {
          if (!cedido) {
            bc.close();
            // manejarPedidoEntrante() leerá los params de la URL normalmente
          }
        }, 800);
      }
    })();

    // ==================== PEDIDO ENTRANTE POR URL ====================
    // Si la URL tiene ?c=colmadoId&p=pedidoId, cargar el pedido y crear una tab con los datos
    // Función interna reutilizable (llamada desde URL o desde BroadcastChannel)
    async function _cargarPedidoConParams(cParam, pParam) {
      toast('📦 Cargando pedido entrante...', 'info', 5000);
      try {
        const pedidoRef = doc(db, 'negocios', cParam, 'pedidos_cliente', pParam);
        const pedidoSnap = await getDoc(pedidoRef);
        if (!pedidoSnap.exists()) {
          toast('Pedido no encontrado en el enlace', 'error');
          return;
        }
        const data = { id: pedidoSnap.id, ...pedidoSnap.data() };

        // Enriquecer items con imágenes desde el inventario del negocio
        const itemsEnriquecidos = await Promise.all((data.items || []).map(async (item) => {
          try {
            if (item.imagen) return item; // ya tiene imagen
            // Buscar en la colección de productos de la categoría
            if (item.categoriaId && item.id) {
              const prodRef = doc(db, 'negocios', cParam, 'categorias', item.categoriaId, 'productos', item.id);
              const prodSnap = await getDoc(prodRef);
              if (prodSnap.exists()) {
                return { ...item, imagen: prodSnap.data().imagen || null };
              }
            }
          } catch (e) { /* silencioso */ }
          return item;
        }));

        // Crear nueva tab con los datos del pedido
        const tabNombre = data.clienteDireccion || `Pedido ${(pParam).toUpperCase()}`;
        const id = _crearNuevaTab(tabNombre);
        const tab = facturasTabs.find(t => t.id === id);
        if (tab) {
          tab.carrito = itemsEnriquecidos.map(it => ({
            id: it.id || '',
            nombre: it.nombre || 'Producto',
            precio: it.precio || 0,
            qty: it.qty || 1,
            imagen: it.imagen || null,
            categoriaId: it.categoriaId || '',
            stock: 9999 // pedidos entrantes no controlan stock
          }));
          tab.direccion = data.clienteDireccion || '';
          tab.nombre = tabNombre;
          if (data.clienteNombre) tab.clienteNombre = data.clienteNombre;
        }
        facturaTabActiva = id;
        _guardarTabsEnStorage();
        renderFacturasTabs();
        renderCarrito();

        // Rellenar campo dirección
        const dirInput = document.getElementById('pos-direccion-cliente');
        if (dirInput && tab) dirInput.value = tab.direccion || '';
        _syncClearBtn('pos-direccion-cliente', 'pos-dir-clear');

        // Ir al POS
        showPage('pos');
        toast(`✅ Pedido #${pParam.toUpperCase()} de ${data.clienteNombre || 'cliente'} cargado`, 'success', 5000);
      } catch (e) {
        toast('Error cargando pedido: ' + e.message, 'error');
      }
    }

    // Exponer para que el BroadcastChannel lo pueda llamar
    window._manejarPedidoEntranteConParams = _cargarPedidoConParams;

    async function manejarPedidoEntrante() {
      const params = new URLSearchParams(window.location.search);
      const cParam = params.get('c');
      const pParam = params.get('p');
      if (!cParam || !pParam) return false;

      // Limpiar la URL sin recargar
      history.replaceState({}, '', window.location.pathname);

      await _cargarPedidoConParams(cParam, pParam);
      return true;
    }
    // ==================== SYNC CLEAR BUTTONS ====================
    // Mapa de input → botón claro para actualización centralizada
    const _clearBtnMap = {};
    const _clearBtnReverseMap = {};

    window._syncClearBtn = function (inputId, btnId) {
      const inp = document.getElementById(inputId);
      const btn = document.getElementById(btnId);
      if (!inp || !btn) return;

      function setVisible(b, visible) {
        // Forzar consistencia incluso si hay CSS/JS que re-aplica "flex"
        b.hidden = !visible;
        b.style.setProperty('display', visible ? 'flex' : 'none', 'important');
        if (!visible) b.setAttribute('aria-hidden', 'true');
        else b.removeAttribute('aria-hidden');
      }

      // Registrar listener una sola vez — es la única fuente de verdad
      if (!_clearBtnMap[inputId]) {
        _clearBtnMap[inputId] = btnId;
        _clearBtnReverseMap[btnId] = inputId;

        // Handler del botón (sin inline JS): limpiar y ocultar consistentemente
        const handler = (e) => {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          const inputEl = document.getElementById(inputId);
          const btnEl = document.getElementById(btnId);
          if (!inputEl || !btnEl) return;

          inputEl.value = '';
          // mantener storage (tabs) si aplica
          try {
            if (typeof window._getTabActiva === 'function') {
              const tab = window._getTabActiva();
              if (tab) {
                tab.direccion = '';
                if (typeof window._guardarTabsEnStorage === 'function') window._guardarTabsEnStorage();
              }
            }
          } catch (_) { }

          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          // Por si algún listener externo re-muestra el botón, forzamos oculto al final del tick
          setVisible(btnEl, false);
          setTimeout(() => setVisible(btnEl, inputEl.value.trim().length > 0), 0);
        };

        // Evitar doble registro
        if (!btn.dataset.clearHooked) {
          btn.addEventListener('pointerdown', handler, true);
          btn.addEventListener('click', handler, true);
          btn.dataset.clearHooked = '1';
        }

        inp.addEventListener('input', () => {
          const b = document.getElementById(_clearBtnMap[inputId]);
          if (b) setVisible(b, inp.value.trim().length > 0);
        }, true); // captura: se ejecuta antes que cualquier otro handler
      }
      // Sincronizar estado inmediato
      setVisible(btn, inp.value.trim().length > 0);
    };

    // ==================== POS RESIZER ====================
    (function () {
      const MIN_W = 320;
      const MAX_W = 520;
      const STORAGE_KEY = 'pos_right_width';

      function setRightWidth(w) {
        w = Math.max(MIN_W, Math.min(MAX_W, w));
        document.documentElement.style.setProperty('--pos-right-w', w + 'px');
        localStorage.setItem(STORAGE_KEY, w);
      }

      // Recrear el canvas SOLO al terminar el drag, restaurando el dibujo
      function reajustarCanvas() {
        const container = document.getElementById('dibujo-container');
        if (!container?.classList.contains('visible')) return;
        if (typeof _redimensionarCanvas === 'function') _redimensionarCanvas();
      }

      // Restore saved width
      const saved = parseInt(localStorage.getItem(STORAGE_KEY));
      if (saved) setRightWidth(saved);

      const resizer = document.getElementById('pos-resizer');
      if (!resizer) return;

      // Mouse
      resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        resizer.classList.add('dragging');
        const startX = e.clientX;
        const startW = parseInt(getComputedStyle(document.getElementById('pos-right')).width);

        function onMove(e) {
          const dx = startX - e.clientX; // drag left = wider
          setRightWidth(startW + dx);
          // NO tocar el canvas durante el drag — el canvas se estira visualmente con CSS width:100%
        }
        function onUp() {
          resizer.classList.remove('dragging');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          // Solo al soltar: recrear canvas con el nuevo ancho y restaurar el dibujo
          reajustarCanvas();
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      // Touch
      resizer.addEventListener('touchstart', (e) => {
        e.preventDefault();
        resizer.classList.add('dragging');
        const startX = e.touches[0].clientX;
        const startW = parseInt(getComputedStyle(document.getElementById('pos-right')).width);

        function onMove(e) {
          const dx = startX - e.touches[0].clientX;
          setRightWidth(startW + dx);
        }
        function onEnd() {
          resizer.classList.remove('dragging');
          document.removeEventListener('touchmove', onMove);
          document.removeEventListener('touchend', onEnd);
          reajustarCanvas();
        }
        document.addEventListener('touchmove', onMove, { passive: true });
        document.addEventListener('touchend', onEnd);
      }, { passive: false });
    })();

    window._manejarPedidoEntrante = manejarPedidoEntrante;
