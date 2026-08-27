import { z } from 'zod';

export const createModuleSchema = z.object({
    body: z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        orderIndex: z.number().int().positive().optional(),
        estimatedDuration: z.string().min(1),
    }),
});

export const updateModuleSchema = z.object({
    body: z.object({
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        estimatedDuration: z.string().min(1).optional(),
    }),
});

export const reorderModulesSchema = z.object({
    body: z.object({
        moduleIds: z.array(z.string()),
    }),
});
