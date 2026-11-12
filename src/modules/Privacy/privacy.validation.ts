import { z } from 'zod';

export const consentSchema = z.object({
    body: z.object({
        consentType: z.string().min(1, { message: 'Consent type is required' }),
        granted: z.boolean(),
        source: z.string().min(1, { message: 'Source is required' }).optional(),
    }),
});
