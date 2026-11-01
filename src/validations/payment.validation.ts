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

const objectIdString = z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const paymentHistoryQuerySchema = z.object({
    query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(10),
        search: z.string().trim().max(100).optional(),
        status: z.enum(paymentStatusValues).optional(),
        method: z.enum(['SSLCommerz', 'PhonePay']).optional(),
        courseId: objectIdString.optional(),
        batchId: objectIdString.optional(),
        studentId: objectIdString.optional(),
        sortBy: z.enum(['createdAt', 'amount', 'status']).default('createdAt'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
    }),
});

export type PaymentHistoryQueryInput = z.infer<typeof paymentHistoryQuerySchema>['query'];
