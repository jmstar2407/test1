export function createInvoiceRepository({ db, collection, addDoc, updateDoc, doc, serverTimestamp, negocioId }) {
  const basePath = ["negocios", negocioId];

  return {
    async savePaidInvoice(invoiceData) {
      const colRef = collection(db, ...basePath, "facturas");
      return addDoc(colRef, { ...invoiceData, fecha: serverTimestamp() });
    },

    async savePendingInvoice(invoiceData) {
      const colRef = collection(db, ...basePath, "facturas-pendientes");
      return addDoc(colRef, { ...invoiceData, fecha: serverTimestamp() });
    },

    async markPendingAsPaid(pendingInvoiceId, paymentData) {
      const ref = doc(db, ...basePath, "facturas-pendientes", pendingInvoiceId);
      return updateDoc(ref, {
        estado: "pagada",
        pagoActualizadoEn: serverTimestamp(),
        ...paymentData
      });
    }
  };
}
