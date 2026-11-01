import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID');

const resourceSchema = z.object({
    title: z.string().min(1, 'Resource title is required').max(300),
    // Model enum is file|link|document (ResourceType); lesson-embedded docs
    // historically used link|text — accept both spellings.
    type: z.enum(['file', 'link', 'document', 'text']),
    url: z.string().url().max(2048).refine(
        (v) => /^https?:\/\//i.test(v),
        { message: 'Resource URL must start with http:// or https:// (no javascript: URLs)' }
    ).optional(),
    textContent: z.string().max(20000).optional(),
}).refine(
    (r) => (r.type === 'link' || r.type === 'file' || r.type === 'document') ? Boolean(r.url) : true,
    { message: 'Resource URL is required for link/file/document resources', path: ['url'] }
);

const videoFields = {
    videoSource: z.enum(['youtube', 'googledrive']).optional(),
    videoId: z.string().max(500).optional(),
    videoUrl: z.string().url().max(2048).optional(),
    videoDuration: z.coerce.number().int().min(0).max(86400).optional(),
};

const withVideoConsistency = <T extends z.ZodRawShape>(shape: T) =>
    z.object(shape).refine(
        (b: any) => (b.videoSource ? Boolean(b.videoId || b.videoUrl) : true),
        { message: 'videoId or videoUrl is required when videoSource is set', path: ['videoId'] }
    );

export const createLessonSchema = z.object({
    body: withVideoConsistency({
        title: z.string().min(1, 'Title is required').max(300),
        description: z.string().max(5000).optional(),
        type: z.enum(['video', 'reading', 'quiz', 'project'], {
            required_error: 'Lesson type is required',
        }),
        ...videoFields,
        content: z.string().max(100000).optional(),
        isMandatory: z.boolean().optional(),
        isPublished: z.boolean().optional(),
        resources: z.array(resourceSchema).max(50).optional(),
    }),
});

export const updateLessonSchema = z.object({
    body: withVideoConsistency({
        title: z.string().min(1).max(300).optional(),
        description: z.string().max(5000).optional(),
        type: z.enum(['video', 'reading', 'quiz', 'project']).optional(),
        ...videoFields,
        content: z.string().max(100000).optional(),
        isMandatory: z.boolean().optional(),
        isPublished: z.boolean().optional(),
        resources: z.array(resourceSchema).max(50).optional(),
    }),
});

export const reorderLessonsSchema = z.object({
    body: z.object({
        lessonOrders: z.array(z.object({
            lessonId: objectId,
            orderIndex: z.number().int().min(0),
        })).min(1).max(500),
    }),
});
