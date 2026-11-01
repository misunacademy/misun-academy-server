import { describe, it, expect } from '@jest/globals';
import { reorderModulesSchema, updateModuleSchema } from '../../validations/module.validation.js';

describe('reorderModulesSchema', () => {
    it('accepts the moduleOrders payload the controllers and clients send', () => {
        expect(() =>
            reorderModulesSchema.parse({
                body: {
                    moduleOrders: [
                        { moduleId: '507f1f77bcf86cd799439011', orderIndex: 1 },
                        { moduleId: '507f1f77bcf86cd799439012', orderIndex: 0 },
                    ],
                },
            })
        ).not.toThrow();
    });

    it('rejects a missing or malformed moduleOrders', () => {
        expect(() => reorderModulesSchema.parse({ body: {} })).toThrow();
        expect(() => reorderModulesSchema.parse({ body: { moduleOrders: 'nope' } })).toThrow();
        expect(() =>
            reorderModulesSchema.parse({ body: { moduleOrders: [{ moduleId: '507f1f77bcf86cd799439011' }] } })
        ).toThrow();
    });
});

describe('updateModuleSchema', () => {
    it('preserves status through validation (publish/unpublish must not be stripped)', async () => {
        const parsed = await updateModuleSchema.parseAsync({ body: { status: 'published' } });
        expect(parsed.body.status).toBe('published');
    });
});
