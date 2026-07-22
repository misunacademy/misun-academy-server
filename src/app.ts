import * as Sentry from '@sentry/node';
import express from 'express';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { apiReference } from '@scalar/express-api-reference';
import router from './routes/index.js';
import globalErrorHandler from './middlewares/globalErrorHandler.js';
import { correlationId } from './middlewares/correlationId.js';
import { requestLogger } from './middlewares/requestLogger.js';
import { csrfProtection } from './middlewares/csrfProtection.js';
import env from './config/env.js';
import { connectDB } from './config/database.js';
import { logger } from './config/logger.js';

Sentry.init({
    dsn: env.SENTRY_DSN || undefined,
    environment: env.NODE_ENV,
    tracesSampleRate: parseFloat(env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    integrations: [Sentry.expressIntegration()],
});

const app = express();

app.set("trust proxy", 1);

let dbConnected = false;

if (process.env.VERCEL) {
    app.use(async (req, res, next) => {
        if (!dbConnected) {
            try {
                await connectDB();
                dbConnected = true;
            } catch (error) {
                logger.error(error, 'Database connection failed (Vercel)');
                return res.status(500).json({
                    success: false,
                    message: 'Database connection failed'
                });
            }
        }
        next();
    });
}

app.use(cors({
    origin: [
        env.MA_FRONTEND_URL!,
        env.EP_FRONTEND_URL!,
        'http://localhost:3000',
        'http://localhost:3001',
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'x-correlation-id', 'X-CSRF-Token'],
}));

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
    },
    noSniff: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    xssFilter: true,
}));

// Correlation ID & structured request logging (replaces morgan)
app.use(correlationId);
app.use(requestLogger);

app.use(compression());
app.use(cookieParser());

import BetterAuthRoutes, { betterAuthCatchAll } from './routes/betterAuth.routes.js';

const strictAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'Too many login/signup attempts, please try again after 15 minutes',
    standardHeaders: true,
    legacyHeaders: false,
});

const generalAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Too many auth requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/v1/auth/sign-in', strictAuthLimiter);
app.use('/api/v1/auth/sign-up', strictAuthLimiter);
app.use('/api/v1/auth/verify-email', strictAuthLimiter);
app.use('/api/v1/auth/forget-password', strictAuthLimiter);
app.use('/api/v1/auth/reset-password', strictAuthLimiter);
app.use('/api/v1/auth/change-password', strictAuthLimiter);

app.use('/api/v1/auth', generalAuthLimiter);
app.use('/api/v1/auth', BetterAuthRoutes);

app.all('/api/v1/auth/*splat', betterAuthCatchAll);
app.all('/api/v1/auth', betterAuthCatchAll);

// Fallback: unmatched auth paths redirect to client login (safety net for OAuth error redirects)
app.use('/api/v1/auth', (req, res) => {
  res.redirect(`${env.MA_FRONTEND_URL}/auth`);
});

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

app.use('/api/v1', csrfProtection);

const apiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: 'Too many requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/v1', apiRateLimiter, router);

// Health check endpoints
app.get('/health', (_req, res) => {
    const dbState = mongoose.connection.readyState;
    const dbStatus = dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected';

    res.status(dbState === 1 ? 200 : 503).json({
        success: dbState === 1,
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        db: dbStatus,
    });
});

app.get('/ready', async (_req, res) => {
    const dbState = mongoose.connection.readyState;
    if (dbState === 1) {
        return res.status(200).json({ success: true, status: 'ready' });
    }
    res.status(503).json({ success: false, status: 'not ready', db: dbState });
});

const openApiSpecPath = path.resolve(process.cwd(), 'openapi.json');

app.get('/openapi.json', (_req, res) => {
    if (!fs.existsSync(openApiSpecPath)) {
        return res.status(500).json({
            success: false,
            message: 'OpenAPI spec not found. Run: npm run docs:generate',
        });
    }

    return res.sendFile(openApiSpecPath);
});

app.use('/docs', (_req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data: https:"
    );
    next();
});

app.use(
    '/docs',
    apiReference({
        url: '/openapi.json',
    })
);

app.get('/', (_req, res) => {
    res.json({
        success: true,
        message: 'API is running',
        timestamp: new Date().toISOString(),
    });
});

Sentry.setupExpressErrorHandler(app);

// 404 handler
app.use((_req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
    });
});

app.use(globalErrorHandler);

export default app;
