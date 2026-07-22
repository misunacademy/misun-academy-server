import { z } from 'zod';

export const createModuleSchema = z.object({
    body: z.object({
        title: z.string().min(1),
        description: z.string().optional(),
    }),
});

export const updateModuleSchema = z.object({
    body: z.object({
        title: z.string().min(1).optional(),
        description: z.string().optional(),
    }),
});

export const reorderModulesSchema = z.object({
    body: z.object({
        moduleIds: z.array(z.string()),
    }),
});
