import { buildInvoiceDocument } from "../core/invoice.js";
import { calculateInvoiceTotals } from "../core/pricing.js";
import { validateCart, validateCashDrawer, validatePayment } from "../core/validation.js";

export function createInvoiceOrchestrator({ invoiceRepo, cashRepo, dgiiAdapter, moduleConfig }) {
  return {
    async processInvoice({
      cart,
      taxConfig,
      paymentMethod,
      paymentReceived,
      mixedPayment,
      isPending,
      cashDrawer,
      customer,
      employee,
      notes
    }) {
      const cartValidation = validateCart(cart);
      if (!cartValidation.ok) return cartValidation;

      const cashValidation = validateCashDrawer(cashDrawer);
      if (!cashValidation.ok) return cashValidation;

      const totals = calculateInvoiceTotals(cart, taxConfig);
      const paymentValidation = validatePayment({
        total: totals.total,
        method: paymentMethod,
        received: paymentReceived,
        mixed: mixedPayment,
        isPending
      });
      if (!paymentValidation.ok) return paymentValidation;

      const invoiceDocument = buildInvoiceDocument({
        cart,
        taxConfig,
        paymentMethod,
        paymentReceived,
        mixedPayment,
        isPending,
        customerName: customer?.name,
        customerPhone: customer?.phone,
        employeeId: employee?.id,
        employeeName: employee?.name,
        notes,
        moduleId: moduleConfig?.id || "general"
      });

      const persisted = isPending
        ? await invoiceRepo.savePendingInvoice(invoiceDocument)
        : await invoiceRepo.savePaidInvoice(invoiceDocument);

      if (!isPending && cashRepo) {
        await cashRepo.registerIncome({
          amount: totals.total,
          description: `${moduleConfig?.labels?.invoice || "Factura"} cobrada`,
          employeeName: employee?.name,
          facturaId: persisted?.id
        });
      }

      if (!isPending && dgiiAdapter && moduleConfig?.fiscal?.enableDgiiFlow === true) {
        await dgiiAdapter.submitInvoice(invoiceDocument);
      }

      return { ok: true, invoiceId: persisted?.id || null, invoiceDocument };
    }
  };
}
