import { z } from 'zod';
import { Status } from '../types/common.js';

export const initiatePaymentSchema = z.object({
    batchId: z.string(),
    amount: z.number().positive(),
});

export const verifyPaymentSchema = z.object({
    body: z.object({
        approved: z.boolean(),
    }),
});

const paymentStatusValues = Object.values(Status) as [Status, ...Status[]];

export const updatePaymentStatusSchema = z.object({
    body: z.object({
        status: z.enum(paymentStatusValues),
        transactionId: z.string().optional(),
    }),
});
