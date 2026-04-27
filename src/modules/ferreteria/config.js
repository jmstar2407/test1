export const ferreteriaModuleConfig = {
  id: "ferreteria",
  labels: {
    invoice: "Factura ferretera",
    table: "Mostrador",
    quickInvoice: "Cotización rápida"
  },
  features: {
    editableTables: false,
    quickInvoice: true
  },
  fiscal: {
    currency: "DOP",
    locale: "es-DO",
    taxName: "ITBIS",
    enableDgiiFlow: true
  },
  domain: {
    requiresBrandOnLine: true,
    allowsBulkUnitSales: true
  }
};
