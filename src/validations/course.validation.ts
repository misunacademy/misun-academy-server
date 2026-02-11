import { z } from 'zod';

// Helper: normalize enum strings like "advanced" -> "Advanced"
const normalizeEnum = (v: unknown) => typeof v === 'string' ? (v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()) : v;

// Preprocess incoming body to accept alternate field names from client and
// normalize enum casing so both "advanced" and "Advanced" are accepted.
const normalizeBody = (body: any) => {
    if (body && typeof body === 'object') {
        const b = { ...body };
        // Map client-side field names to server expectations
        if (b.fullDescription && !b.description) b.description = b.fullDescription;
        if (b.thumbnailImage && !b.thumbnail) b.thumbnail = b.thumbnailImage;
        if (b.coverImage && !b.coverImageUrl) b.coverImageUrl = b.coverImage;

        // Normalize enums (case-insensitive)
        if (b.level) b.level = normalizeEnum(b.level);
        if (b.status) b.status = normalizeEnum(b.status);

        return b;
    }
    return body;
};

export const createCourseSchema = z.object({
    body: z.preprocess(normalizeBody, z.object({
        title: z.string().min(3).max(200),
        description: z.string().min(10),
        shortDescription: z.string().max(500).optional(),
        thumbnail: z.string().url().optional(),
        coverImageUrl: z.string().url().optional(),
        level: z.enum(['Beginner', 'Intermediate', 'Advanced']),
        category: z.string(),
        tags: z.array(z.string()).optional(),
        prerequisites: z.array(z.string()).optional(),
        learningOutcomes: z.array(z.string()),
        status: z.enum(['Draft', 'Published', 'Archived']).optional(),
    })),
});

export const updateCourseSchema = z.object({
    body: z.preprocess(normalizeBody, z.object({
        title: z.string().min(3).max(200).optional(),
        description: z.string().min(10).optional(),
        shortDescription: z.string().max(500).optional(),
        thumbnail: z.string().url().optional(),
        coverImageUrl: z.string().url().optional(),
        level: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        prerequisites: z.array(z.string()).optional(),
        learningOutcomes: z.array(z.string()).optional(),
        status: z.enum(['Draft', 'Published', 'Archived']).optional(),
    })),
});
