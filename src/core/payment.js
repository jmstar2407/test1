import { calculateCashChange } from "./pricing.js";

export const PAYMENT_METHODS = {
  CASH: "efectivo",
  TRANSFER: "transferencia",
  CARD: "tarjeta",
  MIXED: "mixto"
};

export function evaluatePaymentStatus({ total = 0, method = PAYMENT_METHODS.CASH, received = 0, mixed = {} }) {
  if (method === PAYMENT_METHODS.CASH) {
    const result = calculateCashChange(total, received);
    return {
      ready: result.isCovered,
      change: Math.max(0, result.change),
      shortage: result.shortage
    };
  }

  if (method === PAYMENT_METHODS.MIXED) {
    const cash = Number(mixed?.cash || 0);
    const digital = Number(mixed?.digital || 0);
    const paid = cash + digital;
    const change = paid - Number(total || 0);
    return {
      ready: paid >= total && (cash > 0 || digital > 0),
      paid,
      change: Math.max(0, change),
      shortage: Math.max(0, -change)
    };
  }

  return {
    ready: method === PAYMENT_METHODS.TRANSFER || method === PAYMENT_METHODS.CARD,
    change: 0,
    shortage: 0
  };
}

export function normalizePaymentPayload({ method, received = 0, mixed = {}, customerPaid = true }) {
  if (!customerPaid) return { method, status: "pendiente", received: 0, mixed: null };
  if (method === PAYMENT_METHODS.MIXED) {
    return {
      method,
      status: "pagada",
      received: Number(mixed.cash || 0) + Number(mixed.digital || 0),
      mixed: { cash: Number(mixed.cash || 0), digital: Number(mixed.digital || 0) }
    };
  }
  return {
    method,
    status: "pagada",
    received: Number(received || 0),
    mixed: null
  };
}
