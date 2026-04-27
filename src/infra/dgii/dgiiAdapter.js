export function createDgiiAdapter({ transport }) {
  const events = [];

  function logEvent(type, payload = {}) {
    const event = {
      type,
      payload,
      at: new Date().toISOString()
    };
    events.push(event);
    return event;
  }

  return {
    getEvents() {
      return [...events];
    },

    validateForSubmission(invoiceDocument) {
      const errors = [];
      if (!invoiceDocument?.customer?.name) errors.push("CUSTOMER_NAME_REQUIRED");
      if (!invoiceDocument?.totals || Number(invoiceDocument.totals.total || 0) <= 0) errors.push("TOTAL_REQUIRED");
      if (!invoiceDocument?.meta?.moduleId) errors.push("MODULE_ID_REQUIRED");
      return { ok: errors.length === 0, errors };
    },

    async submitInvoice(invoiceDocument) {
      const validation = this.validateForSubmission(invoiceDocument);
      if (!validation.ok) {
        logEvent("submission_rejected_local_validation", { errors: validation.errors });
        return { ok: false, errors: validation.errors };
      }

      logEvent("submission_started", { invoiceVersion: invoiceDocument.meta?.version });
      try {
        const response = await transport(invoiceDocument);
        logEvent("submission_accepted", { response });
        return { ok: true, response };
      } catch (error) {
        logEvent("submission_failed", { message: error?.message || "UNKNOWN" });
        return { ok: false, errors: [error?.message || "DGII_SUBMIT_FAILED"] };
      }
    }
  };
}
