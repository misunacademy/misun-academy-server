import { z } from 'zod';
import { Role } from '../../types/role.js';
import { UserStatus } from '../../types/common.js';

export const adminRegisterSchema = z.object({
    body: z.object({
        name: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(6),
        role: z.enum([Role.ADMIN, Role.SUPERADMIN]).optional(),
    }),
});

export const loginValidationSchema = z.object({
    body: z.object({
        email: z.string().email({ message: 'Invalid email' }),
        password: z.string().min(6, { message: 'Password must be at least 8 characters' }),
    }),
});

export const sendNewsUpdateSchema = z.object({
    body: z.object({
        subject: z.string().min(1, { message: 'Subject is required' }).max(200, { message: 'Subject must be less than 200 characters' }),
        message: z.string().min(1, { message: 'Message is required' }),
    }),
});

export const sendBatchProgressReminderSchema = z.object({
    body: z.object({
        courseId: z.string().min(1, { message: 'Course ID is required' }),
        batchId: z.string().min(1, { message: 'Batch ID is required' }),
    }),
});

export const sendBatchIncompleteReminderSchema = z.object({
    body: z.object({
        courseId: z.string().min(1, { message: 'Course ID is required' }),
        batchId: z.string().min(1, { message: 'Batch ID is required' }),
    }),
});

export const updateUserSchema = z.object({
    body: z.object({
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        role: z.enum([Role.ADMIN, Role.SUPERADMIN, Role.INSTRUCTOR, Role.LEARNER, Role.EMPLOYEE]).optional(),
        phone: z.string().optional(),
    }),
});

export const updateUserStatusSchema = z.object({
    body: z.object({
        status: z.enum([UserStatus.Active, UserStatus.Suspended, UserStatus.Deleted]),
    }),
});
