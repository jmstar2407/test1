/**
 * ════════════════════════════════════════════════════════════════════
 * MÓDULO: whatsapp.js — Envío de Facturas por WhatsApp
 * RESPONSABILIDAD: Generar el mensaje de factura y abrir WhatsApp Web
 *                  o la app nativa con el contenido pre-llenado.
 *
 * FUNCIONES EXPUESTAS EN window:
 *   enviarFacturaWhatsApp(factura)  → Genera link de WA con la factura
 *   compartirFactura(facturaId)     → Busca la factura y llama al anterior
 *   generarMensajeFactura(factura)  → Genera el texto plano de la factura
 * ════════════════════════════════════════════════════════════════════
 */

import { AppState } from './app-state.js';
import { fmt }      from './utils.js';

// ─── GENERAR MENSAJE DE TEXTO PLANO ──────────────────────────────────────────

export function generarMensajeFactura(factura) {
  const neg   = AppState.negocioData || {};
  const fecha = factura.fecha?.toDate ? factura.fecha.toDate() : new Date();

  const lineas = [
    `🏪 *${neg.nombre || 'Colmado'}*`,
    neg.direccion ? `📍 ${neg.direccion}` : '',
    neg.telefono  ? `📞 ${neg.telefono}`  : '',
    neg.rnc       ? `RNC: ${neg.rnc}`     : '',
    '',
    `📄 *Factura #${factura.numero || '—'}*`,
    factura.ncf   ? `NCF: ${factura.ncf}` : '',
    `🕐 ${fecha.toLocaleString('es-DO')}`,
    '',
    '━━━━━━━━━━━━━━━━━',
    '*DETALLE DE COMPRA*',
    '━━━━━━━━━━━━━━━━━',
  ];

  // Ítems
  (factura.items || []).forEach(item => {
    const precio = item._precioBase || item.precio;
    const sub    = item.subtotal ?? (precio * item.qty);
    const unidad = item.unidad ? ` ${item.unidad}` : ' ud';
    lineas.push(`• *${item.nombre}*`);
    lineas.push(`  ${item.qty}${unidad} x ${fmt(precio)} = *${fmt(sub)}*`);
  });

  lineas.push('━━━━━━━━━━━━━━━━━');

  // Totales
  if (factura.subtotal !== undefined) lineas.push(`Subtotal:  ${fmt(factura.subtotal)}`);
  if (factura.itbis > 0)             lineas.push(`ITBIS (${factura.itbisPct}%): ${fmt(factura.itbis)}`);
  lineas.push(`*TOTAL:    ${fmt(factura.total || 0)}*`);

  // Método de pago
  const metodos = { efectivo: 'Efectivo 💵', transferencia: 'Transferencia 📲', tarjeta: 'Tarjeta 💳', mixto: 'Mixto 🔀' };
  lineas.push(`Método: ${metodos[factura.metodoPago] || factura.metodoPago || '—'}`);

  if (factura.direccionCliente) {
    lineas.push('');
    lineas.push(`📦 *Dirección de entrega:*`);
    lineas.push(factura.direccionCliente);
  }

  lineas.push('');
  lineas.push('_¡Gracias por su compra! 🙏_');
  lineas.push(`_Powered by miColmApp_`);

  return lineas.filter(l => l !== null && l !== undefined).join('\n');
}
window.generarMensajeFactura = generarMensajeFactura;

// ─── ENVIAR POR WHATSAPP ─────────────────────────────────────────────────────

/**
 * Abre WhatsApp Web o la app nativa con el mensaje de factura pre-llenado.
 * Si hay número configurado en la config del negocio, lo usa como destino.
 * De lo contrario, abre WhatsApp sin número (wa.me sin destinatario).
 *
 * @param {Object} factura   Objeto de factura completo
 * @param {string} [numero]  Número destino (con código de país, sin +)
 */
export function enviarFacturaWhatsApp(factura, numero = '') {
  const mensaje = generarMensajeFactura(factura);
  const encoded = encodeURIComponent(mensaje);

  // Usar el número guardado en config si no se provee uno
  const numDestino = numero || '';
  const url = numDestino
    ? `https://wa.me/${numDestino.replace(/\D/g, '')}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;

  window.open(url, '_blank');
}
window.enviarFacturaWhatsApp = enviarFacturaWhatsApp;

/**
 * Busca una factura en caché y la envía por WhatsApp.
 * @param {string} facturaId
 */
export function compartirFactura(facturaId) {
  const factura = AppState.facturasCache.find(f => f.id === facturaId);
  if (!factura) {
    // Importar toast dinámicamente para evitar circular
    if (window.toast) window.toast('Factura no encontrada en caché', 'error');
    return;
  }
  enviarFacturaWhatsApp(factura);
}
window.compartirFactura = compartirFactura;

/**
 * Compartir la factura más reciente del carrito actual (desde el modal de ticket).
 * Se llama desde el botón "Enviar por WhatsApp" del modal-ticket.
 */
window.compartirTicketActual = () => {
  // El módulo POS expone facturaActualParaImprimir a través de window
  const factura = window._facturaActualParaImprimir;
  if (!factura) {
    if (window.toast) window.toast('No hay factura activa para compartir', 'error');
    return;
  }
  enviarFacturaWhatsApp(factura);
};

console.log('[whatsapp] Módulo WhatsApp cargado ✅');
