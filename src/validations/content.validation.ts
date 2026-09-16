import { z } from 'zod';

export const updateProgressSchema = z.object({
    body: z.object({
        progress: z.number().min(0).max(100),
        completed: z.boolean().optional(),
    }),
});
