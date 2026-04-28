/**
 * ════════════════════════════════════════════════════════════════════
 * MÓDULO 3: caja.js — Gestión de Caja y Movimientos
 * RESPONSABILIDAD: Control financiero del turno de trabajo:
 *                  apertura/cierre de caja y registro de gastos/ingresos.
 *
 * BENEFICIO DE SEPARACIÓN:
 *   Facilita la auditoría financiera. Puedes escalar este módulo
 *   a un sistema contable complejo (libro mayor, balance diario)
 *   sin tocar el POS ni el inventario.
 *
 * FUNCIONES EXPUESTAS EN window:
 *   abrirCaja()              → Abre una nueva caja con fondo inicial
 *   cerrarCaja()             → Cierra la caja activa y genera el resumen
 *   confirmarCerrarCaja()    → Confirma el cierre tras verificar diferencias
 *   registrarGasto(datos)    → Registra un egreso en la caja activa
 *   registrarIngreso(datos)  → Registra un ingreso adicional en la caja
 *   renderCaja()             → Renderiza la pantalla de caja
 *   renderMovimientos()      → Lista los movimientos del turno actual
 *   exportarMovimientos()    → Exporta movimientos a CSV
 *
 * ESCUCHA EL EVENTO:
 *   'micolmapp:negocio-listo'  → Inicializa y suscribe al estado de caja
 *   'micolmapp:page-change'    → Re-renderiza cuando se navega a "caja"
 * ════════════════════════════════════════════════════════════════════
 */

import {
  collection, doc, addDoc, updateDoc, getDoc, getDocs,
  query, where, orderBy, onSnapshot, Timestamp, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { AppState }           from './app-state.js';
import { fmt, toast, abrirModal, cerrarModal } from './utils.js';
import { _fsOp }              from './offline.js';

const getDb = () => window._db;

// ─── ESTADO LOCAL DE CAJA ───────────────────────────────────────────────────

let _unsubMovimientos = null;

// ─── INICIALIZACIÓN ─────────────────────────────────────────────────────────

window.addEventListener('micolmapp:negocio-listo', async () => {
  await _cargarCajaActual();
});

window.addEventListener('micolmapp:page-change', ({ detail }) => {
  if (detail.page === 'caja') renderCaja();
});

// ─── CARGAR CAJA ACTIVA ──────────────────────────────────────────────────────

async function _cargarCajaActual() {
  const db = getDb();
  try {
    const q     = query(
      collection(db, 'negocios', AppState.negocioId, 'cajas'),
      where('estado', '==', 'abierta'),
      orderBy('fechaApertura', 'desc')
    );
    const snap  = await getDocs(q);
    if (!snap.empty) {
      const cajaDoc        = snap.docs[0];
      AppState.cajaActual  = { id: cajaDoc.id, ...cajaDoc.data() };
      _suscribirMovimientos(cajaDoc.id);
    } else {
      AppState.cajaActual = null;
    }
  } catch(e) {
    console.warn('[caja] Error cargando caja:', e);
  }
  _actualizarBannerCaja();
}

function _suscribirMovimientos(cajaId) {
  if (_unsubMovimientos) _unsubMovimientos();
  const db = getDb();
  const q  = query(
    collection(db, 'negocios', AppState.negocioId, 'movimientos'),
    where('cajaId', '==', cajaId),
    orderBy('fecha', 'desc')
  );
  _unsubMovimientos = onSnapshot(q, (snap) => {
    AppState.movimientosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMovimientos();
  });
}

function _actualizarBannerCaja() {
  const banner = document.getElementById('caja-pendiente-banner');
  if (banner) banner.style.display = AppState.cajaActual ? 'none' : 'flex';
}

// ─── RENDER DE LA PÁGINA DE CAJA ────────────────────────────────────────────

export function renderCaja() {
  const caja = AppState.cajaActual;

  // Estado de la caja
  const estadoEl = document.getElementById('caja-estado');
  if (estadoEl) {
    estadoEl.innerHTML = caja
      ? `<div class="caja-abierta-badge"><i class="fas fa-lock-open"></i> Caja Abierta</div>
         <div class="caja-fondo">Fondo inicial: <strong>${fmt(caja.fondoInicial || 0)}</strong></div>
         <div class="caja-apertura">Abierta: ${caja.fechaApertura?.toDate ? caja.fechaApertura.toDate().toLocaleString('es-DO') : '—'}</div>`
      : `<div class="caja-cerrada-badge"><i class="fas fa-lock"></i> Caja Cerrada</div>
         <p style="color:#718096;font-size:14px;margin-top:8px;">Abre la caja para empezar a registrar ventas.</p>`;
  }

  // Botones de acción
  const botonesEl = document.getElementById('caja-botones');
  if (botonesEl) {
    botonesEl.innerHTML = caja
      ? `<button class="btn-sm rojo" onclick="cerrarCaja()"><i class="fas fa-lock"></i> Cerrar Caja</button>
         <button class="btn-sm amarillo" onclick="abrirModalGasto()"><i class="fas fa-minus-circle"></i> Registrar Gasto</button>
         <button class="btn-sm verde" onclick="abrirModalIngreso()"><i class="fas fa-plus-circle"></i> Registrar Ingreso</button>`
      : `<button class="btn-sm verde" onclick="abrirModalAbrirCaja()"><i class="fas fa-lock-open"></i> Abrir Caja</button>`;
  }

  renderMovimientos();
}
window.renderCaja = renderCaja;

// ─── APERTURA DE CAJA ────────────────────────────────────────────────────────

window.abrirModalAbrirCaja = () => abrirModal('modal-abrir-caja');

export async function abrirCaja() {
  const fondoInput = document.getElementById('caja-fondo-inicial');
  const fondo      = parseFloat(fondoInput?.value) || 0;
  const db         = getDb();

  try {
    const cajaRef = await _fsOp(() => addDoc(collection(db, 'negocios', AppState.negocioId, 'cajas'), {
      estado:          'abierta',
      fondoInicial:    fondo,
      fechaApertura:   serverTimestamp(),
      empleadoNombre:  AppState.currentUser?.email || '—',
    }));

    AppState.cajaActual = { id: cajaRef.id, estado: 'abierta', fondoInicial: fondo, fechaApertura: { toDate: () => new Date() } };
    _suscribirMovimientos(cajaRef.id);
    cerrarModal('modal-abrir-caja');
    _actualizarBannerCaja();
    renderCaja();
    toast('✅ Caja abierta exitosamente', 'success');
  } catch(e) {
    toast('Error al abrir la caja: ' + e.message, 'error');
  }
}
window.abrirCaja = abrirCaja;

// ─── CIERRE DE CAJA ──────────────────────────────────────────────────────────

export async function cerrarCaja() {
  if (!AppState.cajaActual) { toast('No hay caja abierta', 'error'); return; }

  // Calcular totales del turno
  const movs     = AppState.movimientosCache;
  const ventas   = movs.filter(m => m.tipo === 'venta').reduce((s, m) => s + (m.monto || 0), 0);
  const gastos   = movs.filter(m => m.tipo === 'gasto').reduce((s, m) => s + (m.monto || 0), 0);
  const ingresos = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0);
  const efectivoEsperado = (AppState.cajaActual.fondoInicial || 0) + ventas + ingresos - gastos;

  // Mostrar resumen en el modal
  const resumenEl = document.getElementById('cierre-resumen');
  if (resumenEl) {
    resumenEl.innerHTML = `
      <div class="cierre-row"><span>Fondo inicial</span><span>${fmt(AppState.cajaActual.fondoInicial || 0)}</span></div>
      <div class="cierre-row"><span>Ventas en efectivo</span><span>${fmt(ventas)}</span></div>
      <div class="cierre-row"><span>Ingresos adicionales</span><span>${fmt(ingresos)}</span></div>
      <div class="cierre-row rojo"><span>Gastos</span><span>-${fmt(gastos)}</span></div>
      <div class="cierre-row total"><span>Efectivo esperado</span><span>${fmt(efectivoEsperado)}</span></div>
    `;
  }
  abrirModal('modal-cerrar-caja');
}
window.cerrarCaja = cerrarCaja;

export async function confirmarCerrarCaja() {
  if (!AppState.cajaActual) return;
  const efectivoReal = parseFloat(document.getElementById('caja-efectivo-real')?.value) || 0;
  const db           = getDb();

  const movs              = AppState.movimientosCache;
  const ventas            = movs.filter(m => m.tipo === 'venta').reduce((s, m) => s + (m.monto || 0), 0);
  const gastos            = movs.filter(m => m.tipo === 'gasto').reduce((s, m) => s + (m.monto || 0), 0);
  const ingresos          = movs.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + (m.monto || 0), 0);
  const efectivoEsperado  = (AppState.cajaActual.fondoInicial || 0) + ventas + ingresos - gastos;
  const diferencia        = efectivoReal - efectivoEsperado;

  try {
    await _fsOp(() => updateDoc(doc(db, 'negocios', AppState.negocioId, 'cajas', AppState.cajaActual.id), {
      estado:          'cerrada',
      fechaCierre:     serverTimestamp(),
      efectivoEsperado,
      efectivoReal,
      diferencia,
      totalVentas:     ventas,
      totalGastos:     gastos,
      totalIngresos:   ingresos,
    }));

    if (_unsubMovimientos) { _unsubMovimientos(); _unsubMovimientos = null; }
    AppState.cajaActual       = null;
    AppState.movimientosCache = [];

    cerrarModal('modal-cerrar-caja');
    _actualizarBannerCaja();
    renderCaja();
    toast('✅ Caja cerrada. ' + (diferencia !== 0 ? `Diferencia: ${fmt(Math.abs(diferencia))} ${diferencia > 0 ? '(sobrante)' : '(faltante)'}` : 'Sin diferencias.'), 'success', 6000);
  } catch(e) {
    toast('Error al cerrar la caja: ' + e.message, 'error');
  }
}
window.confirmarCerrarCaja = confirmarCerrarCaja;

// ─── REGISTRAR GASTO ────────────────────────────────────────────────────────

window.abrirModalGasto = () => abrirModal('modal-gasto');

export async function registrarGasto() {
  if (!AppState.cajaActual) { toast('No hay caja abierta', 'error'); return; }

  const descripcion = document.getElementById('gasto-descripcion')?.value.trim();
  const monto       = parseFloat(document.getElementById('gasto-monto')?.value) || 0;
  if (!descripcion || monto <= 0) { toast('Completa descripción y monto', 'error'); return; }

  const db = getDb();
  try {
    await _fsOp(() => addDoc(collection(db, 'negocios', AppState.negocioId, 'movimientos'), {
      tipo:          'gasto',
      descripcion,
      monto,
      cajaId:        AppState.cajaActual.id,
      empleadoNombre: AppState.currentUser?.email || '—',
      fecha:         serverTimestamp(),
    }));
    cerrarModal('modal-gasto');
    const inp1 = document.getElementById('gasto-descripcion'); if (inp1) inp1.value = '';
    const inp2 = document.getElementById('gasto-monto');       if (inp2) inp2.value = '';
    toast('Gasto registrado ✅', 'success');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}
window.registrarGasto = registrarGasto;

// ─── REGISTRAR INGRESO ADICIONAL ─────────────────────────────────────────────

window.abrirModalIngreso = () => abrirModal('modal-ingreso');

export async function registrarIngreso() {
  if (!AppState.cajaActual) { toast('No hay caja abierta', 'error'); return; }

  const descripcion = document.getElementById('ingreso-descripcion')?.value.trim();
  const monto       = parseFloat(document.getElementById('ingreso-monto')?.value) || 0;
  if (!descripcion || monto <= 0) { toast('Completa descripción y monto', 'error'); return; }

  const db = getDb();
  try {
    await _fsOp(() => addDoc(collection(db, 'negocios', AppState.negocioId, 'movimientos'), {
      tipo:           'ingreso',
      descripcion,
      monto,
      cajaId:         AppState.cajaActual.id,
      empleadoNombre: AppState.currentUser?.email || '—',
      fecha:          serverTimestamp(),
    }));
    cerrarModal('modal-ingreso');
    const inp1 = document.getElementById('ingreso-descripcion'); if (inp1) inp1.value = '';
    const inp2 = document.getElementById('ingreso-monto');       if (inp2) inp2.value = '';
    toast('Ingreso registrado ✅', 'success');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}
window.registrarIngreso = registrarIngreso;

// ─── RENDER DE MOVIMIENTOS ───────────────────────────────────────────────────

export function renderMovimientos() {
  const lista = document.getElementById('movimientos-lista');
  if (!lista) return;

  const movs = AppState.movimientosCache;
  if (!movs.length) {
    lista.innerHTML = `<div style="text-align:center;padding:20px;color:#aab4c8;">Sin movimientos en esta caja</div>`;
    return;
  }

  lista.innerHTML = movs.map(m => {
    const fecha   = m.fecha?.toDate ? m.fecha.toDate().toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' }) : '—';
    const colorMap = { venta: '#00b341', gasto: '#e03131', ingreso: '#1971c2' };
    const iconMap  = { venta: 'fa-receipt', gasto: 'fa-minus-circle', ingreso: 'fa-plus-circle' };
    return `<div class="movimiento-item">
      <div class="mov-icon" style="color:${colorMap[m.tipo] || '#718096'};"><i class="fas ${iconMap[m.tipo] || 'fa-circle'}"></i></div>
      <div class="mov-info">
        <div class="mov-desc">${m.descripcion || '—'}</div>
        <div class="mov-meta">${fecha} · ${m.empleadoNombre || '—'}</div>
      </div>
      <div class="mov-monto" style="color:${colorMap[m.tipo] || '#718096'};">
        ${m.tipo === 'gasto' ? '-' : '+'}${fmt(m.monto || 0)}
      </div>
    </div>`;
  }).join('');
}
window.renderMovimientos = renderMovimientos;

// ─── EXPORTAR A CSV ──────────────────────────────────────────────────────────

export function exportarMovimientos() {
  let csv = 'Hora,Tipo,Descripción,Empleado,Monto\n';
  AppState.movimientosCache.forEach(m => {
    const fecha = m.fecha?.toDate ? m.fecha.toDate().toLocaleTimeString('es-DO') : '-';
    csv += `"${fecha}","${m.tipo}","${m.descripcion}","${m.empleadoNombre || '-'}","${m.monto}"\n`;
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `movimientos_${new Date().toLocaleDateString('es-DO')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
window.exportarMovimientos = exportarMovimientos;

console.log('[caja] Módulo de caja cargado ✅');
