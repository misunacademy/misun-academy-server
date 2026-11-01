import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID');

export const createModuleSchema = z.object({
    body: z.object({
        title: z.string().min(1).max(300),
        description: z.string().max(5000).optional(),
        // First module is index 0 (service auto-assigns 0) — min(0), not positive.
        orderIndex: z.number().int().min(0).optional(),
        estimatedDuration: z.string().min(1).max(100),
        status: z.enum(['draft', 'published']).optional(),
    }),
});

export const updateModuleSchema = z.object({
    body: z.object({
        title: z.string().min(1).max(300).optional(),
        description: z.string().max(5000).optional(),
        orderIndex: z.number().int().min(0).optional(),
        estimatedDuration: z.string().min(1).max(100).optional(),
        // Publishing happens through this endpoint — omitting status used to
        // silently swallow publish attempts (validateRequest strips unknown
        // keys), stranding every module as draft with a success toast.
        status: z.enum(['draft', 'published']).optional(),
    }),
});

export const reorderModulesSchema = z.object({
    body: z.object({
        // What both controllers/services actually consume (module.controller,
        // instructor.controller, module.service, instructor.service).
        moduleOrders: z.array(z.object({
            moduleId: objectId,
            orderIndex: z.number().int().min(0),
        })).min(1).max(500),
    }),
});
