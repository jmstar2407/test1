import { calculateInvoiceTotals } from "../src/core/pricing.js";
import { evaluatePaymentStatus } from "../src/core/payment.js";
import { validatePayment } from "../src/core/validation.js";

function assert(name, condition) {
  if (!condition) throw new Error(`Test failed: ${name}`);
  console.log(`ok: ${name}`);
}

const cart = [
  { nombre: "Arroz", precio: 50, qty: 2 },
  { nombre: "Refresco", precio: 100, qty: 1, comboActivo: true, comboPrecio: 180, comboUnidades: 2 }
];
const totals = calculateInvoiceTotals(cart, { itbisCliente: true, itbisPct: 18 });
assert("subtotal positive", totals.subtotal > 0);
assert("total with tax", totals.total > totals.subtotal);

const cashReady = evaluatePaymentStatus({ total: totals.total, method: "efectivo", received: totals.total });
assert("cash exact is ready", cashReady.ready === true && cashReady.change === 0);

const paymentValidation = validatePayment({ total: totals.total, method: "efectivo", received: totals.total, isPending: false });
assert("payment validation passes", paymentValidation.ok === true);

console.log("core smoke tests passed");
