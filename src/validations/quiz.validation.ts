import { z } from 'zod';

const contentBlockSchema = z.object({
    type: z.enum(['text', 'image', 'text_image', 'audio', 'video']),
    text: z.string().optional(),
    imageUrl: z.string().optional(),
    audioUrl: z.string().optional(),
    videoUrl: z.string().optional(),
    altText: z.string().optional(),
});

export const createQuizSchema = z.object({
    body: z.object({
        title: z.string().min(1).max(200),
        description: z.string().optional(),
        instructions: z.string().optional(),
        passingPercentage: z.number().min(0).max(100).default(50),
        timeLimit: z.number().positive().optional(),
        shuffleQuestions: z.boolean().default(false),
        shuffleOptions: z.boolean().default(false),
        maxAttempts: z.number().int().min(0).default(1),
        showCorrectAnswers: z.boolean().default(false),
        allowReview: z.boolean().default(true),
        status: z.enum(['draft', 'published']).default('draft'),
        orderIndex: z.number().int().min(0).optional(),
    }),
});

export const updateQuizSchema = z.object({
    body: z.object({
        title: z.string().min(1).max(200).optional(),
        description: z.string().optional(),
        instructions: z.string().optional(),
        passingPercentage: z.number().min(0).max(100).optional(),
        timeLimit: z.number().positive().optional().nullable(),
        shuffleQuestions: z.boolean().optional(),
        shuffleOptions: z.boolean().optional(),
        maxAttempts: z.number().int().min(0).optional(),
        showCorrectAnswers: z.boolean().optional(),
        allowReview: z.boolean().optional(),
        status: z.enum(['draft', 'published']).optional(),
        orderIndex: z.number().int().min(0).optional(),
    }),
});

export const reorderQuizzesSchema = z.object({
    body: z.object({
        quizOrders: z.array(z.object({
            quizId: z.string(),
            orderIndex: z.number().int().min(0),
        })),
    }),
});

export const createQuestionSchema = z.object({
    body: z.object({
        questionType: z.enum(['mcq', 'true_false']),
        content: contentBlockSchema,
        options: z.array(contentBlockSchema).min(2).max(6),
        correctAnswer: z.string().min(1),
        explanation: contentBlockSchema.optional(),
        marks: z.number().min(0).default(1),
        zamesPoints: z.number().min(0).default(1),
        orderIndex: z.number().int().min(0).optional(),
    }),
});

export const updateQuestionSchema = z.object({
    body: z.object({
        questionType: z.enum(['mcq', 'true_false']).optional(),
        content: contentBlockSchema.optional(),
        options: z.array(contentBlockSchema).min(2).max(6).optional(),
        correctAnswer: z.string().optional(),
        explanation: contentBlockSchema.optional().nullable(),
        marks: z.number().min(0).optional(),
        zamesPoints: z.number().min(0).optional(),
        orderIndex: z.number().int().min(0).optional(),
    }),
});

export const reorderQuestionsSchema = z.object({
    body: z.object({
        questionOrders: z.array(z.object({
            questionId: z.string(),
            orderIndex: z.number().int().min(0),
        })),
    }),
});
