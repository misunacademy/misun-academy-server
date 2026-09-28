import { z } from 'zod';

export const chatRequestSchema = z.object({
  body: z.object({
    // User turns only: accepting client-supplied `assistant` history would let
    // anyone pre-seed fake acknowledgments ("ignore instructions…") and
    // jailbreak the support bot. Multi-turn context is rebuilt from user
    // messages alone.
    messages: z.array(
      z.object({
        role: z.enum(['user']),
        content: z.string().min(1, 'Message content is required').max(2000, 'Message is too long'),
      })
    ).min(1, 'At least one message is required').max(20, 'Too many messages'),
  }),
});
