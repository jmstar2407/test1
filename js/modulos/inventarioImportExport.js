// Exportar / Importar inventario completo (con imágenes)
// Extraído de index.html
(function () {
  let _importPendingData = null;

  // ── Utilidades de UI ──────────────────────────────────
  function _showProgreso(titulo, subtitulo) {
    document.getElementById('inv-prog-titulo').textContent = titulo;
    document.getElementById('inv-prog-subtitulo').textContent = subtitulo;
    document.getElementById('inv-prog-barra').style.width = '0%';
    document.getElementById('inv-prog-pct').textContent = '0%';
    document.getElementById('inv-prog-ok').classList.remove('visible');
    document.getElementById('modal-inv-progreso').classList.add('activo');
  }

  function _setProgreso(pct) {
    document.getElementById('inv-prog-barra').style.width = pct + '%';
    document.getElementById('inv-prog-pct').textContent = Math.round(pct) + '%';
  }

  function _finProgreso(mensaje) {
    _setProgreso(100);
    document.getElementById('inv-prog-ok-txt').textContent = mensaje;
    document.getElementById('inv-prog-ok').classList.add('visible');
    document.getElementById('inv-prog-subtitulo').textContent = '';
  }

  // ── EXPORTAR ─────────────────────────────────────────
  window.exportarInventarioCompleto = async function () {
    const cats = window.categorias || [];
    const prods = window.productos || [];

    if (cats.length === 0 && prods.length === 0) {
      if (window.toast) toast('⚠️ No hay productos en el inventario para exportar.', 'warning', 3000);
      return;
    }

    _showProgreso('📦 Exportando Inventario', 'Preparando datos...');

    const total = cats.length + prods.length;
    let procesados = 0;

    // Clonar categorías (con imagen si la tienen)
    const catsExport = [];
    for (const cat of cats) {
      const c = { ...cat };
      // Si la imagen ya es base64 la incluimos tal cual
      // Si es una URL externa, la intentamos convertir a base64
      if (c.imagen && !c.imagen.startsWith('data:')) {
        try {
          c.imagen = await _urlToBase64(c.imagen);
        } catch (e) { /* mantener URL si falla */ }
      }
      catsExport.push(c);
      procesados++;
      _setProgreso((procesados / total) * 100);
    }

    // Clonar productos (con imagen en base64)
    const prodsExport = [];
    for (const p of prods) {
      const prod = { ...p };
      if (prod.imagen && !prod.imagen.startsWith('data:')) {
        try {
          prod.imagen = await _urlToBase64(prod.imagen);
        } catch (e) { /* mantener URL si falla */ }
      }
      prodsExport.push(prod);
      procesados++;
      _setProgreso((procesados / total) * 100);
    }

    const payload = {
      _version: 1,
      _exportDate: new Date().toISOString(),
      _appName: 'miColmApp',
      categorias: catsExport,
      productos: prodsExport
    };

    // Descargar como .json
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fecha = new Date().toLocaleDateString('es-DO').replace(/\//g, '-');
    const negNombre = (document.getElementById('nav-negocio-nombre')?.textContent || 'inventario').replace(/\s+/g, '_');
    a.href = url;
    a.download = `inventario_${negNombre}_${fecha}.json`;
    a.click();
    URL.revokeObjectURL(url);

    _finProgreso(`✅ ${prodsExport.length} productos en ${catsExport.length} categorías exportados`);
  };

  // ── Convertir URL a base64 ────────────────────────────
  async function _urlToBase64(url) {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ── IMPORTAR ─────────────────────────────────────────
  window.importarInventarioCompleto = function (input) {
    const file = input.files[0];
    if (!file) return;
    input.value = ''; // resetear para poder volver a importar el mismo archivo

    const reader = new FileReader();
    reader.onload = (e) => {
      let data;
      try {
        data = JSON.parse(e.target.result);
      } catch (err) {
        if (window.toast) toast('❌ El archivo no es válido. Debe ser un archivo .json de miColmApp.', 'error', 4000);
        return;
      }

      // Validación básica
      if (!data._appName || data._appName !== 'miColmApp' || !Array.isArray(data.categorias) || !Array.isArray(data.productos)) {
        if (window.toast) toast('❌ Archivo inválido. Solo se aceptan exportaciones de miColmApp.', 'error', 4000);
        return;
      }

      // Mostrar confirmación
      _importPendingData = data;
      const fechaExport = data._exportDate ? new Date(data._exportDate).toLocaleDateString('es-DO', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Desconocida';
      document.getElementById('inv-confirm-resumen').innerHTML =
        `📁 <strong>${data.categorias.length}</strong> categorías<br>` +
        `📦 <strong>${data.productos.length}</strong> productos<br>` +
        `🗓️ Exportado el: <strong>${fechaExport}</strong>`;
      document.getElementById('modal-inv-confirmar-import').classList.add('activo');
    };
    reader.readAsText(file);
  };

  window.cancelarImport = function () {
    _importPendingData = null;
    document.getElementById('modal-inv-confirmar-import').classList.remove('activo');
  };

  window.confirmarImport = async function () {
    document.getElementById('modal-inv-confirmar-import').classList.remove('activo');
    const data = _importPendingData;
    _importPendingData = null;
    if (!data) return;

    _showProgreso('📥 Importando Inventario', 'Borrando inventario actual...');

    try {
      // Acceder a Firestore mediante las variables globales del app
      const { db, negocioId } = _getFirebaseCtx();
      const { collection, doc, getDocs, deleteDoc, setDoc } = await _getFirestoreFns();

      const total = data.categorias.length + data.productos.length;
      let procesados = 0;

      // 1. Borrar categorías y productos actuales en Firestore
      const catsRef = collection(db, 'negocios', negocioId, 'categorias');
      const catsSnap = await getDocs(catsRef);
      for (const catDoc of catsSnap.docs) {
        const prodsSnap = await getDocs(collection(db, 'negocios', negocioId, 'categorias', catDoc.id, 'productos'));
        for (const pDoc of prodsSnap.docs) await deleteDoc(pDoc.ref);
        await deleteDoc(catDoc.ref);
      }

      // 2. Importar nuevas categorías
      for (const cat of data.categorias) {
        const { imagen, ...catData } = cat;
        // Guardar sin imagen primero (imagen puede ser pesada)
        const catRef = doc(db, 'negocios', negocioId, 'categorias', cat.id);
        await setDoc(catRef, { ...catData, imagen: imagen || '' });
        procesados++;
        _setProgreso((procesados / total) * 100);
      }

      // 3. Importar productos
      for (const prod of data.productos) {
        const catId = prod.categoriaId;
        if (!catId) continue;
        const prodRef = doc(db, 'negocios', negocioId, 'categorias', catId, 'productos', prod.id);
        await setDoc(prodRef, { ...prod });
        procesados++;
        _setProgreso((procesados / total) * 100);
      }

      // 4. Actualizar estado local
      if (window.categorias !== undefined) window.categorias = data.categorias;
      if (window.productos !== undefined) window.productos = data.productos;
      if (window.renderInventario) window.renderInventario();
      if (window.populateCatSelects) window.populateCatSelects();

      _finProgreso(`✅ Inventario importado: ${data.productos.length} productos en ${data.categorias.length} categorías`);
    } catch (err) {
      console.error('Error importando inventario:', err);
      document.getElementById('modal-inv-progreso').classList.remove('activo');
      if (window.toast) toast('❌ Error al importar: ' + (err.message || err), 'error', 5000);
    }
  };

  // ── Acceder al contexto Firebase del app ─────────────
  function _getFirebaseCtx() {
    const _db = window._db;
    const _negId = window._negocioId;
    if (!_db || !_negId) throw new Error('No se pudo acceder al contexto de Firebase. Asegúrate de haber iniciado sesión y tener un negocio activo.');
    return { db: _db, negocioId: _negId };
  }

  async function _getFirestoreFns() {
    // Usar la misma versión que la app principal
    return await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
  }
})();

