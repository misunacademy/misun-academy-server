import { describe, it, expect } from '@jest/globals';
import { reorderModulesSchema } from '../../validations/module.validation.js';

describe('reorderModulesSchema', () => {
    it('accepts the moduleOrders payload the controllers and clients send', () => {
        expect(() =>
            reorderModulesSchema.parse({
                body: {
                    moduleOrders: [
                        { moduleId: 'm1', orderIndex: 1 },
                        { moduleId: 'm2', orderIndex: 0 },
                    ],
                },
            })
        ).not.toThrow();
    });

    it('rejects a missing or malformed moduleOrders', () => {
        expect(() => reorderModulesSchema.parse({ body: {} })).toThrow();
        expect(() => reorderModulesSchema.parse({ body: { moduleOrders: 'nope' } })).toThrow();
        expect(() =>
            reorderModulesSchema.parse({ body: { moduleOrders: [{ moduleId: 'm1' }] } })
        ).toThrow();
    });
});
