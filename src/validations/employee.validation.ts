import { z } from 'zod';

// Schemas mirror employee.model.ts + controller/service reality. The previous
// leave/salary schemas used invented field names (startDate/leaveType/...) so
// every request 400'd or 500'd. Fields here match what the controller reads
// and the model requires.
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID');

const isoDate = z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
    message: 'Invalid date',
});

export const createSalarySchema = z.object({
    body: z.object({
        employeeId: objectId,
        employeeName: z.string().min(1).max(200),
        jobTitle: z.string().min(1).max(200),
        amount: z.number().positive().max(100000000),
        bonus: z.number().min(0).max(100000000).optional(),
        month: z.string().min(1).max(20),
        year: z.number().int().min(2020).max(2100),
        paymentDate: isoDate.optional(),
    }),
});

export const updateSalarySchema = z.object({
    body: z.object({
        employeeName: z.string().min(1).max(200).optional(),
        jobTitle: z.string().min(1).max(200).optional(),
        amount: z.number().positive().max(100000000).optional(),
        bonus: z.number().min(0).max(100000000).optional(),
        month: z.string().min(1).max(20).optional(),
        year: z.number().int().min(2020).max(2100).optional(),
        paymentDate: isoDate.optional(),
    }),
});

export const updateSalaryStatusSchema = z.object({
    body: z.object({
        // Model enum is Paid|Pending — 'Cancelled' would 500 in Mongoose.
        status: z.enum(['Pending', 'Paid']),
    }),
});

export const createLeaveRequestSchema = z.object({
    body: z.object({
        type: z.enum(['Paid Leave', 'Sick Leave', 'Vacation', 'Other']),
        from: isoDate,
        to: isoDate,
        reason: z.string().min(1).max(1000),
    }).refine((v) => new Date(v.to) >= new Date(v.from), {
        message: 'End date must be on or after start date',
        path: ['to'],
    }),
});

export const updateLeaveStatusSchema = z.object({
    body: z.object({
        // No Pending revert (would erase review history) and no adminNote
        // (no model field — it was silently dropped).
        status: z.enum(['Approved', 'Rejected']),
    }),
});

export const updateMyProfileSchema = z.object({
    body: z.object({
        name: z.string().min(1).max(200).optional(),
        phone: z.string().max(30).optional(),
        address: z.string().max(500).optional(),
        whatsapp: z.string().max(30).optional(),
        bloodGroup: z.string().max(10).optional(),
        nidNumber: z.string().max(50).optional(),
        dateOfBirth: isoDate.nullable().optional(),
        tshirtSize: z.string().max(10).nullable().optional(),
        designation: z.string().max(200).nullable().optional(),
        nidPhotoFrontUrl: z.string().url().max(2048).nullable().optional(),
        nidPhotoBackUrl: z.string().url().max(2048).nullable().optional(),
        nidPhotoUrl: z.string().url().max(2048).optional(),
    }),
});
