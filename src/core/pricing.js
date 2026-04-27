function hasComboPricing(item) {
  return !!(item?.comboActivo && item?.comboPrecio && item?.comboUnidades >= 2 && item?._precioBase === undefined);
}

export function calculateComboPrice(qty, regularPrice, comboPrice, comboUnits) {
  if (!comboPrice || !comboUnits || comboUnits < 2) return regularPrice * qty;
  const combos = Math.floor(qty / comboUnits);
  const loose = qty % comboUnits;
  return combos * comboPrice + loose * regularPrice;
}

function getLineSubtotal(item) {
  const qty = Number(item?.qty || 0);
  if (qty <= 0) return 0;
  if (hasComboPricing(item)) {
    return calculateComboPrice(qty, Number(item.precio || 0), Number(item.comboPrecio || 0), Number(item.comboUnidades || 0));
  }
  if (item?._precioBase !== undefined) return Number(item._precioBase || 0) * qty;
  return Number(item?.precio || 0) * qty;
}

export function calculateSubtotal(cart = []) {
  return cart.reduce((sum, item) => sum + getLineSubtotal(item), 0);
}

export function calculateTax(subtotal, taxConfig = {}) {
  const pct = Number(taxConfig?.itbisPct ?? 18);
  const enabled = taxConfig?.itbisCliente === true;
  if (!enabled) return 0;
  return subtotal * (pct / 100);
}

export function calculateInvoiceTotals(cart = [], taxConfig = {}) {
  const subtotal = calculateSubtotal(cart);
  const itbis = calculateTax(subtotal, taxConfig);
  const total = subtotal + itbis;
  return { subtotal, itbis, total };
}

export function calculateCashChange(total, received) {
  const totalNum = Number(total || 0);
  const receivedNum = Number(received || 0);
  const change = receivedNum - totalNum;
  return {
    change,
    isCovered: receivedNum >= totalNum,
    shortage: Math.max(0, totalNum - receivedNum)
  };
}
