import { z } from 'zod';

export const createSalarySchema = z.object({
    body: z.object({
        employeeId: z.string(),
        amount: z.number().positive(),
        month: z.string(),
        year: z.number().int().min(2020).max(2100),
    }),
});

export const updateSalarySchema = z.object({
    body: z.object({
        amount: z.number().positive().optional(),
        month: z.string().optional(),
        year: z.number().int().min(2020).max(2100).optional(),
    }),
});

export const updateSalaryStatusSchema = z.object({
    body: z.object({
        status: z.enum(['Pending', 'Paid', 'Cancelled']),
    }),
});

export const createLeaveRequestSchema = z.object({
    body: z.object({
        startDate: z.string(),
        endDate: z.string(),
        reason: z.string().min(10),
        leaveType: z.enum(['Sick', 'Casual', 'Annual', 'Unpaid']),
    }),
});

export const updateLeaveStatusSchema = z.object({
    body: z.object({
        status: z.enum(['Pending', 'Approved', 'Rejected']),
        adminNote: z.string().optional(),
    }),
});
