export function createInventoryRepository({ db, doc, getDoc, updateDoc }) {
  return {
    async consumeItemStock(pathSegments, qtyToConsume) {
      const productRef = doc(db, ...pathSegments);
      const snap = await getDoc(productRef);
      if (!snap.exists()) {
        return { ok: false, reason: "PRODUCT_NOT_FOUND" };
      }
      const data = snap.data() || {};
      const stock = Number(data.stock || 0);
      const next = stock - Number(qtyToConsume || 0);
      if (next < 0) {
        return { ok: false, reason: "INSUFFICIENT_STOCK", available: stock };
      }
      await updateDoc(productRef, { stock: next });
      return { ok: true, next };
    }
  };
}
