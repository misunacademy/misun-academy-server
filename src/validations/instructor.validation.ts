import { z } from 'zod';

export const assignInstructorSchema = z.object({
    body: z.object({
        instructorId: z.string().nullable(),
    }),
});

export const updateInstructorProfileSchema = z.object({
    body: z.object({
        bio: z.string().optional(),
        expertise: z.array(z.string()).optional(),
        phone: z.string().optional(),
    }),
});
