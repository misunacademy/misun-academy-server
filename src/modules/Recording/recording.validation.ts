import { z } from 'zod';

const createRecording = z.object({
    body: z.object({
        courseId: z.string().min(1, 'Course is required'),
        batchId: z.string().min(1, 'Batch is required'),
        title: z.string().min(1, 'Title is required'),
        description: z.string().optional(),
        sessionDate: z.string().min(1, 'Session date is required'),
        videoSource: z.enum(['youtube', 'googledrive'], {
            required_error: 'Video source must be youtube or googledrive',
        }),
        videoId: z.string().min(1, 'Video ID is required'),
        duration: z.coerce.number().optional(),
        isPublished: z.boolean().optional(),
    }),
});

const updateRecording = z.object({
    body: z.object({
        courseId: z.string().optional(),
        batchId: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        sessionDate: z.string().optional(),
        videoSource: z.enum(['youtube', 'googledrive']).optional(),
        videoId: z.string().optional(),
        duration: z.coerce.number().optional(),
        isPublished: z.boolean().optional(),
    }),
});

export const RecordingValidation = {
    createRecording,
    updateRecording,
};