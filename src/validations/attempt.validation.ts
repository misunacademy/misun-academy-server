import { z } from 'zod';

export const submitQuizSchema = z.object({
    body: z.object({
        answers: z.array(z.object({
            questionId: z.string(),
            selectedAnswer: z.string().nullable(),
        })),
        timeTaken: z.number().int().positive().optional(),
    }),
});
