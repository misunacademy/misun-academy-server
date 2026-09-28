import { z } from 'zod';

export const updateCertificateSchema = z.object({
    body: z.object({
        grade: z.string().max(50).optional(),
        issuedDate: z.string().max(30).optional(),
        certificateUrl: z.string().url().max(2048).optional(),
        // Compat approve/reject path (validateRequest strips unknown keys, so
        // these must be allowlisted or the endpoint always 400s).
        status: z.string().max(20).optional(),
        reason: z.string().max(500).optional(),
        rejectionReason: z.string().max(500).optional(),
    }),
});

export const issueCertificateSchema = z.object({
    body: z.object({
        grade: z.string().max(50).optional(),
        issuedDate: z.string().max(30).optional(),
    }),
});
