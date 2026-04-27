export const colmadoModuleConfig = {
  id: "colmado",
  labels: {
    invoice: "Factura",
    table: "Turno",
    quickInvoice: "Factura rápida"
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
  }
};
