import { z } from 'zod';

export const createAnnouncementSchema = z.object({
  body: z.object({
    title: z.string().trim().min(3).max(150),
    message: z.string().trim().min(10).max(2000),
    type: z.enum(['info', 'success', 'warning', 'critical']).optional(),
    audience: z.enum(['all', 'learner', 'instructor', 'employee', 'admin']).optional(),
    status: z.enum(['draft', 'published', 'scheduled']).optional(),
    link: z.string().trim().max(2048).optional().or(z.literal('')),
    isDismissible: z.boolean().optional(),
    notifyByEmail: z.boolean().optional(),
    publishAt: z.string().datetime({ offset: true }).optional().or(z.literal('')),
    expireAt: z.string().datetime({ offset: true }).optional().or(z.literal('')),
  }),
});

export const updateAnnouncementSchema = z.object({
  params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') }),
  body: z.object({
    title: z.string().trim().min(3).max(150).optional(),
    message: z.string().trim().min(10).max(2000).optional(),
    type: z.enum(['info', 'success', 'warning', 'critical']).optional(),
    audience: z.enum(['all', 'learner', 'instructor', 'employee', 'admin']).optional(),
    status: z.enum(['draft', 'published', 'scheduled', 'expired']).optional(),
    link: z.string().trim().max(2048).optional().or(z.literal('')),
    isDismissible: z.boolean().optional(),
    notifyByEmail: z.boolean().optional(),
    publishAt: z.string().datetime({ offset: true }).optional().or(z.literal('')),
    expireAt: z.string().datetime({ offset: true }).optional().or(z.literal('')),
  }),
});

export const announcementIdParamSchema = z.object({
  params: z.object({ id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id') }),
});

export const announcementQuerySchema = z.object({
  query: z.object({
    status: z.enum(['draft', 'published', 'scheduled', 'expired']).optional(),
    audience: z.enum(['all', 'learner', 'instructor', 'employee', 'admin']).optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
});
