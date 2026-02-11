import { z } from 'zod';

export const createCourseSchema = z.object({
    body: z.object({
        title: z.string().min(3).max(200),
        description: z.string().min(10),
        shortDescription: z.string().max(500).optional(),
        thumbnail: z.string().url().optional(),
        level: z.enum(['Beginner', 'Intermediate', 'Advanced']),
        category: z.string(),
        tags: z.array(z.string()).optional(),
        prerequisites: z.array(z.string()).optional(),
        learningOutcomes: z.array(z.string()),
        status: z.enum(['Draft', 'Published', 'Archived']).optional(),
    }),
});

export const updateCourseSchema = z.object({
    body: z.object({
        title: z.string().min(3).max(200).optional(),
        description: z.string().min(10).optional(),
        shortDescription: z.string().max(500).optional(),
        thumbnail: z.string().url().optional(),
        level: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        prerequisites: z.array(z.string()).optional(),
        learningOutcomes: z.array(z.string()).optional(),
        status: z.enum(['Draft', 'Published', 'Archived']).optional(),
    }),
});
