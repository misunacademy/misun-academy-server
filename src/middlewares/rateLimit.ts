import { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import env from '../config/env.js';
import { logger } from '../config/logger.js';

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

// NOTE on keyByUser: app-level limiters (app.ts) run before auth, so they
// always fall back to IP. Route-level limiters mounted AFTER requireAuth
// (e.g. chat, manual enrollment) do see req.user and key by user correctly.
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
                    res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
                    return res.status(429).json({
                        success: false,
                        message: message || 'Too many requests, please try again later',
                    });
                }
                return next();
            } catch (error) {
                // Fail-open (availability), but LOUD: a silent Redis outage
                // must not silently disable all rate limiting.
                logger.error(error, `Rate limiter backend failure (${prefix}) - allowing request`);
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
