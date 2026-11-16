/**
 * A stand-in for a third-party income verification vendor.
 *
 * It records every successful verification by idempotency key. Real vendors behave
 * worse than this: they time out after doing the work, return partial payloads, and
 * change schemas without notice.
 */
export class VendorSimulator {
  constructor() {
    this.reset();
  }

  reset() {
    this.verifications = new Map();
    this.attempts = 0;
    this.failuresRemaining = 0;
    this.failAfterRecordRemaining = 0;
    this.alwaysFail = false;
    this.sequence = 0;
  }

  configure({ failures = 0, failAfterRecord = 0, alwaysFail = false } = {}) {
    this.failuresRemaining = Number(failures) || 0;
    this.failAfterRecordRemaining = Number(failAfterRecord) || 0;
    this.alwaysFail = Boolean(alwaysFail);
  }

  record({ applicationId, householdHash, idempotencyKey }) {
    this.sequence += 1;
    const record = {
      verificationId: `vrf_${String(this.sequence).padStart(5, '0')}`,
      applicationId,
      householdHash,
      idempotencyKey,
      createdAt: new Date().toISOString(),
    };
    this.verifications.set(idempotencyKey, record);
    return record;
  }

  async verify({ applicationId, householdHash, idempotencyKey }) {
    this.attempts += 1;
    await new Promise((resolve) => setTimeout(resolve, 3));

    if (this.alwaysFail) {
      const error = new Error('vendor_unavailable');
      error.status = 503;
      throw error;
    }

    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      const error = new Error('vendor_unavailable');
      error.status = 503;
      throw error;
    }

    const existing = this.verifications.get(idempotencyKey);
    if (existing) return { ...existing, duplicate: true };

    const record = this.record({ applicationId, householdHash, idempotencyKey });

    if (this.failAfterRecordRemaining > 0) {
      this.failAfterRecordRemaining -= 1;
      const error = new Error('vendor_timeout_after_processing');
      error.status = 504;
      throw error;
    }

    return record;
  }

  list() {
    return [...this.verifications.values()];
  }

  listForApplication(applicationId) {
    return this.list().filter((record) => record.applicationId === applicationId);
  }
}
