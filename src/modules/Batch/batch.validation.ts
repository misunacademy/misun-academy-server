import { z } from 'zod';

export const batchStatusEnum = z.enum(['draft', 'upcoming', 'running', 'completed']);

// ✅ Create Batch Schema
export const createBatchSchema = z.object({
    body: z.object({
        courseId: z.string({
            required_error: 'Course ID is required',
        }).min(1, 'Course ID cannot be empty'),
        title: z
            .string({
                required_error: 'Title is required',
            })
            .min(1, 'Title cannot be empty'),
        price: z
            .number({
                required_error: 'Price is required',
                invalid_type_error: 'Price must be a number',
            })
            .nonnegative('Price must be zero or greater'),
        manualPaymentPrice: z
            .number({
                invalid_type_error: 'Manual payment price must be a number',
            })
            .nonnegative('Manual payment price must be zero or greater')
            .optional(),
        startDate: z
            .string({
                required_error: 'Start date is required',
            })
            .refine((date) => !isNaN(Date.parse(date)), 'Invalid start date format'),
        endDate: z
            .string({
                required_error: 'End date is required',
            })
            .refine((date) => !isNaN(Date.parse(date)), 'Invalid end date format'),
        enrollmentStartDate: z
            .string({
                required_error: 'Enrollment start date is required',
            })
            .refine((date) => !isNaN(Date.parse(date)), 'Invalid enrollment start date format'),
        enrollmentEndDate: z
            .string({
                required_error: 'Enrollment end date is required',
            })
            .refine((date) => !isNaN(Date.parse(date)), 'Invalid enrollment end date format'),
        description: z.string().optional(),
    }),
});

// Update Batch Schema
export const updateBatchSchema = z.object({
    body: z.object({
        title: z.string().min(1, 'Title cannot be empty').optional(),
        status: batchStatusEnum.optional(),
        isCurrent: z.boolean().optional(),
        price: z
            .number({
                invalid_type_error: 'Price must be a number',
            })
            .nonnegative('Price must be zero or greater')
            .optional(),
        manualPaymentPrice: z
            .number({
                invalid_type_error: 'Manual payment price must be a number',
            })
            .nonnegative('Manual payment price must be zero or greater')
            .optional(),
        startDate: z
            .string()
            .refine((date) => !isNaN(Date.parse(date)), 'Invalid start date format')
            .optional(),
        endDate: z
            .string()
            .refine((date) => !isNaN(Date.parse(date)), 'Invalid end date format')
            .optional(),
        enrollmentStartDate: z
            .string()
            .refine((date) => !isNaN(Date.parse(date)), 'Invalid enrollment start date format')
            .optional(),
        enrollmentEndDate: z
            .string()
            .refine((date) => !isNaN(Date.parse(date)), 'Invalid enrollment end date format')
            .optional(),
        description: z.string().optional(),
    }),
});
