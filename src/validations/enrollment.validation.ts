import { z } from 'zod';

export const initiateEnrollmentSchema = z.object({
    body: z.object({
        batchId: z.string(),
    }),
});

export const manualEnrollmentSchema = z.object({
    body: z.object({
        batchId: z.string().trim().min(1),
        // Required: the controller rejects requests without these, so the
        // schema enforces them up front for uniform Zod 400s.
        paymentData: z.object({
            senderNumber: z.string().trim().min(1, 'senderNumber is required'),
            transactionId: z.string().trim().min(1, 'transactionId is required'),
        }),
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
