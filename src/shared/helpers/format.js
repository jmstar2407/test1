/** Formato moneda RD (UI). */
export function fmt(val) {
  return `RD$ ${(val || 0).toLocaleString('es-DO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Número legible para cantidades / entradas numéricas. */
export function fmtNum(val) {
  const n = parseFloat(val) || 0;
  if (Number.isInteger(n)) return n;
  const r = parseFloat(n.toFixed(2));
  return Number.isInteger(r) ? r : r.toFixed(2);
}
