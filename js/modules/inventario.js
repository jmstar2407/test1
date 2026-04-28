/**
 * ════════════════════════════════════════════════════════════════════
 * MÓDULO 4: inventario.js — Gestión de Inventario y Catálogo
 * RESPONSABILIDAD: CRUD de categorías y productos, escaneo de códigos,
 *                  importación/exportación, drag & drop de orden.
 *
 * BENEFICIO DE SEPARACIÓN:
 *   Puedes integrar proveedores externos o sincronizar stock con una
 *   tienda online a través de una API sin afectar el POS ni la caja.
 *
 * FUNCIONES EXPUESTAS EN window:
 *   renderInventario()           → Renderiza la pantalla de inventario
 *   renderCategoriasInventario() → Lista las categorías
 *   renderProductosInventario()  → Lista productos de una categoría
 *   abrirModalCategoria(id?)     → Abre formulario de categoría
 *   guardarCategoria()           → Crea/edita una categoría
 *   eliminarCategoria(id)        → Elimina una categoría y sus productos
 *   abrirModalProducto(id?)      → Abre formulario de producto
 *   guardarProducto()            → Crea/edita un producto
 *   eliminarProducto(id)         → Elimina un producto
 *   exportarInventarioCompleto() → Exporta todo el inventario a JSON
 *   importarInventario(e)        → Lee el archivo JSON de importación
 *   confirmarImport()            → Confirma y ejecuta la importación
 *   cancelarImport()             → Cancela la importación pendiente
 *   populateCatSelects()         → Llena los <select> de categorías
 *   previewImagen(input)         → Previsualiza imagen seleccionada
 *   toggleModoOrden()            → Activa/desactiva drag & drop de orden
 *
 * ESCUCHA EL EVENTO:
 *   'micolmapp:negocio-listo'   → Suscribe al inventario en tiempo real
 *   'micolmapp:page-change'     → Re-renderiza al navegar a "inventario"
 * ════════════════════════════════════════════════════════════════════
 */

import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDocs, onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { AppState }                     from './app-state.js';
import { fmt, toast, abrirModal, cerrarModal } from './utils.js';
import { _fsOp, subirImagenBase64, comprimirImagen, _actualizarFirestoreEnCola } from './offline.js';

const getDb = () => window._db;

// ─── ESTADO LOCAL ────────────────────────────────────────────────────────────

let inventarioCategoriaActual = null;
let inventarioBusquedaActual  = '';
let modoOrdenActivo           = false;
let _importPendingData        = null;

// Caché de estadísticas de inventario
let _invStats = { total: 0, unidades: 0, dinero: 0, porCategoria: {} };

// ─── INICIALIZACIÓN ──────────────────────────────────────────────────────────

window.addEventListener('micolmapp:negocio-listo', () => {
  _suscribirInventario();
});

window.addEventListener('micolmapp:page-change', ({ detail }) => {
  if (detail.page === 'inventario') renderInventario();
});

function _suscribirInventario() {
  const db = getDb();

  // Suscripción en tiempo real a categorías
  AppState.unsubCategorias = onSnapshot(
    collection(db, 'negocios', AppState.negocioId, 'categorias'),
    async (snap) => {
      AppState.categorias = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.orden || 9999) - (b.orden || 9999));

      // Suscribirse a productos de cada categoría nueva
      for (const cat of AppState.categorias) {
        if (!AppState.unsubProductos[cat.id]) {
          AppState.unsubProductos[cat.id] = onSnapshot(
            collection(db, 'negocios', AppState.negocioId, 'categorias', cat.id, 'productos'),
            (prodSnap) => {
              const nuevos = prodSnap.docs.map(d => ({ id: d.id, categoriaId: cat.id, ...d.data() }));
              // Reemplazar productos de esta categoría en el array global
              AppState.productos = [
                ...AppState.productos.filter(p => p.categoriaId !== cat.id),
                ...nuevos
              ];
              _recalcularInvStats();
              if (window.renderCategoriasPos) window.renderCategoriasPos();
              if (window.populateCatSelects)  window.populateCatSelects();
              renderInventario();
            }
          );
        }
      }

      _recalcularInvStats();
      if (window.renderCategoriasPos) window.renderCategoriasPos();
      if (window.populateCatSelects)  window.populateCatSelects();
      renderInventario();
    }
  );
}

// ─── ESTADÍSTICAS DE INVENTARIO ──────────────────────────────────────────────

function _recalcularInvStats() {
  let total = 0, unidades = 0, dinero = 0;
  const porCategoria = {};
  for (const p of AppState.productos) {
    total++;
    const catId = p.categoriaId;
    if (!porCategoria[catId]) porCategoria[catId] = { total: 0, unidades: 0, dinero: 0 };
    porCategoria[catId].total++;
    if (p.stockHabilitado !== false && p.stock > 0) {
      const stock = parseFloat(p.stock) || 0;
      const valor = parseFloat(p.costo) > 0 ? parseFloat(p.costo) : parseFloat(p.precio) || 0;
      unidades += stock;
      dinero   += valor * stock;
      porCategoria[catId].unidades += stock;
      porCategoria[catId].dinero   += valor * stock;
    }
  }
  _invStats = { total, unidades, dinero, porCategoria };
}

// ─── RENDER PRINCIPAL DE INVENTARIO ──────────────────────────────────────────

export function renderInventario() {
  const fmtUds = v => v % 1 === 0 ? String(v) : v.toLocaleString('es-DO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  const elTotal  = document.getElementById('inv-stat-total-prods');
  const elDinero = document.getElementById('inv-stat-dinero');
  if (elTotal)  elTotal.innerHTML  = `${_invStats.total} <span style="font-size:0.75rem;font-weight:600;color:#16a34a;background:#dcfce7;border-radius:20px;padding:2px 8px;vertical-align:middle;">${fmtUds(_invStats.unidades)} uds en stock</span>`;
  if (elDinero) elDinero.textContent = 'RD$ ' + _invStats.dinero.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (inventarioCategoriaActual === '__mas_vendidos__') {
    renderMasVendidosInventario();
  } else if (inventarioCategoriaActual) {
    renderProductosInventario(inventarioCategoriaActual, inventarioBusquedaActual);
  } else {
    renderCategoriasInventario();
  }
}
window.renderInventario = renderInventario;

// ─── RENDER CATEGORÍAS ───────────────────────────────────────────────────────

export function renderCategoriasInventario() {
  const grid = document.getElementById('inv-categorias-grid');
  if (!grid) return;

  grid.innerHTML = AppState.categorias.map((cat, i) => {
    const stats = _invStats.porCategoria[cat.id] || { total: 0, unidades: 0, dinero: 0 };
    return `<div class="cat-card-inv" data-id="${cat.id}" draggable="false"
        onclick="verProductosCat('${cat.id}')">
      <div class="cat-card-img-wrap">
        ${cat.imagen ? `<img src="${cat.imagen}" class="cat-card-img" alt="${cat.nombre}">` : `<div class="cat-card-emoji">${cat.emoji || '📦'}</div>`}
      </div>
      <div class="cat-card-info">
        <div class="cat-card-nombre">${cat.nombre}</div>
        <div class="cat-card-stats">${stats.total} prods · ${fmt(stats.dinero)}</div>
      </div>
      <div class="cat-card-acciones">
        <button class="btn-sm azul" onclick="event.stopPropagation();abrirModalCategoria('${cat.id}')">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-sm rojo" onclick="event.stopPropagation();eliminarCategoria('${cat.id}')">
          <i class="fas fa-trash"></i>
        </button>
      </div>
      <span class="orden-badge">${i + 1}</span>
    </div>`;
  }).join('') + `<div class="cat-card-inv cat-card-nueva" onclick="abrirModalCategoria()">
    <div class="cat-card-img-wrap"><div class="cat-card-emoji">➕</div></div>
    <div class="cat-card-info"><div class="cat-card-nombre">Nueva Categoría</div></div>
  </div>`;

  _attachDragDrop(grid, 'cat');
}
window.renderCategoriasInventario = renderCategoriasInventario;

// ─── RENDER PRODUCTOS DE UNA CATEGORÍA ───────────────────────────────────────

export function renderProductosInventario(catId, busqueda = '') {
  inventarioCategoriaActual = catId;
  inventarioBusquedaActual  = busqueda;

  const wrapper = document.getElementById('inv-productos-wrapper');
  if (!wrapper) return;

  const cat    = AppState.categorias.find(c => c.id === catId);
  const todos  = AppState.productos.filter(p => p.categoriaId === catId);
  const prods  = busqueda
    ? todos.filter(p => p.nombre?.toLowerCase().includes(busqueda.toLowerCase()) || p.codigoBarras?.includes(busqueda))
    : todos.sort((a, b) => (a.orden || 9999) - (b.orden || 9999));

  wrapper.innerHTML = `
    <div class="inv-productos-header">
      <button class="btn-sm gris" onclick="verCategoriasInv()"><i class="fas fa-arrow-left"></i> Categorías</button>
      <h3 style="margin:0;">${cat?.nombre || 'Productos'}</h3>
      <button class="btn-sm verde" onclick="abrirModalProducto(null,'${catId}')"><i class="fas fa-plus"></i> Agregar</button>
      <button class="btn-sm" id="btn-modo-ordenar" onclick="toggleModoOrden()"><i class="fas fa-arrows-alt"></i> Ordenar</button>
    </div>
    <div class="inv-busqueda-row">
      <input type="text" placeholder="Buscar producto..." value="${busqueda}"
        oninput="renderProductosInventario('${catId}', this.value)"
        style="flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;outline:none;">
    </div>
    <div class="productos-grid-inv" id="productos-grid-inv">
      ${prods.map((prod, i) => _renderProdCardInv(prod, i)).join('')}
      ${!prods.length ? `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#aab4c8;"><i class="fas fa-box-open" style="font-size:2rem;display:block;margin-bottom:8px;"></i>Sin productos en esta categoría</div>` : ''}
    </div>`;

  const grid = document.getElementById('productos-grid-inv');
  if (grid) _attachDragDrop(grid, 'prod', catId);
}
window.renderProductosInventario = renderProductosInventario;

function _renderProdCardInv(prod, i) {
  const sinStock = prod.stockHabilitado !== false && prod.stock <= 0;
  return `<div class="prod-card-inv ${sinStock ? 'sin-stock' : ''}" data-id="${prod.id}" draggable="false">
    <div class="prod-card-inv-img">
      ${prod.imagen ? `<img src="${prod.imagen}" alt="${prod.nombre}">` : `<div class="prod-emoji-big">📦</div>`}
    </div>
    <div class="prod-card-inv-info">
      <div class="prod-card-inv-nombre">${prod.nombre}</div>
      <div class="prod-card-inv-precio">${fmt(prod.precio)}</div>
      <div class="prod-card-inv-stock ${sinStock ? 'agotado' : ''}">
        ${prod.stockHabilitado === false ? 'Stock: ∞' : `Stock: ${prod.stock || 0} ${prod.unidad || 'uds'}`}
      </div>
    </div>
    <div class="prod-card-inv-acciones">
      <button class="btn-sm azul" onclick="abrirModalProducto('${prod.id}','${prod.categoriaId}')">
        <i class="fas fa-edit"></i> Editar
      </button>
      <button class="btn-sm rojo" onclick="eliminarProducto('${prod.id}')">
        <i class="fas fa-trash"></i>
      </button>
    </div>
    <span class="orden-badge">${i + 1}</span>
  </div>`;
}

window.verProductosCat = (catId) => renderProductosInventario(catId);
window.verCategoriasInv = () => {
  inventarioCategoriaActual = null;
  inventarioBusquedaActual  = '';
  const wrapper = document.getElementById('inv-productos-wrapper');
  if (wrapper) wrapper.innerHTML = '';
  renderCategoriasInventario();
};

// ─── MÁS VENDIDOS ────────────────────────────────────────────────────────────

export function renderMasVendidosInventario() {
  // Ordenar por ventas (campo masVendidos o conteo de facturas)
  const masVendidos = [...AppState.productos]
    .sort((a, b) => (b.masVendidos || 0) - (a.masVendidos || 0))
    .slice(0, 20);

  const wrapper = document.getElementById('inv-productos-wrapper');
  if (!wrapper) return;
  wrapper.innerHTML = `
    <div class="inv-productos-header">
      <button class="btn-sm gris" onclick="verCategoriasInv()"><i class="fas fa-arrow-left"></i> Categorías</button>
      <h3 style="margin:0;">⭐ Más Vendidos</h3>
    </div>
    <div class="productos-grid-inv">
      ${masVendidos.map((p, i) => _renderProdCardInv(p, i)).join('')}
      ${!masVendidos.length ? `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#aab4c8;">No hay datos de ventas aún</div>` : ''}
    </div>`;
}
window.renderMasVendidosInventario = renderMasVendidosInventario;

// ─── MODAL CATEGORÍA ─────────────────────────────────────────────────────────

let _catEditandoId = null;

export function abrirModalCategoria(catId = null) {
  _catEditandoId = catId;
  const cat = catId ? AppState.categorias.find(c => c.id === catId) : null;

  const titulo = document.getElementById('modal-cat-titulo');
  if (titulo) titulo.textContent = catId ? 'Editar Categoría' : 'Nueva Categoría';

  const inp = document.getElementById('cat-nombre');
  if (inp) inp.value = cat?.nombre || '';

  const prev = document.getElementById('cat-img-preview');
  if (prev) { prev.src = cat?.imagen || ''; prev.style.display = cat?.imagen ? 'block' : 'none'; }

  abrirModal('modal-categoria');
}
window.abrirModalCategoria = abrirModalCategoria;

export async function guardarCategoria() {
  const nombre = document.getElementById('cat-nombre')?.value.trim();
  if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }

  const db      = getDb();
  const imgInput = document.getElementById('cat-imagen');
  let imagen    = _catEditandoId ? (AppState.categorias.find(c => c.id === _catEditandoId)?.imagen || '') : '';

  const btn = document.getElementById('btn-guardar-categoria');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'; }

  try {
    if (imgInput?.files[0]) {
      const dataUrl   = await comprimirImagen(imgInput.files[0], 400, 0.85);
      const storagePath = `negocios/${AppState.negocioId}/categorias/${_catEditandoId || Date.now()}`;
      imagen = await subirImagenBase64(dataUrl, storagePath);
    }

    if (_catEditandoId) {
      await _fsOp(() => updateDoc(doc(db, 'negocios', AppState.negocioId, 'categorias', _catEditandoId), { nombre, imagen }));
      const idx = AppState.categorias.findIndex(c => c.id === _catEditandoId);
      if (idx >= 0) AppState.categorias[idx] = { ...AppState.categorias[idx], nombre, imagen };
      toast('Categoría actualizada ✅', 'success');
    } else {
      const orden  = AppState.categorias.length + 1;
      const catRef = await _fsOp(() => addDoc(collection(db, 'negocios', AppState.negocioId, 'categorias'), { nombre, imagen, orden, creadoEn: serverTimestamp() }));
      AppState.categorias.push({ id: catRef.id, nombre, imagen, orden });
      toast('Categoría creada ✅', 'success');
    }

    cerrarModal('modal-categoria');
    renderInventario();
    if (window.renderCategoriasPos) window.renderCategoriasPos();
    if (window.populateCatSelects)  window.populateCatSelects();
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Guardar'; }
  }
}
window.guardarCategoria = guardarCategoria;

export async function eliminarCategoria(catId) {
  if (!confirm('¿Eliminar esta categoría y todos sus productos?')) return;
  const db = getDb();
  try {
    // Eliminar todos los productos de la categoría
    const prodSnap = await getDocs(collection(db, 'negocios', AppState.negocioId, 'categorias', catId, 'productos'));
    const batch = writeBatch(db);
    prodSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(doc(db, 'negocios', AppState.negocioId, 'categorias', catId));
    await _fsOp(() => batch.commit());

    AppState.categorias = AppState.categorias.filter(c => c.id !== catId);
    AppState.productos   = AppState.productos.filter(p => p.categoriaId !== catId);
    _recalcularInvStats();
    renderInventario();
    if (window.renderCategoriasPos) window.renderCategoriasPos();
    toast('Categoría eliminada ✅', 'success');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}
window.eliminarCategoria = eliminarCategoria;

// ─── MODAL PRODUCTO ──────────────────────────────────────────────────────────

let _prodEditandoId  = null;
let _prodEditandoCat = null;

export function abrirModalProducto(prodId = null, catId = null) {
  _prodEditandoId  = prodId;
  _prodEditandoCat = catId || inventarioCategoriaActual;

  const prod = prodId ? AppState.productos.find(p => p.id === prodId) : null;

  const titulo = document.getElementById('modal-prod-titulo');
  if (titulo) titulo.textContent = prodId ? 'Editar Producto' : 'Nuevo Producto';

  // Rellenar campos
  _setVal('prod-nombre',        prod?.nombre || '');
  _setVal('prod-precio',        prod?.precio || '');
  _setVal('prod-costo',         prod?.costo || '');
  _setVal('prod-stock',         prod?.stock ?? '');
  _setVal('prod-unidad',        prod?.unidad || '');
  _setVal('prod-codigo-barras', prod?.codigoBarras || '');
  _setVal('prod-peso-neto',     prod?.pesoNeto || '');

  const chkStock = document.getElementById('prod-stock-habilitado');
  if (chkStock) chkStock.checked = prod?.stockHabilitado !== false;

  const chkCombo = document.getElementById('prod-combo-activo');
  if (chkCombo) chkCombo.checked = prod?.comboActivo === true;
  _setVal('prod-combo-precio',   prod?.comboPrecio || '');
  _setVal('prod-combo-unidades', prod?.comboUnidades || '');

  // Selector de categoría
  populateCatSelects();
  const selCat = document.getElementById('prod-categoria');
  if (selCat) selCat.value = prod?.categoriaId || _prodEditandoCat || '';

  // Preview imagen
  const prev = document.getElementById('prod-img-preview');
  if (prev) { prev.src = prod?.imagen || ''; prev.style.display = prod?.imagen ? 'block' : 'none'; }

  abrirModal('modal-producto');
}
window.abrirModalProducto = abrirModalProducto;

function _setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

export async function guardarProducto() {
  const catId = document.getElementById('prod-categoria')?.value;
  if (!catId) { toast('Selecciona una categoría', 'error'); return; }

  const nombre = document.getElementById('prod-nombre')?.value.trim();
  if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }

  const data = {
    nombre,
    precio:          parseFloat(document.getElementById('prod-precio')?.value) || 0,
    costo:           parseFloat(document.getElementById('prod-costo')?.value) || 0,
    stock:           parseFloat(document.getElementById('prod-stock')?.value) || 0,
    unidad:          document.getElementById('prod-unidad')?.value.trim() || '',
    codigoBarras:    document.getElementById('prod-codigo-barras')?.value.trim() || '',
    pesoNeto:        document.getElementById('prod-peso-neto')?.value.trim() || '',
    stockHabilitado: document.getElementById('prod-stock-habilitado')?.checked !== false,
    comboActivo:     document.getElementById('prod-combo-activo')?.checked === true,
    comboPrecio:     parseFloat(document.getElementById('prod-combo-precio')?.value) || 0,
    comboUnidades:   parseInt(document.getElementById('prod-combo-unidades')?.value) || 0,
    categoriaId:     catId,
  };

  const db  = getDb();
  const btn = document.getElementById('btn-guardar-producto');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'; }

  try {
    // Imagen
    const imgInput = document.getElementById('prod-imagen');
    let imagen = _prodEditandoId ? (AppState.productos.find(p => p.id === _prodEditandoId)?.imagen || '') : '';
    if (imgInput?.files[0]) {
      const dataUrl     = await comprimirImagen(imgInput.files[0]);
      const storagePath = `negocios/${AppState.negocioId}/categorias/${catId}/productos/${_prodEditandoId || 'nuevo_' + Date.now()}`;
      imagen = await subirImagenBase64(dataUrl, storagePath);
    }
    data.imagen = imagen;

    if (_prodEditandoId) {
      await _fsOp(() => updateDoc(
        doc(db, 'negocios', AppState.negocioId, 'categorias', catId, 'productos', _prodEditandoId),
        data
      ));
      const idx = AppState.productos.findIndex(p => p.id === _prodEditandoId);
      if (idx >= 0) AppState.productos[idx] = { ...AppState.productos[idx], ...data };
      toast('Producto actualizado ✅', 'success');
    } else {
      const orden   = AppState.productos.filter(p => p.categoriaId === catId).length + 1;
      const prodRef = await _fsOp(() => addDoc(
        collection(db, 'negocios', AppState.negocioId, 'categorias', catId, 'productos'),
        { ...data, orden, creadoEn: serverTimestamp() }
      ));
      if (imagen && !imagen.startsWith('http')) {
        _actualizarFirestoreEnCola(imagen, `negocios/${AppState.negocioId}/categorias/${catId}/productos/${prodRef.id}`, 'imagen');
      }
      AppState.productos.push({ ...data, id: prodRef.id, orden });
      toast('Producto creado ✅', 'success');
    }

    cerrarModal('modal-producto');
    _recalcularInvStats();
    renderInventario();
    if (window.renderCategoriasPos) window.renderCategoriasPos();
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Guardar'; }
  }
}
window.guardarProducto = guardarProducto;

export async function eliminarProducto(prodId) {
  if (!confirm('¿Eliminar este producto?')) return;
  const prod = AppState.productos.find(p => p.id === prodId);
  if (!prod) return;
  const db = getDb();
  try {
    await _fsOp(() => deleteDoc(doc(db, 'negocios', AppState.negocioId, 'categorias', prod.categoriaId, 'productos', prodId)));
    AppState.productos = AppState.productos.filter(p => p.id !== prodId);
    _recalcularInvStats();
    renderInventario();
    if (window.renderCategoriasPos) window.renderCategoriasPos();
    toast('Producto eliminado ✅', 'success');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}
window.eliminarProducto = eliminarProducto;

// ─── POPULATE SELECTS DE CATEGORÍAS ─────────────────────────────────────────

export function populateCatSelects() {
  document.querySelectorAll('.cat-select').forEach(sel => {
    const val = sel.value;
    sel.innerHTML = `<option value="">-- Selecciona categoría --</option>` +
      AppState.categorias.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    sel.value = val;
  });
}
window.populateCatSelects = populateCatSelects;

// ─── PREVIEW DE IMAGEN ───────────────────────────────────────────────────────

window.previewImagen = async (input) => {
  const file = input.files[0];
  if (!file) return;
  try {
    const dataUrl = await comprimirImagen(file);
    const prev    = document.getElementById('prod-img-preview') || document.getElementById('cat-img-preview');
    if (prev) { prev.src = dataUrl; prev.style.display = 'block'; }
  } catch(e) {
    toast('Error al previsualizar imagen', 'error');
  }
};

// ─── EXPORTAR INVENTARIO ─────────────────────────────────────────────────────

export function exportarInventarioCompleto() {
  const data = {
    _appName:    'miColmApp',
    _exportDate: new Date().toISOString(),
    categorias:  AppState.categorias,
    productos:   AppState.productos,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `inventario_${AppState.negocioData?.nombre || 'negocio'}_${new Date().toLocaleDateString('es-DO')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('✅ Inventario exportado', 'success');
}
window.exportarInventarioCompleto = exportarInventarioCompleto;

// ─── IMPORTAR INVENTARIO ─────────────────────────────────────────────────────

export function importarInventario(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    let data;
    try { data = JSON.parse(ev.target.result); }
    catch(err) { toast('❌ El archivo no es válido. Debe ser un archivo .json de miColmApp.', 'error', 4000); return; }

    if (!data._appName || data._appName !== 'miColmApp' || !Array.isArray(data.categorias) || !Array.isArray(data.productos)) {
      toast('❌ Archivo inválido. Solo se aceptan exportaciones de miColmApp.', 'error', 4000);
      return;
    }

    _importPendingData = data;
    const fechaExport  = data._exportDate
      ? new Date(data._exportDate).toLocaleDateString('es-DO', { day:'2-digit', month:'long', year:'numeric' })
      : 'Desconocida';

    const resumen = document.getElementById('inv-confirm-resumen');
    if (resumen) resumen.innerHTML =
      `📁 <strong>${data.categorias.length}</strong> categorías<br>
       📦 <strong>${data.productos.length}</strong> productos<br>
       🗓️ Exportado el: <strong>${fechaExport}</strong>`;

    const modal = document.getElementById('modal-inv-confirmar-import');
    if (modal) modal.classList.add('activo');
  };
  reader.readAsText(file);
}
window.importarInventario = importarInventario;

export function cancelarImport() {
  _importPendingData = null;
  const modal = document.getElementById('modal-inv-confirmar-import');
  if (modal) modal.classList.remove('activo');
}
window.cancelarImport = cancelarImport;

export async function confirmarImport() {
  const modal = document.getElementById('modal-inv-confirmar-import');
  if (modal) modal.classList.remove('activo');
  const data = _importPendingData;
  _importPendingData = null;
  if (!data) return;

  const db    = getDb();
  const total = data.categorias.length + data.productos.length;
  let procesados = 0;

  _showProgreso('📥 Importando Inventario', 'Borrando inventario actual...');

  try {
    // 1. Borrar categorías y productos actuales
    const catsRef  = collection(db, 'negocios', AppState.negocioId, 'categorias');
    const catsSnap = await getDocs(catsRef);
    for (const catDoc of catsSnap.docs) {
      const prodsSnap = await getDocs(collection(db, 'negocios', AppState.negocioId, 'categorias', catDoc.id, 'productos'));
      for (const pDoc of prodsSnap.docs) await deleteDoc(pDoc.ref);
      await deleteDoc(catDoc.ref);
    }

    // 2. Importar categorías
    for (const cat of data.categorias) {
      await setDoc(doc(db, 'negocios', AppState.negocioId, 'categorias', cat.id), { ...cat });
      procesados++;
      _setProgreso((procesados / total) * 100);
    }

    // 3. Importar productos
    for (const prod of data.productos) {
      if (!prod.categoriaId) continue;
      await setDoc(
        doc(db, 'negocios', AppState.negocioId, 'categorias', prod.categoriaId, 'productos', prod.id),
        { ...prod }
      );
      procesados++;
      _setProgreso((procesados / total) * 100);
    }

    // 4. Actualizar estado local
    AppState.categorias = data.categorias;
    AppState.productos   = data.productos;
    _recalcularInvStats();
    renderInventario();
    if (window.populateCatSelects) window.populateCatSelects();

    _finProgreso(`✅ Inventario importado: ${data.productos.length} productos en ${data.categorias.length} categorías`);
  } catch(err) {
    const progModal = document.getElementById('modal-inv-progreso');
    if (progModal) progModal.classList.remove('activo');
    toast('❌ Error al importar: ' + (err.message || err), 'error', 5000);
  }
}
window.confirmarImport = confirmarImport;

// ─── HELPERS DE PROGRESO ─────────────────────────────────────────────────────

function _showProgreso(titulo, msg) {
  const modal  = document.getElementById('modal-inv-progreso');
  const titEl  = document.getElementById('inv-prog-titulo');
  const msgEl  = document.getElementById('inv-prog-msg');
  const barEl  = document.getElementById('inv-prog-bar');
  if (titEl)  titEl.textContent = titulo;
  if (msgEl)  msgEl.textContent = msg;
  if (barEl)  barEl.style.width = '0%';
  if (modal)  modal.classList.add('activo');
}
function _setProgreso(pct) {
  const barEl = document.getElementById('inv-prog-bar');
  if (barEl) barEl.style.width = Math.round(pct) + '%';
}
function _finProgreso(msg) {
  _setProgreso(100);
  setTimeout(() => {
    const modal = document.getElementById('modal-inv-progreso');
    if (modal) modal.classList.remove('activo');
    toast(msg, 'success', 5000);
  }, 800);
}

// ─── MODO ORDENAR (DRAG & DROP) ──────────────────────────────────────────────

export function toggleModoOrden() {
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
}
window.toggleModoOrden = toggleModoOrden;

function _attachDragDrop(container, type, catId = null) {
  const cards = container.querySelectorAll(type === 'cat' ? '.cat-card-inv' : '.prod-card-inv');

  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      if (!modoOrdenActivo) { e.preventDefault(); return; }
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', (e) => {
      if (!modoOrdenActivo) return;
      e.preventDefault();
      container.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
      card.classList.add('drag-over');
    });
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!modoOrdenActivo) return;
      const dragging = container.querySelector('.dragging');
      if (!dragging || dragging === card) return;
      card.classList.remove('drag-over');

      const allCards = [...container.children];
      const srcIdx   = allCards.indexOf(dragging);
      const dstIdx   = allCards.indexOf(card);
      if (srcIdx < dstIdx) container.insertBefore(dragging, card.nextSibling);
      else container.insertBefore(dragging, card);

      const newOrder = [...container.children].map(c => c.dataset.id).filter(Boolean);
      await _guardarOrden(type, newOrder, catId);
    });
  });
}

async function _guardarOrden(type, newOrder, catId) {
  const db    = getDb();
  const batch = writeBatch(db);

  if (type === 'cat') {
    newOrder.forEach((id, i) => {
      const cat = AppState.categorias.find(c => c.id === id);
      if (cat) { cat.orden = i + 1; batch.update(doc(db, 'negocios', AppState.negocioId, 'categorias', id), { orden: i + 1 }); }
    });
    AppState.categorias.sort((a, b) => (a.orden || 9999) - (b.orden || 9999));
    if (window.renderCategoriasPos) window.renderCategoriasPos();
  } else {
    newOrder.forEach((id, i) => {
      const prod = AppState.productos.find(p => p.id === id);
      if (prod) { prod.orden = i + 1; batch.update(doc(db, 'negocios', AppState.negocioId, 'categorias', catId, 'productos', id), { orden: i + 1 }); }
    });
  }

  await _fsOp(() => batch.commit());
}

console.log('[inventario] Módulo de inventario cargado ✅');
