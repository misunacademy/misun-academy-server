import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID');

export const submitQuizSchema = z.object({
    body: z.object({
        // Bounded: an unbounded answers array is a CPU-burn vector in scoring.
        answers: z.array(z.object({
            questionId: objectId,
            selectedAnswer: z.string().max(5000).nullable(),
        })).max(200),
        // Accepted but ignored: time is measured server-side from startedAt.
        timeTaken: z.number().int().nonnegative().max(86400).optional(),
    }),
});

export const resetAttemptsSchema = z.object({
    params: z.object({
        quizId: objectId,
        userId: objectId,
    }),
});
