import { calculateInvoiceTotals } from "./pricing.js";
import { normalizePaymentPayload } from "./payment.js";

export function buildInvoiceDocument({
  cart = [],
  taxConfig = {},
  paymentMethod,
  paymentReceived = 0,
  mixedPayment = {},
  isPending = false,
  customerName = "Cliente General",
  customerPhone = "",
  employeeId = "",
  employeeName = "",
  notes = "",
  now = new Date(),
  moduleId = "colmado"
}) {
  const totals = calculateInvoiceTotals(cart, taxConfig);
  const payment = normalizePaymentPayload({
    method: paymentMethod,
    received: paymentReceived,
    mixed: mixedPayment,
    customerPaid: !isPending
  });

  return {
    meta: {
      moduleId,
      createdAt: now.toISOString(),
      version: "1.0.0"
    },
    customer: {
      name: customerName,
      phone: customerPhone
    },
    employee: {
      id: employeeId,
      name: employeeName
    },
    lines: cart.map((item) => ({
      id: item.id || "",
      name: item.nombre || "",
      qty: Number(item.qty || 0),
      price: Number(item._precioBase !== undefined ? item._precioBase : item.precio || 0),
      comboActive: !!item.comboActivo
    })),
    totals,
    payment,
    status: payment.status,
    notes
  };
}
