import { describe, expect, it } from '@jest/globals';
import { updatePaymentStatusSchema } from '../../validations/payment.validation.js';
import { Status } from '../../types/common.js';

describe('updatePaymentStatusSchema contract', () => {
  it('accepts every value of the Payment Status enum (lowercase, model-aligned)', () => {
    for (const value of Object.values(Status)) {
      const result = updatePaymentStatusSchema.safeParse({ body: { status: value } });
      expect(result.success).toBe(true);
    }
  });

  it('rejects legacy Title-case values that the Mongoose enum cannot store', () => {
    for (const value of ['Pending', 'Completed', 'Failed', 'Refunded']) {
      const result = updatePaymentStatusSchema.safeParse({ body: { status: value } });
      expect(result.success).toBe(false);
    }
  });

  it('rejects unknown statuses', () => {
    const result = updatePaymentStatusSchema.safeParse({ body: { status: 'unknown' } });
    expect(result.success).toBe(false);
  });
});