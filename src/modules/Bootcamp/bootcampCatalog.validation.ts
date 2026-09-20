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

const painPointSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(1000),
});

const outcomeSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(1000),
});

const mentorSchema = z.object({
    name: z.string().min(1).max(200),
    title: z.string().max(200).optional(),
    bio: z.string().max(2000).optional(),
    image: z.string().url().optional().or(z.literal('')),
});

const testimonialSchema = z.object({
    name: z.string().min(1).max(200),
    role: z.string().max(200).optional(),
    quote: z.string().min(1).max(2000),
    rating: z.number().min(1).max(5).optional(),
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
        painPoints: z.array(painPointSchema).optional(),
        outcomes: z.array(outcomeSchema).optional(),
        audience: z.array(z.string().min(1).max(200)).optional(),
        mentor: mentorSchema.optional(),
        testimonials: z.array(testimonialSchema).optional(),
        guaranteeNote: z.string().max(2000).optional(),
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
        painPoints: z.array(painPointSchema).optional(),
        outcomes: z.array(outcomeSchema).optional(),
        audience: z.array(z.string().min(1).max(200)).optional(),
        mentor: mentorSchema.optional(),
        testimonials: z.array(testimonialSchema).optional(),
        guaranteeNote: z.string().max(2000).optional(),
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
        recordedPrice: z.number().min(0).optional(),
    }),
});

export const videoSchema = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    videoSource: z.enum(['youtube', 'googledrive']),
    videoId: z.string().min(1).max(200),
    videoUrl: z.string().max(500).optional(),
    duration: z.number().min(0).optional(),
    isPublished: z.boolean().optional(),
    resources: z
        .array(
            z.object({
                title: z.string().min(1).max(200),
                url: z.string().min(1).max(1000),
            })
        )
        .optional(),
});

export const addBootcampVideoSchema = z.object({
    params: z.object({
        id: objectId,
    }),
    body: videoSchema,
});

export const updateBootcampVideoSchema = z.object({
    params: z.object({
        id: objectId,
        videoId: objectId,
    }),
    body: videoSchema.partial(),
});

export const deleteBootcampVideoSchema = z.object({
    params: z.object({
        id: objectId,
        videoId: objectId,
    }),
});

export const initiateBootcampSSLCommerzSchema = z.object({
    params: z.object({
        slug: z.string().min(1).max(200),
    }),
});

export const bootcampSSLCommerzStatusSchema = z.object({
    query: z.object({
        t: z.string().min(1),
        k: z.string().min(1).optional(),
        status: z.string().optional(),
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

export const bootcampPaymentStatusSchema = z.object({
    query: z.object({
        t: z.string().min(1, 'Transaction ID required'),
        k: z.string().min(1, 'Callback key required'),
        status: z.enum(['success', 'failed', 'cancel']).optional(),
        val_id: z.string().optional(),
        tran_id: z.string().optional(),
        amount: z.string().optional(),
        currency: z.string().optional(),
        verify_key: z.string().optional(),
        verify_sign: z.string().optional(),
    }),
});

export const bootcampPaymentWebhookSchema = z.object({
    body: z.object({
        tran_id: z.string().min(1),
        val_id: z.string().optional(),
        status: z.string().min(1),
        amount: z.string().optional(),
        currency: z.string().optional(),
        verify_key: z.string().optional(),
        verify_sign: z.string().optional(),
    }),
});

export const bootcampPurchaseParamSchema = z.object({
    params: z.object({
        id: objectId,
    }),
});

