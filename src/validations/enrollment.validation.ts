import { z } from 'zod';

// ObjectId-shaped strings: malformed IDs must 400 at the edge, never reach
// Mongoose as CastError 500s.
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID');

export const initiateEnrollmentSchema = z.object({
    body: z.object({
        batchId: objectId,
    }),
});

export const manualEnrollmentSchema = z.object({
    body: z.object({
        batchId: objectId,
        // Required: the controller rejects requests without these, so the
        // schema enforces them up front for uniform Zod 400s.
        paymentData: z.object({
            senderNumber: z.string().trim().min(1, 'senderNumber is required').max(30),
            transactionId: z.string().trim().min(1, 'transactionId is required').max(100),
        }),
    }),
});

export const grantAccessSchema = z.object({
    body: z.object({
        email: z.string().email(),
        courseId: objectId,
        batchId: objectId,
    }),
});

export const updateEnrollmentStatusSchema = z.object({
    body: z.object({
        // Must match EnrollmentStatus (lowercase) in src/types/common.ts
        status: z.enum([
            'pending',
            'payment-pending',
            'active',
            'completed',
            'suspended',
            'refunded',
            'payment-failed',
        ]),
        reason: z.string().max(1000).optional(),
    }),
});
