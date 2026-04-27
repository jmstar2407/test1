export const restauranteModuleConfig = {
  id: "restaurante",
  labels: {
    invoice: "Comanda/Factura",
    table: "Mesa",
    quickInvoice: "Factura rápida"
  },
  features: {
    editableTables: true,
    quickInvoice: true
  },
  fiscal: {
    currency: "DOP",
    locale: "es-DO",
    taxName: "ITBIS",
    enableDgiiFlow: true
  }
};

export function normalizeRestaurantTable(tableName, fallbackIndex = 1) {
  const trimmed = String(tableName || "").trim();
  return trimmed || `Mesa ${fallbackIndex}`;
}
