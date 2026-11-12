import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';

// Mock express rate-limit fallback
jest.mock('express-rate-limit', () => ({
    __esModule: true,
    default: jest.fn(() => (req: any, res: any, next: any) => next()),
}));

jest.mock('@upstash/redis', () => {
    const Redis = jest.fn().mockImplementation(() => {
        throw new Error('Redis connection refused');
    });
    return { Redis };
});

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

    describe('Fail-closed rate limiting', () => {
        it('fails closed when Redis is unavailable in production', async () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';

            // Re-import to test with production env
            jest.resetModules();
            const { createRateLimiter: crl } = await import('../../middlewares/rateLimit.js');

            // In production without Redis, should fail closed (reject)
            const limiter = crl({
                prefix: 'test',
                max: 5,
                windowMs: 60 * 60 * 1000,
            });

            const mockReq: any = { ip: '127.0.0.1', url: '/test' };
            const mockRes: any = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() };
            const mockNext = jest.fn();

            await limiter(mockReq, mockRes, mockNext);

            expect(mockRes.status).toHaveBeenCalledWith(503);
            expect(mockNext).not.toHaveBeenCalled();

            process.env.NODE_ENV = originalEnv;
        });
    });
});
