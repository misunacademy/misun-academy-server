import { z } from 'zod';

export const initiateEnrollmentSchema = z.object({
    body: z.object({
        batchId: z.string(),
    }),
});

export const manualEnrollmentSchema = z.object({
    body: z.object({
        batchId: z.string(),
        paymentData: z.object({
            senderNumber: z.string(),
            transactionId: z.string(),
        }).optional(),
        transactionId: z.string().optional(),
        amount: z.number().positive().optional(),
    }),
});

export const grantAccessSchema = z.object({
    body: z.object({
        email: z.string().email(),
        courseId: z.string(),
        batchId: z.string(),
    }),
});

export const updateEnrollmentStatusSchema = z.object({
    body: z.object({
        // Must match EnrollmentStatus (lowercase) in src/types/common.ts
        status: z.enum([
            'pending',
            'payment-pending',
            'active',
            'completed',
            'suspended',
            'refunded',
            'payment-failed',
        ]),
        reason: z.string().optional(),
    }),
});
