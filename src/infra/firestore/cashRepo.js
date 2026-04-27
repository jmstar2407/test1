export function createCashRepository({ db, collection, addDoc, serverTimestamp, negocioId }) {
  const basePath = ["negocios", negocioId];

  return {
    async registerIncome({ amount, description, employeeName, facturaId }) {
      const colRef = collection(db, ...basePath, "movimientos");
      return addDoc(colRef, {
        tipo: "ingreso",
        monto: Number(amount || 0),
        descripcion: description || "Factura cobrada",
        empleadoNombre: employeeName || "-",
        facturaId: facturaId || null,
        fecha: serverTimestamp()
      });
    }
  };
}
