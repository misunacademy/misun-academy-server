import { describe, it, expect } from '@jest/globals';
import { updateEnrollmentStatusSchema } from '../../validations/enrollment.validation.js';

describe('updateEnrollmentStatusSchema', () => {
    it('accepts lowercase EnrollmentStatus values', () => {
        expect(() =>
            updateEnrollmentStatusSchema.parse({ body: { status: 'suspended', reason: 'r' } })
        ).not.toThrow();
        expect(() =>
            updateEnrollmentStatusSchema.parse({ body: { status: 'active' } })
        ).not.toThrow();
    });

    it('rejects capitalized and unknown statuses', () => {
        expect(() => updateEnrollmentStatusSchema.parse({ body: { status: 'Active' } })).toThrow();
        expect(() => updateEnrollmentStatusSchema.parse({ body: { status: 'Expired' } })).toThrow();
        expect(() => updateEnrollmentStatusSchema.parse({ body: { status: 'Cancelled' } })).toThrow();
    });
});
