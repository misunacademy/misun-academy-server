import { z } from 'zod';

export const createLessonSchema = z.object({
    body: z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        videoUrl: z.string().url().optional().nullable(),
        videoLength: z.number().positive().optional(),
        resources: z.array(z.object({
            title: z.string(),
            type: z.string(),
            url: z.string(),
        })).optional(),
    }),
});

export const updateLessonSchema = z.object({
    body: z.object({
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        videoUrl: z.string().url().optional().nullable(),
        videoLength: z.number().positive().optional(),
        resources: z.array(z.object({
            title: z.string(),
            type: z.string(),
            url: z.string(),
        })).optional(),
    }),
});

export const reorderLessonsSchema = z.object({
    body: z.object({
        lessonIds: z.array(z.string()),
    }),
});
