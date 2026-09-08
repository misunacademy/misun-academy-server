import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const perkSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(1000),
});

const scheduleSchema = z.object({
    day: z.string().min(1).max(100),
    dose: z.string().max(100).optional(),
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(2000),
});

const faqSchema = z.object({
    question: z.string().min(1).max(300),
    answer: z.string().min(1).max(2000),
});

const paymentMethodSchema = z.object({
    label: z.string().min(1).max(100),
    number: z.string().min(1).max(50),
    type: z.string().max(100).optional(),
});

export const createBootcampSchema = z.object({
    body: z.object({
        title: z.string().min(3).max(200),
        season: z.string().min(1).max(100),
        slug: z.string().min(3).max(200).optional(),
        tagline: z.string().max(300).optional(),
        description: z.string().max(5000).optional(),
        status: z.enum(['draft', 'upcoming', 'live', 'completed', 'archived']).optional(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        time: z.string().max(200).optional(),
        platform: z.string().max(200).optional(),
        liveFee: z.number().min(0).optional(),
        recordedPrice: z.number().min(0).optional(),
        thumbnail: z.string().url().optional().or(z.literal('')),
        posterImage: z.string().url().optional().or(z.literal('')),
        perks: z.array(perkSchema).optional(),
        schedule: z.array(scheduleSchema).optional(),
        faq: z.array(faqSchema).optional(),
        paymentMethods: z.array(paymentMethodSchema).optional(),
        registrationOpen: z.boolean().optional(),
    }),
});

export const updateBootcampSchema = z.object({
    params: z.object({
        id: objectId,
    }),
    body: z.object({
        title: z.string().min(3).max(200).optional(),
        season: z.string().min(1).max(100).optional(),
        slug: z.string().min(3).max(200).optional(),
        tagline: z.string().max(300).optional(),
        description: z.string().max(5000).optional(),
        status: z.enum(['draft', 'upcoming', 'live', 'completed', 'archived']).optional(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        time: z.string().max(200).optional(),
        platform: z.string().max(200).optional(),
        liveFee: z.number().min(0).optional(),
        recordedPrice: z.number().min(0).optional(),
        recordedStatus: z.enum(['draft', 'published']).optional(),
        thumbnail: z.string().url().optional().or(z.literal('')),
        posterImage: z.string().url().optional().or(z.literal('')),
        perks: z.array(perkSchema).optional(),
        schedule: z.array(scheduleSchema).optional(),
        faq: z.array(faqSchema).optional(),
        paymentMethods: z.array(paymentMethodSchema).optional(),
        registrationOpen: z.boolean().optional(),
    }),
});

export const bootcampSlugParamSchema = z.object({
    params: z.object({
        slug: z.string().min(1).max(200),
    }),
});

export const bootcampIdParamSchema = z.object({
    params: z.object({
        id: objectId,
    }),
});

export const setRecordedPriceSchema = z.object({
    params: z.object({
        id: objectId,
    }),
    body: z.object({
        recordedPrice: z.number().min(0),
    }),
});

export const publishRecordingSchema = z.object({
    params: z.object({
        id: objectId,
    }),
    body: z.object({
        sourceBatchId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid batch id').optional(),
        recordedPrice: z.number().min(0).optional(),
    }),
});

export const adminBootcampQuerySchema = z.object({
    query: z.object({
        status: z.enum(['draft', 'upcoming', 'live', 'completed', 'archived']).optional(),
        search: z.string().trim().max(150).optional(),
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
});
