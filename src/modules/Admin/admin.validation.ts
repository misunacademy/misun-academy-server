import { z } from 'zod';
import { Role } from '../../types/role.js';

export const adminRegisterSchema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum([Role.ADMIN, Role.SUPERADMIN]).optional(),
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
