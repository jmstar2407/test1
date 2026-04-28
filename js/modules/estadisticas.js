/**
 * ════════════════════════════════════════════════════════════════════
 * MÓDULO 5: estadisticas.js — Estadísticas y Reportes
 * RESPONSABILIDAD: Cálculo de métricas de ventas, generación de gráficos
 *                  con Chart.js, y exportación de reportes.
 *
 * BENEFICIO DE SEPARACIÓN:
 *   Los reportes consumen muchos recursos de procesamiento. Al estar
 *   separados, la generación de un reporte pesado no ralentiza el POS.
 *   Puedes agregar reportes avanzados (ROI, proyecciones) sin tocar ventas.
 *
 * FUNCIONES EXPUESTAS EN window:
 *   calcularEstadisticas(rango)       → Calcula métricas del período
 *   renderEstadisticas()              → Renderiza la pantalla de stats
 *   exportarReporteVentas()           → Exporta CSV de ventas
 *   exportarReportePDF()              → Exporta resumen en PDF (window.print)
 *   filtrarFacturasPorRango(r)        → Filtra facturas por rango de fecha
 *   verDetalleFactura(id)             → Muestra el modal de detalle de factura
 *   verHistorialFacturas()            → Muestra historial completo paginado
 *   buscarFacturasPorTermino(termino) → Búsqueda de facturas
 *
 * ESCUCHA EL EVENTO:
 *   'micolmapp:negocio-listo'  → Carga las facturas iniciales
 *   'micolmapp:page-change'    → Renderiza cuando se navega a "estadisticas"
 * ════════════════════════════════════════════════════════════════════
 */

import {
  collection, doc, getDoc, getDocs, query,
  where, orderBy, limit, startAfter, Timestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { AppState }              from './app-state.js';
import { fmt, toast, abrirModal, cerrarModal } from './utils.js';

const getDb = () => window._db;

// ─── ESTADO LOCAL ────────────────────────────────────────────────────────────

let _charts           = {};   // instancias de Chart.js activas
let _rangoActual      = 'hoy';
let _lastFacturaSnap  = null;
let _cargandoMas      = false;
const FACTURAS_POR_PG = 25;

// ─── INICIALIZACIÓN ──────────────────────────────────────────────────────────

window.addEventListener('micolmapp:negocio-listo', async () => {
  await _cargarFacturasIniciales();
});

window.addEventListener('micolmapp:page-change', ({ detail }) => {
  if (detail.page === 'estadisticas') {
    renderEstadisticas();
  }
});

// ─── CARGA INICIAL DE FACTURAS ────────────────────────────────────────────────

async function _cargarFacturasIniciales() {
  const db = getDb();
  try {
    const q    = query(
      collection(db, 'negocios', AppState.negocioId, 'facturas'),
      orderBy('fecha', 'desc'),
      limit(200)
    );
    const snap = await getDocs(q);
    AppState.facturasCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    _lastFacturaSnap = snap.docs[snap.docs.length - 1] || null;
  } catch(e) {
    console.warn('[estadisticas] Error cargando facturas:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CÁLCULO DE ESTADÍSTICAS
// ═══════════════════════════════════════════════════════════════════════════

export function calcularEstadisticas(rango = 'hoy') {
  _rangoActual = rango;
  const facturas  = filtrarFacturasPorRango(rango, AppState.facturasCache);
  const pagadas   = facturas.filter(f => f.estado === 'pagada');
  const pendientes = facturas.filter(f => f.estado === 'pendiente');

  const totalVentas    = pagadas.reduce((s, f) => s + (f.total || 0), 0);
  const totalSubtotal  = pagadas.reduce((s, f) => s + (f.subtotal || 0), 0);
  const totalItbis     = pagadas.reduce((s, f) => s + (f.itbis || 0), 0);
  const totalPendiente = pendientes.reduce((s, f) => s + (f.total || 0), 0);
  const cantidadVentas = pagadas.length;
  const ticketPromedio = cantidadVentas > 0 ? totalVentas / cantidadVentas : 0;

  // Ventas por método de pago
  const porMetodo = {};
  pagadas.forEach(f => {
    const m = f.metodoPago || 'efectivo';
    porMetodo[m] = (porMetodo[m] || 0) + (f.total || 0);
  });

  // Ventas por día (últimos 7 días si rango es semana/mes)
  const porDia = {};
  pagadas.forEach(f => {
    const fecha = f.fecha?.toDate ? f.fecha.toDate() : new Date(f.fecha);
    const key   = fecha.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit' });
    porDia[key] = (porDia[key] || 0) + (f.total || 0);
  });

  // Ventas por hora (distribución del día)
  const porHora = {};
  pagadas.forEach(f => {
    const fecha = f.fecha?.toDate ? f.fecha.toDate() : new Date(f.fecha);
    const hora  = fecha.getHours();
    porHora[hora] = (porHora[hora] || 0) + 1;
  });

  // Productos más vendidos
  const prodCount = {};
  pagadas.forEach(f => {
    (f.items || []).forEach(item => {
      prodCount[item.nombre] = (prodCount[item.nombre] || 0) + (item.qty || 1);
    });
  });
  const masVendidos = Object.entries(prodCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return {
    totalVentas, totalSubtotal, totalItbis, totalPendiente,
    cantidadVentas, ticketPromedio, porMetodo, porDia, porHora,
    masVendidos, facturas, pagadas, pendientes
  };
}
window.calcularEstadisticas = calcularEstadisticas;

// ─── FILTRAR POR RANGO ───────────────────────────────────────────────────────

export function filtrarFacturasPorRango(rango, facturas = AppState.facturasCache) {
  const ahora  = new Date();
  const hoy    = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const manana = new Date(hoy); manana.setDate(hoy.getDate() + 1);

  let desde, hasta;

  switch(rango) {
    case 'hoy':
      desde = hoy; hasta = manana; break;
    case 'ayer':
      desde = new Date(hoy); desde.setDate(hoy.getDate() - 1);
      hasta = hoy; break;
    case 'semana':
      desde = new Date(hoy); desde.setDate(hoy.getDate() - 7);
      hasta = manana; break;
    case 'mes':
      desde = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      hasta = manana; break;
    case 'mes_pasado':
      desde = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
      hasta = new Date(ahora.getFullYear(), ahora.getMonth(), 1); break;
    case 'personalizado': {
      const dDesde = document.getElementById('stat-fecha-desde')?.value;
      const dHasta = document.getElementById('stat-fecha-hasta')?.value;
      desde = dDesde ? new Date(dDesde + 'T00:00:00') : hoy;
      hasta = dHasta ? new Date(dHasta + 'T23:59:59') : manana;
      break;
    }
    default:
      desde = hoy; hasta = manana;
  }

  return facturas.filter(f => {
    const fecha = f.fecha?.toDate ? f.fecha.toDate() : new Date(f.fecha?.seconds * 1000 || f.fecha);
    return fecha >= desde && fecha < hasta;
  });
}
window.filtrarFacturasPorRango = filtrarFacturasPorRango;

// ═══════════════════════════════════════════════════════════════════════════
// RENDER PRINCIPAL DE ESTADÍSTICAS
// ═══════════════════════════════════════════════════════════════════════════

export function renderEstadisticas() {
  const stats = calcularEstadisticas(_rangoActual);
  _renderKPIs(stats);
  _renderGraficoVentasPorDia(stats);
  _renderGraficoMetodosPago(stats);
  _renderGraficoHoras(stats);
  _renderMasVendidos(stats);
  _renderHistorialReciente(stats.pagadas.slice(0, 20));
  _renderFacturasPendientes(stats.pendientes);
}
window.renderEstadisticas = renderEstadisticas;

// ─── KPIs ────────────────────────────────────────────────────────────────────

function _renderKPIs(stats) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('stat-total-ventas',     fmt(stats.totalVentas));
  set('stat-cant-ventas',      stats.cantidadVentas);
  set('stat-ticket-promedio',  fmt(stats.ticketPromedio));
  set('stat-total-itbis',      fmt(stats.totalItbis));
  set('stat-total-pendiente',  fmt(stats.totalPendiente));

  // Comparar con período anterior (si hay facturas suficientes)
  const anterior = _calcularPeriodoAnterior(_rangoActual);
  if (anterior !== null) {
    const diff = stats.totalVentas - anterior;
    const pct  = anterior > 0 ? ((diff / anterior) * 100).toFixed(1) : '—';
    const el   = document.getElementById('stat-comparacion');
    if (el) {
      el.textContent = anterior > 0
        ? `${diff >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs período anterior`
        : '';
      el.style.color = diff >= 0 ? '#00b341' : '#e03131';
    }
  }
}

function _calcularPeriodoAnterior(rango) {
  const ahora  = new Date();
  const hoy    = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  let desde, hasta;

  switch(rango) {
    case 'hoy':
      desde = new Date(hoy); desde.setDate(hoy.getDate() - 1);
      hasta = hoy; break;
    case 'semana':
      desde = new Date(hoy); desde.setDate(hoy.getDate() - 14);
      hasta = new Date(hoy); hasta.setDate(hoy.getDate() - 7); break;
    case 'mes':
      desde = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
      hasta = new Date(ahora.getFullYear(), ahora.getMonth(), 1); break;
    default:
      return null;
  }

  const factAnterior = AppState.facturasCache.filter(f => {
    const fecha = f.fecha?.toDate ? f.fecha.toDate() : new Date(f.fecha?.seconds * 1000 || f.fecha);
    return fecha >= desde && fecha < hasta && f.estado === 'pagada';
  });
  return factAnterior.reduce((s, f) => s + (f.total || 0), 0);
}

// ─── GRÁFICO: VENTAS POR DÍA ─────────────────────────────────────────────────

function _renderGraficoVentasPorDia(stats) {
  const canvas = document.getElementById('grafico-ventas-dia');
  if (!canvas || !window.Chart) return;

  const diasOrdenados = Object.entries(stats.porDia)
    .sort((a, b) => {
      const [da, ma] = a[0].split('/').map(Number);
      const [db, mb] = b[0].split('/').map(Number);
      return ma !== mb ? ma - mb : da - db;
    });

  const labels = diasOrdenados.map(([k]) => k);
  const data   = diasOrdenados.map(([, v]) => v);

  if (_charts.ventasDia) { _charts.ventasDia.destroy(); }

  _charts.ventasDia = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Ventas (RD$)',
        data,
        backgroundColor: 'rgba(25, 113, 194, 0.75)',
        borderColor:     '#1971c2',
        borderWidth:     2,
        borderRadius:    6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: ctx => fmt(ctx.raw) }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => 'RD$ ' + v.toLocaleString('es-DO') },
          grid:  { color: 'rgba(0,0,0,0.04)' }
        },
        x: { grid: { display: false } }
      }
    }
  });
}

// ─── GRÁFICO: MÉTODOS DE PAGO ─────────────────────────────────────────────────

function _renderGraficoMetodosPago(stats) {
  const canvas = document.getElementById('grafico-metodos-pago');
  if (!canvas || !window.Chart) return;

  const etiquetas = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', mixto: 'Mixto' };
  const labels    = Object.keys(stats.porMetodo).map(k => etiquetas[k] || k);
  const data      = Object.values(stats.porMetodo);
  const colors    = ['#00b341', '#1971c2', '#7950f2', '#f59f00'];

  if (_charts.metodos) { _charts.metodos.destroy(); }

  _charts.metodos = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, data.length),
        borderWidth:     3,
        borderColor:     '#fff',
        hoverOffset:     6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmt(ctx.raw)}` } }
      }
    }
  });

  // Total en el centro del doughnut
  const centroEl = document.getElementById('grafico-metodos-centro');
  if (centroEl) centroEl.textContent = fmt(data.reduce((s, v) => s + v, 0));
}

// ─── GRÁFICO: DISTRIBUCIÓN POR HORA ──────────────────────────────────────────

function _renderGraficoHoras(stats) {
  const canvas = document.getElementById('grafico-horas');
  if (!canvas || !window.Chart) return;

  const horas  = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
  const counts = Array.from({ length: 24 }, (_, i) => stats.porHora[i] || 0);

  if (_charts.horas) { _charts.horas.destroy(); }

  _charts.horas = new Chart(canvas, {
    type: 'line',
    data: {
      labels: horas,
      datasets: [{
        label: 'Ventas',
        data:  counts,
        borderColor:     '#fc4f62',
        backgroundColor: 'rgba(252, 79, 98, 0.08)',
        fill:            true,
        tension:         0.4,
        pointRadius:     3,
        pointBackgroundColor: '#fc4f62',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.raw} ventas` } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.04)' } },
        x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } }
      }
    }
  });
}

// ─── MÁS VENDIDOS ────────────────────────────────────────────────────────────

function _renderMasVendidos(stats) {
  const lista = document.getElementById('lista-mas-vendidos');
  if (!lista) return;

  const max = stats.masVendidos[0]?.[1] || 1;
  lista.innerHTML = stats.masVendidos.map(([nombre, qty], i) => `
    <div class="mas-vendido-item">
      <span class="mv-rank">${i + 1}</span>
      <div class="mv-info">
        <div class="mv-nombre">${nombre}</div>
        <div class="mv-bar-wrap">
          <div class="mv-bar" style="width:${(qty / max) * 100}%"></div>
        </div>
      </div>
      <span class="mv-qty">${qty} uds</span>
    </div>`).join('') || `<div style="text-align:center;padding:20px;color:#aab4c8;">Sin datos de ventas</div>`;
}

// ─── HISTORIAL RECIENTE ───────────────────────────────────────────────────────

function _renderHistorialReciente(facturas) {
  const lista = document.getElementById('historial-facturas-lista');
  if (!lista) return;

  if (!facturas.length) {
    lista.innerHTML = `<div style="text-align:center;padding:20px;color:#aab4c8;">Sin ventas en este período</div>`;
    return;
  }

  lista.innerHTML = facturas.map(f => {
    const fecha    = f.fecha?.toDate ? f.fecha.toDate() : new Date(f.fecha?.seconds * 1000 || f.fecha);
    const hora     = fecha.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
    const metodos  = { efectivo: '💵', transferencia: '📲', tarjeta: '💳', mixto: '🔀' };
    const estadoColor = { pagada: '#00b341', pendiente: '#e67700', anulada: '#e03131' };

    return `<div class="factura-hist-row" onclick="verDetalleFactura('${f.id}')">
      <div class="fh-numero">#${f.numero || '—'}</div>
      <div class="fh-hora">${hora}</div>
      <div class="fh-metodo" title="${f.metodoPago || '—'}">${metodos[f.metodoPago] || '💰'}</div>
      <div class="fh-total">${fmt(f.total || 0)}</div>
      <div class="fh-estado" style="color:${estadoColor[f.estado] || '#718096'};">
        ${f.estado === 'pagada' ? '✅' : f.estado === 'pendiente' ? '⏳' : '❌'}
      </div>
    </div>`;
  }).join('');
}

// ─── FACTURAS PENDIENTES ──────────────────────────────────────────────────────

function _renderFacturasPendientes(pendientes) {
  const container = document.getElementById('facturas-pendientes-container');
  if (!container) return;

  if (!pendientes.length) {
    container.innerHTML = `<div style="text-align:center;padding:16px;color:#aab4c8;">Sin facturas pendientes 🎉</div>`;
    return;
  }

  container.innerHTML = pendientes.map(f => {
    const fecha = f.fecha?.toDate ? f.fecha.toDate() : new Date(f.fecha?.seconds * 1000 || f.fecha);
    return `<div class="factura-pend-row" onclick="verDetalleFactura('${f.id}')">
      <div>
        <div style="font-weight:700;">#${f.numero || '—'} — ${fmt(f.total || 0)}</div>
        <div style="font-size:12px;color:#718096;">${fecha.toLocaleString('es-DO')}</div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn-sm verde" onclick="event.stopPropagation();marcarFacturaPagada('${f.id}')">
          <i class="fas fa-check"></i> Cobrar
        </button>
        <button class="btn-sm rojo" onclick="event.stopPropagation();anularFactura('${f.id}')">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>`;
  }).join('');
}

// ─── VER DETALLE DE FACTURA ───────────────────────────────────────────────────

export async function verDetalleFactura(factId) {
  let factura = AppState.facturasCache.find(f => f.id === factId);
  if (!factura) {
    try {
      const snap = await getDoc(doc(getDb(), 'negocios', AppState.negocioId, 'facturas', factId));
      if (snap.exists()) factura = { id: snap.id, ...snap.data() };
    } catch(e) { toast('Error al cargar la factura', 'error'); return; }
  }
  if (!factura) { toast('Factura no encontrada', 'error'); return; }

  const body = document.getElementById('modal-detalle-factura-body');
  if (!body) return;

  const fecha    = factura.fecha?.toDate ? factura.fecha.toDate() : new Date();
  const metodos  = { efectivo: 'Efectivo 💵', transferencia: 'Transferencia 📲', tarjeta: 'Tarjeta 💳', mixto: 'Mixto 🔀' };
  const estadoEmoji = { pagada: '✅', pendiente: '⏳', anulada: '❌' };

  body.innerHTML = `
    <div class="detalle-factura-header">
      <div><strong>Factura #${factura.numero || '—'}</strong> &nbsp; ${estadoEmoji[factura.estado] || ''} ${factura.estado}</div>
      <div style="font-size:13px;color:#718096;">${fecha.toLocaleString('es-DO')}</div>
      <div style="font-size:13px;">NCF: <strong>${factura.ncf || '—'}</strong></div>
      <div style="font-size:13px;">Empleado: ${factura.empleadoNombre || '—'}</div>
    </div>
    <table class="detalle-fact-tabla">
      <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
      <tbody>
        ${(factura.items || []).map(item => `
          <tr>
            <td>${item.nombre}</td>
            <td>${item.qty}</td>
            <td>${fmt(item._precioBase || item.precio)}</td>
            <td>${fmt(item.subtotal || (item.qty * (item._precioBase || item.precio)))}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div class="detalle-fact-totales">
      <div class="df-row"><span>Subtotal</span><span>${fmt(factura.subtotal || 0)}</span></div>
      ${factura.itbis > 0 ? `<div class="df-row"><span>ITBIS (${factura.itbisPct}%)</span><span>${fmt(factura.itbis)}</span></div>` : ''}
      <div class="df-row total"><span>TOTAL</span><span>${fmt(factura.total || 0)}</span></div>
      <div class="df-row"><span>Método de pago</span><span>${metodos[factura.metodoPago] || factura.metodoPago}</span></div>
    </div>
    ${factura.estado === 'pendiente' ? `
    <div style="display:flex;gap:10px;margin-top:16px;">
      <button class="btn-sm verde" onclick="marcarFacturaPagada('${factura.id}')"><i class="fas fa-check"></i> Marcar como pagada</button>
      <button class="btn-sm rojo"  onclick="anularFactura('${factura.id}')"><i class="fas fa-times"></i> Anular</button>
    </div>` : ''}
    ${factura.dibujoNota ? `<div style="margin-top:12px;"><strong>Nota:</strong><br><img src="${factura.dibujoNota}" style="max-width:100%;border-radius:8px;border:1px solid #e2e8f0;margin-top:6px;"></div>` : ''}
  `;

  abrirModal('modal-detalle-factura');
}
window.verDetalleFactura = verDetalleFactura;

// ─── ACCIONES SOBRE FACTURAS ──────────────────────────────────────────────────

import { updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { _fsOp } from './offline.js';

window.marcarFacturaPagada = async (factId) => {
  const db = getDb();
  try {
    await _fsOp(() => updateDoc(doc(db, 'negocios', AppState.negocioId, 'facturas', factId), { estado: 'pagada' }));
    const idx = AppState.facturasCache.findIndex(f => f.id === factId);
    if (idx >= 0) AppState.facturasCache[idx].estado = 'pagada';
    cerrarModal('modal-detalle-factura');
    renderEstadisticas();
    toast('✅ Factura marcada como pagada', 'success');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
};

window.anularFactura = async (factId) => {
  if (!confirm('¿Anular esta factura? Esta acción no se puede deshacer.')) return;
  const db = getDb();
  try {
    await _fsOp(() => updateDoc(doc(db, 'negocios', AppState.negocioId, 'facturas', factId), { estado: 'anulada' }));
    const idx = AppState.facturasCache.findIndex(f => f.id === factId);
    if (idx >= 0) AppState.facturasCache[idx].estado = 'anulada';
    cerrarModal('modal-detalle-factura');
    renderEstadisticas();
    toast('Factura anulada', 'info');
  } catch(e) { toast('Error: ' + e.message, 'error'); }
};

// ─── BOTONES DE RANGO ────────────────────────────────────────────────────────

window.setRangoEstadisticas = (rango) => {
  _rangoActual = rango;
  document.querySelectorAll('.stat-rango-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.rango === rango);
  });
  const personalizadoEl = document.getElementById('stat-rango-personalizado');
  if (personalizadoEl) personalizadoEl.style.display = rango === 'personalizado' ? 'flex' : 'none';
  renderEstadisticas();
};

// ─── HISTORIAL COMPLETO PAGINADO ──────────────────────────────────────────────

export async function verHistorialFacturas() {
  abrirModal('modal-historial-facturas');
  _renderHistorialModal(AppState.facturasCache.slice(0, FACTURAS_POR_PG));
}
window.verHistorialFacturas = verHistorialFacturas;

function _renderHistorialModal(facturas) {
  const lista = document.getElementById('historial-modal-lista');
  if (!lista) return;

  lista.innerHTML = facturas.map(f => {
    const fecha = f.fecha?.toDate ? f.fecha.toDate() : new Date(f.fecha?.seconds * 1000 || f.fecha);
    const estadoColor = { pagada: '#00b341', pendiente: '#e67700', anulada: '#e03131' };
    return `<div class="factura-hist-row" onclick="verDetalleFactura('${f.id}')">
      <div class="fh-numero">#${f.numero || '—'}</div>
      <div class="fh-hora">${fecha.toLocaleDateString('es-DO', { day:'2-digit', month:'short' })} ${fecha.toLocaleTimeString('es-DO', { hour:'2-digit', minute:'2-digit' })}</div>
      <div class="fh-total" style="font-weight:700;">${fmt(f.total || 0)}</div>
      <div style="font-size:12px;color:${estadoColor[f.estado] || '#718096'};font-weight:600;">${f.estado}</div>
    </div>`;
  }).join('') || `<div style="text-align:center;padding:20px;color:#aab4c8;">Sin facturas registradas</div>`;
}

export async function cargarMasFacturas() {
  if (_cargandoMas || !_lastFacturaSnap) return;
  _cargandoMas = true;
  const db = getDb();
  try {
    const q    = query(
      collection(db, 'negocios', AppState.negocioId, 'facturas'),
      orderBy('fecha', 'desc'),
      startAfter(_lastFacturaSnap),
      limit(FACTURAS_POR_PG)
    );
    const snap = await getDocs(q);
    const nuevas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    AppState.facturasCache.push(...nuevas);
    _lastFacturaSnap = snap.docs[snap.docs.length - 1] || null;
    _renderHistorialModal(AppState.facturasCache);
    if (snap.docs.length < FACTURAS_POR_PG) {
      const btnMas = document.getElementById('btn-cargar-mas');
      if (btnMas) { btnMas.disabled = true; btnMas.textContent = 'No hay más facturas'; }
    }
  } catch(e) {
    toast('Error cargando facturas: ' + e.message, 'error');
  } finally {
    _cargandoMas = false;
  }
}
window.cargarMasFacturas = cargarMasFacturas;

// ─── BÚSQUEDA DE FACTURAS ─────────────────────────────────────────────────────

export function buscarFacturasPorTermino(termino) {
  const q = termino.toLowerCase().trim();
  if (!q) { _renderHistorialModal(AppState.facturasCache.slice(0, FACTURAS_POR_PG)); return; }

  const resultados = AppState.facturasCache.filter(f =>
    String(f.numero).includes(q) ||
    f.ncf?.toLowerCase().includes(q) ||
    f.empleadoNombre?.toLowerCase().includes(q) ||
    (f.items || []).some(i => i.nombre?.toLowerCase().includes(q))
  );
  _renderHistorialModal(resultados);
}
window.buscarFacturasPorTermino = buscarFacturasPorTermino;

// ─── EXPORTAR CSV ────────────────────────────────────────────────────────────

export function exportarReporteVentas() {
  const facturas = filtrarFacturasPorRango(_rangoActual);
  if (!facturas.length) { toast('Sin ventas para exportar en este período', 'error'); return; }

  const metodos = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', mixto: 'Mixto' };
  let csv = 'Número,NCF,Fecha,Hora,Empleado,Subtotal,ITBIS,Total,Método,Estado\n';
  facturas.forEach(f => {
    const fecha = f.fecha?.toDate ? f.fecha.toDate() : new Date();
    csv += `"${f.numero}","${f.ncf || '-'}","${fecha.toLocaleDateString('es-DO')}","${fecha.toLocaleTimeString('es-DO')}","${f.empleadoNombre || '-'}","${(f.subtotal || 0).toFixed(2)}","${(f.itbis || 0).toFixed(2)}","${(f.total || 0).toFixed(2)}","${metodos[f.metodoPago] || f.metodoPago}","${f.estado}"\n`;
  });

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `reporte_ventas_${_rangoActual}_${new Date().toLocaleDateString('es-DO').replace(/\//g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('✅ Reporte exportado a CSV', 'success');
}
window.exportarReporteVentas = exportarReporteVentas;

// ─── REFRESCAR ESTADÍSTICAS ───────────────────────────────────────────────────

window.refrescarEstadisticas = async () => {
  toast('Actualizando...', 'info', 1500);
  await _cargarFacturasIniciales();
  renderEstadisticas();
};

console.log('[estadisticas] Módulo de estadísticas cargado ✅');
