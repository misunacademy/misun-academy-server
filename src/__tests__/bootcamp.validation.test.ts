import { describe, expect, it } from '@jest/globals';
import { registerBootcampValidationSchema } from '../modules/Bootcamp/bootcamp.validation.js';

const basePayload = {
  name: 'Test User',
  address: 'Dhaka, Bangladesh',
  email: 'user@example.com',
  paymentLast4: '1234',
};

describe('bootcamp registration validation', () => {
  it.each<[string, string]>([
    ['Bangladesh', '01712345678'],
    ['India', '9876543210'],
    ['India with country code', '+919876543210'],
    ['United States', '+12125550123'],
    ['United Kingdom', '+442079460958'],
    ['Germany', '+4915123456789'],
    ['Egypt', '+201001234567'],
  ])('accepts a WhatsApp number from %s', (_country, whatsapp) => {
    const result = registerBootcampValidationSchema.safeParse({
      body: { ...basePayload, whatsapp },
    });

    expect(result.success).toBe(true);
  });

  it('accepts an empty whatsapp field', () => {
    const result = registerBootcampValidationSchema.safeParse({
      body: { ...basePayload, whatsapp: '' },
    });

    expect(result.success).toBe(true);
  });

  it('strips undeclared fields like status and adminNote from the body', () => {
    const result = registerBootcampValidationSchema.safeParse({
      body: {
        ...basePayload,
        status: 'verified',
        adminNote: 'self-verified',
        reviewedBy: '507f1f77bcf86cd799439011',
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data.body)).not.toContain('status');
    expect(Object.keys(result.data.body)).not.toContain('adminNote');
    expect(Object.keys(result.data.body)).not.toContain('reviewedBy');
  });
});
