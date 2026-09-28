import { z } from 'zod';

// Schemas mirror course.model.ts exactly: lowercase enums, model field names.
// Client aliases (description/thumbnail/coverImageUrl) are mapped onto model
// fields and then removed, so validateRequest's write-back never stores a
// wrong-cased enum or a field the model doesn't know. Slugs are immutable
// after create (changing them breaks links and can flip brand derivation).
const normalizeBody = (body: any) => {
    if (body && typeof body === 'object') {
        const b = { ...body };
        if (b.description && !b.fullDescription) b.fullDescription = b.description;
        if (b.thumbnail && !b.thumbnailImage) b.thumbnailImage = b.thumbnail;
        if (b.coverImageUrl && !b.coverImage) b.coverImage = b.coverImageUrl;
        delete b.description;
        delete b.thumbnail;
        delete b.coverImageUrl;
        for (const key of ['level', 'status'] as const) {
            if (typeof b[key] === 'string') b[key] = b[key].toLowerCase();
        }
        return b;
    }
    return body;
};

const levelEnum = z.enum(['beginner', 'intermediate', 'advanced']);
const statusEnum = z.enum(['draft', 'published', 'archived']);

const baseShape = {
    title: z.string().min(3).max(200),
    shortDescription: z.string().min(1).max(300),
    fullDescription: z.string().min(10),
    learningOutcomes: z.array(z.string()).min(1),
    prerequisites: z.array(z.string()).optional(),
    targetAudience: z.string().min(1),
    thumbnailImage: z.string().url(),
    coverImage: z.string().url().optional(),
    durationEstimate: z.string().min(1),
    level: levelEnum,
    category: z.string().min(1),
    tags: z.array(z.string()).optional(),
    features: z.array(z.string()).optional(),
    highlights: z.array(z.string()).optional(),
    featured: z.boolean().optional(),
    status: statusEnum.optional(),
    isCertificateAvailable: z.boolean().optional(),
};

const optionalShape = Object.fromEntries(
    Object.entries(baseShape).map(([key, schema]) => [key, schema.optional()])
);

export const createCourseSchema = z.object({
    body: z.preprocess(normalizeBody, z.object(baseShape)),
});

export const updateCourseSchema = z.object({
    body: z.preprocess(normalizeBody, z.object(optionalShape as any)),
});
