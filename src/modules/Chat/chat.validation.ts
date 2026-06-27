import { z } from 'zod';

export const chatRequestSchema = z.object({
  body: z.object({
    messages: z.array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1, 'Message content is required'),
      })
    ).min(1, 'At least one message is required'),
  }),
});
