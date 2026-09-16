import { z } from 'zod';

export const initiateEnrollmentSchema = z.object({
    body: z.object({
        batchId: z.string(),
    }),
});

export const manualEnrollmentSchema = z.object({
    body: z.object({
        batchId: z.string(),
        transactionId: z.string().optional(),
        amount: z.number().positive().optional(),
    }),
});

export const grantAccessSchema = z.object({
    body: z.object({
        email: z.string().email(),
        batchId: z.string(),
    }),
});

export const updateEnrollmentStatusSchema = z.object({
    body: z.object({
        status: z.enum(['Pending', 'Active', 'Completed', 'Expired', 'Cancelled', 'PaymentFailed']),
        reason: z.string().optional(),
    }),
});
