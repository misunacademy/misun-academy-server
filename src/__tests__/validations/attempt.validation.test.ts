import { describe, it, expect } from '@jest/globals';
import { submitQuizSchema } from '../../validations/attempt.validation.js';

const body = (overrides: Record<string, unknown> = {}) => ({
    answers: [{ questionId: 'q1', selectedAnswer: 'A' }],
    ...overrides,
});

describe('submitQuizSchema', () => {
    it('accepts a normal submission', () => {
        expect(() => submitQuizSchema.parse({ body: body({ timeTaken: 90 }) })).not.toThrow();
    });

    it('accepts timeTaken 0 for instant submits', () => {
        expect(() => submitQuizSchema.parse({ body: body({ timeTaken: 0 }) })).not.toThrow();
    });

    it('accepts submissions without timeTaken', () => {
        expect(() => submitQuizSchema.parse({ body: { answers: [] } })).not.toThrow();
    });

    it('rejects negative or fractional timeTaken', () => {
        expect(() => submitQuizSchema.parse({ body: body({ timeTaken: -5 }) })).toThrow();
        expect(() => submitQuizSchema.parse({ body: body({ timeTaken: 1.5 }) })).toThrow();
    });

    it('rejects null answers entries outside the schema', () => {
        expect(() => submitQuizSchema.parse({ body: { answers: 'nope' } })).toThrow();
    });
});
