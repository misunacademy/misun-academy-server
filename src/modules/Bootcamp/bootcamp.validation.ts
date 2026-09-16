import { z } from 'zod';

const validWhatsAppMobile = /^(?:01[3-9]\d{8}|(?:\+?91|0)?[6789]\d{9})$/;

export const registerBootcampValidationSchema = z.object({
    body: z.object({
        name: z
            .string()
            .trim()
            .min(2, 'Name must be at least 2 characters')
            .max(100, 'Name is too long'),
        whatsapp: z
            .string()
            .trim()
            .regex(validWhatsAppMobile, 'Enter a valid WhatsApp number')
            .optional()
            .or(z.literal('')),
        address: z
            .string()
            .trim()
            .min(5, 'Address must be at least 5 characters')
            .max(300, 'Address is too long'),
        email: z
            .string()
            .trim()
            .toLowerCase()
            .email('Enter a valid email address')
            .max(150),
        paymentLast4: z
            .string()
            .trim()
            .regex(/^\d{4}$/, 'Last 4 digits of your payment number'),
    }),
});

export const updateBootcampRegistrationValidationSchema = z.object({
    params: z.object({
        id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid registration id'),
    }),
    body: z.object({
        status: z
            .enum(['pending', 'verified', 'rejected'])
            .optional(),
        adminNote: z.string().trim().max(500).optional(),
    }),
});

export const bootcampQueryValidationSchema = z.object({
    query: z.object({
        status: z.enum(['pending', 'verified', 'rejected']).optional(),
        search: z.string().trim().max(150).optional(),
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
});

export const bootcampIdParamValidationSchema = z.object({
    params: z.object({
        id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid registration id'),
    }),
});
