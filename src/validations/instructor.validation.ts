import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID');

export const assignInstructorSchema = z.object({
    body: z.object({
        // null unassigns; "" / malformed IDs must 400, not CastError-500.
        instructorId: objectId.nullable(),
    }),
});

export const updateInstructorProfileSchema = z.object({
    body: z.object({
        bio: z.string().max(2000).optional(),
        expertise: z.array(z.string().max(100)).max(30).optional(),
        phone: z.string().max(30).optional(),
    }),
});
