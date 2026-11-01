import { z } from 'zod';

const objectIdString = z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

// NOTE: params.courseId is intentionally not validated here — classroom URLs
// may carry a course slug, not an ObjectId. The service binds module→course.
export const completeLessonSchema = z.object({
    body: z.object({
        moduleId: objectIdString,
        lessonId: objectIdString,
    }),
});
