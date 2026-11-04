import { describe, expect, it } from '@jest/globals';
import { updatePaymentStatusSchema } from '../../validations/payment.validation.js';
import { Status } from '../../types/common.js';

describe('updatePaymentStatusSchema contract', () => {
  it('accepts only non-terminal admin status values with a reason', () => {
    for (const value of [Status.Pending, Status.Failed, Status.Review, Status.Risk, Status.Cancel]) {
      const result = updatePaymentStatusSchema.safeParse({
        body: { status: value, reason: 'Reviewed by support' },
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects terminal statuses for generic admin updates', () => {
    for (const value of [Status.Success, Status.Refunded]) {
      const result = updatePaymentStatusSchema.safeParse({
        body: { status: value, reason: 'Reviewed by support' },
      });
      expect(result.success).toBe(false);
    }
  });

  it('requires a non-empty reason', () => {
    const result = updatePaymentStatusSchema.safeParse({ body: { status: Status.Review } });
    expect(result.success).toBe(false);
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