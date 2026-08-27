import { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import env from '../config/env.js';

interface RateLimiterOptions {
    prefix: string;
    max: number;
    windowMs: number;
    message?: string;
    keyByUser?: boolean;
}

const upstashUrl = env.UPSTASH_REDIS_REST_URL;
const upstashToken = env.UPSTASH_REDIS_REST_TOKEN;

const redis = upstashUrl && upstashToken
    ? new Redis({ url: upstashUrl, token: upstashToken })
    : null;

const requestKey = (req: Request, keyByUser?: boolean): string => {
    if (keyByUser && (req as any).user?.id) {
        return `user:${(req as any).user.id}`;
    }
    return `ip:${req.ip || 'unknown'}`;
};

export const createRateLimiter = (options: RateLimiterOptions) => {
    const { prefix, max, windowMs, message, keyByUser } = options;

    if (redis) {
        const limiter = new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(max, `${windowMs} ms`),
            prefix: `rl:${prefix}`,
            analytics: false,
        });

        return async (req: Request, res: Response, next: NextFunction) => {
            try {
                const { success } = await limiter.limit(requestKey(req, keyByUser));
                if (!success) {
                    return res.status(429).json({
                        success: false,
                        message: message || 'Too many requests, please try again later',
                    });
                }
                return next();
            } catch (error) {
                (req as any).log?.error?.(error, 'Rate limiter backend failure - allowing request');
                return next();
            }
        };
    }

    return rateLimit({
        windowMs,
        max,
        message,
        standardHeaders: true,
        legacyHeaders: false,
    });
};
