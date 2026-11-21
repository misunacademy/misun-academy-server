import { z } from 'zod';

const digitalProductFileSchema = z.object({
    fileName: z.string().optional(),
    url: z.string().optional(),
    fileSize: z.string().optional(),
});

export const createDigitalProductSchema = z.object({
    body: z
        .object({
            title: z.string().min(2, 'Title must be at least 2 characters'),
            slug: z.string().min(2, 'Slug must be at least 2 characters').optional(),
            tagline: z.string().optional(),
            description: z.string().optional(),
            software: z.enum(['photoshop', 'illustrator', 'bundle', 'other']).default('other'),
            priceBDT: z.number().min(0, 'Price in BDT must be at least 0').default(0),
            discountPriceBDT: z.number().min(0).optional(),
            priceINR: z.number().min(0, 'Price in INR must be at least 0').default(0),
            discountPriceINR: z.number().min(0).optional(),
            thumbnail: z.string().optional(),
            badge: z.string().optional(),
            features: z.array(z.string()).default([]),
            scriptFile: digitalProductFileSchema.optional(),
            guidePdf: digitalProductFileSchema.optional(),
            isPublished: z.boolean().optional(),
            status: z.enum(['draft', 'published']).optional(),
        })
        .superRefine((data, ctx) => {
            const isDraft = data.status === 'draft' || data.isPublished === false;
            if (!isDraft) {
                if (!data.scriptFile?.url) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: 'Script file is required for published products',
                        path: ['scriptFile'],
                    });
                }
                if (!data.guidePdf?.url) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: 'Instruction PDF is required for published products',
                        path: ['guidePdf'],
                    });
                }
            }
        }),
});

export const updateDigitalProductSchema = z.object({
    body: z.object({
        title: z.string().min(2).optional(),
        slug: z.string().min(2).optional(),
        tagline: z.string().optional(),
        description: z.string().optional(),
        software: z.enum(['photoshop', 'illustrator', 'bundle', 'other']).optional(),
        priceBDT: z.number().min(0).optional(),
        discountPriceBDT: z.number().min(0).optional(),
        priceINR: z.number().min(0).optional(),
        discountPriceINR: z.number().min(0).optional(),
        thumbnail: z.string().optional(),
        badge: z.string().optional(),
        features: z.array(z.string()).optional(),
        scriptFile: digitalProductFileSchema.optional(),
        guidePdf: digitalProductFileSchema.optional(),
        isPublished: z.boolean().optional(),
        status: z.enum(['draft', 'published']).optional(),
    }),
});

export const initiateSSLCommerzOrderSchema = z.object({
    body: z.object({
        productId: z.string().min(1, 'Product ID is required'),
        name: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        redirectPath: z.string().optional(),
    }),
});

export const submitPhonePeManualOrderSchema = z.object({
    body: z.object({
        productId: z.string().min(1, 'Product ID is required'),
        name: z.string().optional(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        senderPhonePe: z.string().min(4, 'PhonePe sender number / UPI ID is required'),
        transactionId: z.string().min(4, 'PhonePe transaction ID / UTR is required'),
    }),
});

export const reviewDigitalProductOrderSchema = z.object({
    body: z.object({
        status: z.enum(['paid', 'rejected']),
        adminNote: z.string().optional(),
    }),
});
