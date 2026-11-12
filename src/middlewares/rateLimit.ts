import { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

interface RateLimiterOptions {
    prefix: string;
    max: number;
    windowMs: number;
    message?: string;
    keyByUser?: boolean;
}

// NOTE on keyByUser: app-level limiters (app.ts) run before auth, so they
// always fall back to IP. Route-level limiters mounted AFTER requireAuth
// (e.g. chat, manual enrollment) do see req.user and key by user correctly.
const requestKey = (req: Request, keyByUser?: boolean): string => {
    if (keyByUser && (req as any).user?.id) {
        return `user:${(req as any).user.id}`;
    }
    return req.ip || 'unknown';
};

export const createRateLimiter = (options: RateLimiterOptions) => {
    const { max, windowMs, message, keyByUser } = options;

    return rateLimit({
        windowMs,
        max,
        message: message || 'Too many requests, please try again later',
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req: Request) => requestKey(req, keyByUser),
        handler: (_req: Request, res: Response, _next: NextFunction) => {
            res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
            res.status(429).json({
                success: false,
                message: message || 'Too many requests, please try again later',
            });
        },
    });
};
