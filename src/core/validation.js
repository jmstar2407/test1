import { evaluatePaymentStatus, PAYMENT_METHODS } from "./payment.js";

export function validateCart(cart = []) {
  if (!Array.isArray(cart) || cart.length === 0) {
    return { ok: false, reason: "EMPTY_CART", message: "El carrito está vacío" };
  }
  return { ok: true };
}

export function validateCashDrawer(cashDrawer) {
  if (!cashDrawer) {
    return { ok: false, reason: "CASH_DRAWER_CLOSED", message: "La caja no está abierta" };
  }
  return { ok: true };
}

export function validatePayment({ total, method, received, mixed, isPending }) {
  if (isPending) return { ok: true };
  const status = evaluatePaymentStatus({ total, method, received, mixed });
  if (method === PAYMENT_METHODS.CASH && Number(received || 0) <= 0) {
    return { ok: false, reason: "CASH_REQUIRED", message: "Ingresa el monto recibido en efectivo" };
  }
  if (!status.ready) {
    return { ok: false, reason: "PAYMENT_NOT_COVERED", message: "El pago no cubre el total de la factura" };
  }
  return { ok: true };
}
