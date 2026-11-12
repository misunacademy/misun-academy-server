import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';

// Mock express rate-limit
jest.mock('express-rate-limit', () => ({
    __esModule: true,
    default: jest.fn(() => (req: any, res: any, next: any) => next()),
}));

describe('Fix 14: Rate limiting and abuse', () => {
    beforeAll(async () => {
        await connectTestDB();
    });

    afterAll(async () => {
        await disconnectTestDB();
    });

    beforeEach(async () => {
        await clearTestDB();
    });

    describe('In-memory rate limiting', () => {
        it('creates a rate limiter middleware', async () => {
            const { createRateLimiter } = await import('../../middlewares/rateLimit.js');

            const limiter = createRateLimiter({
                prefix: 'test',
                max: 5,
                windowMs: 60 * 60 * 1000,
            });

            const mockReq: any = { ip: '127.0.0.1', url: '/test' };
            const mockRes: any = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() };
            const mockNext = jest.fn();

            await limiter(mockReq, mockRes, mockNext);

            expect(mockNext).toHaveBeenCalled();
        });
    });
});
