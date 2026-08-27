import { z } from 'zod';

export const updateCertificateSchema = z.object({
    body: z.object({
        grade: z.string().optional(),
        issuedDate: z.string().optional(),
        certificateUrl: z.string().url().optional(),
    }),
});

export const issueCertificateSchema = z.object({
    body: z.object({
        grade: z.string().optional(),
        issuedDate: z.string().optional(),
    }),
});
