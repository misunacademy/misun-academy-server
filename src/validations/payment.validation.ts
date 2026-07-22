import { z } from 'zod';

export const initiatePaymentSchema = z.object({
    batchId: z.string(),
    amount: z.number().positive(),
});

export const verifyPaymentSchema = z.object({
    body: z.object({
        transactionId: z.string(),
    }),
});

export const updatePaymentStatusSchema = z.object({
    body: z.object({
        status: z.enum(['Pending', 'Completed', 'Failed', 'Refunded']),
        transactionId: z.string().optional(),
    }),
});
