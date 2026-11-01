import { NextFunction, Request, Response } from 'express';
import env from '../config/env.js';
import { requireAuth, requireAdmin } from './betterAuth.js';

/**
 * Allow either a scheduler holding `Authorization: Bearer <CRON_SECRET>` (Vercel
 * Cron, external cron, ops runbook) or a signed-in admin triggering the job by
 * hand. When CRON_SECRET is unset the secret path is closed entirely and only
 * admins may call the endpoint.
 */
export const allowCronSecret = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const authHeader = req.headers.authorization;
    if (env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`) {
        return next();
    }
    requireAuth(req, res, () => requireAdmin(req, res, next));
};
