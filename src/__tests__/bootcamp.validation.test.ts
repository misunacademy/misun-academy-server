import { describe, expect, it } from '@jest/globals';
import { registerBootcampValidationSchema } from '../modules/Bootcamp/bootcamp.validation.js';

describe('bootcamp registration validation', () => {
  it('accepts valid Indian mobile numbers', () => {
    const result = registerBootcampValidationSchema.safeParse({
      body: {
        name: 'Test User',
        whatsapp: '9876543210',
        address: 'Dhaka, Bangladesh',
        email: 'user@example.com',
        paymentLast4: '1234',
      },
    });

    expect(result.success).toBe(true);
  });
});
