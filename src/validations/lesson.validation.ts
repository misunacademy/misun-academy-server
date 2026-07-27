import { z } from 'zod';

const resourceSchema = z.object({
    title: z.string().min(1, 'Resource title is required'),
    type: z.enum(['link', 'text']),
    url: z.string().optional(),
    textContent: z.string().optional(),
});

export const createLessonSchema = z.object({
    body: z.object({
        title: z.string().min(1, 'Title is required'),
        description: z.string().optional(),
        type: z.enum(['video', 'reading', 'quiz', 'project'], {
            required_error: 'Lesson type is required',
        }),
        videoSource: z.enum(['youtube', 'googledrive']).optional(),
        videoId: z.string().optional(),
        videoUrl: z.string().optional(),
        videoDuration: z.coerce.number().optional(),
        content: z.string().optional(),
        isMandatory: z.boolean().optional(),
        isPublished: z.boolean().optional(),
        resources: z.array(resourceSchema).optional(),
    }),
});

export const updateLessonSchema = z.object({
    body: z.object({
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        type: z.enum(['video', 'reading', 'quiz', 'project']).optional(),
        videoSource: z.enum(['youtube', 'googledrive']).optional(),
        videoId: z.string().optional(),
        videoUrl: z.string().optional(),
        videoDuration: z.coerce.number().optional(),
        content: z.string().optional(),
        isMandatory: z.boolean().optional(),
        isPublished: z.boolean().optional(),
        resources: z.array(resourceSchema).optional(),
    }),
});

export const reorderLessonsSchema = z.object({
    body: z.object({
        lessonOrders: z.array(z.object({
            lessonId: z.string(),
            orderIndex: z.number(),
        })),
    }),
});
