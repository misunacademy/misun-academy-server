import { z } from 'zod';

export const createRefundSchema = z.object({
  body: z.object({
    transactionId: z.string().trim().min(3).max(100),
    amount: z.number().positive().optional(),
    reason: z.string().trim().min(3, 'Reason is required').max(500),
  }),
});

export const refundIdParamSchema = z.object({
  params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid refund id') }),
});

export const refundNoteSchema = z.object({
  params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid refund id') }),
  body: z.object({
    note: z.string().trim().max(500).optional(),
  }),
});

export const refundQuerySchema = z.object({
  query: z.object({
    status: z.enum(['pending', 'approved', 'rejected', 'completed']).optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
});