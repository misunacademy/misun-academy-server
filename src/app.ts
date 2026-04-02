import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import router from './routes/index.js';
import globalErrorHandler from './middlewares/globalErrorHandler.js';
import env from './config/env.js';
import { connectDB } from './config/database.js';

const app = express();

const toOrigin = (value?: string | null): string | null => {
    if (!value) return null;
    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
};

const withHostVariants = (origin: string): string[] => {
    const variants = new Set<string>([origin]);

    try {
        const url = new URL(origin);
        const host = url.hostname;
        if (host.startsWith('www.')) {
            url.hostname = host.replace(/^www\./, '');
            variants.add(url.origin);
        } else {
            url.hostname = `www.${host}`;
            variants.add(url.origin);
        }
    } catch {
        // Ignore malformed values.
    }

    return Array.from(variants);
};

const allowedOrigins = new Set<string>();
for (const rawOrigin of [
    env.MA_FRONTEND_URL,
    env.EP_FRONTEND_URL,
    env.CLIENT_URL,
    env.SSL_PAYMENT_API,
    env.SSL_VALIDATION_API,
    'http://localhost:3000',
    'http://localhost:3001',
    'https://securepay.sslcommerz.com',
    'https://sandbox.sslcommerz.com',
    'https://seamless-epay.sslcommerz.com',
]) {
    const origin = toOrigin(rawOrigin);
    if (!origin) continue;
    for (const variant of withHostVariants(origin)) {
        allowedOrigins.add(variant);
    }
}

app.set("trust proxy", 1);

let dbConnected = false;

// Initialize database connection on first request (ONLY for Vercel serverless)
// For VPS/traditional deployment, DB is connected in server.ts before listening
if (process.env.VERCEL) {
    app.use(async (req, res, next) => {
        if (!dbConnected) {
            try {
                await connectDB();
                console.log('✅ Database connected (Vercel serverless)');
                dbConnected = true;
            } catch (error) {
                console.error('❌ Database connection failed:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Database connection failed'
                });
            }
        }
        next();
    });
}

// Middleware
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) {
            callback(null, true);
            return;
        }

        if (allowedOrigins.has(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
}));                // Enables Cross-Origin Resource Sharing

// Enhanced Security Headers with Helmet
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
    crossOriginEmbedderPolicy: false, // Allow embedding for OAuth
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: {
        maxAge: 31536000, // 1 year in seconds
        includeSubDomains: true,
        preload: true,
    },
    noSniff: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    xssFilter: true,
}));
app.use(morgan('dev'));         // Logs HTTP requests for better monitoring
app.use(compression());         // Compresses response bodies for faster delivery

// to prevent client API from hanging.
import BetterAuthRoutes, { betterAuthCatchAll } from './routes/betterAuth.routes.js';

// IMPORTANT: Keep Better Auth mounted before body parsers.
// Applying express.json() before Better Auth can cause auth requests to hang.

// Stricter Rate Limiter for Auth Routes (prevents brute force attacks)
// IMPORTANT: Apply BEFORE mounting auth routes
// 1. Strict Rate Limiter for sensitive routes (Login, Signup, Password Reset)
// Prevents brute force attacks
const strictAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit to 20 requests per 15 mins (slightly relaxed from 15)
    message: 'Too many login/signup attempts, please try again after 15 minutes',
    standardHeaders: true,
    legacyHeaders: false,
});

// 2. General Rate Limiter for other auth routes (get-session, etc.)
// Allows frequent polling/validation without blocking legitimate users
const generalAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Generous limit for session checks
    message: 'Too many auth requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply STRICT limiter to sensitive endpoints
// Note: These prefixes match Better Auth's default paths
app.use('/api/v1/auth/sign-in', strictAuthLimiter);
app.use('/api/v1/auth/sign-up', strictAuthLimiter);
app.use('/api/v1/auth/verify-email', strictAuthLimiter);
app.use('/api/v1/auth/forget-password', strictAuthLimiter);
app.use('/api/v1/auth/reset-password', strictAuthLimiter);
app.use('/api/v1/auth/change-password', strictAuthLimiter);

// Apply GENERAL limiter to all auth routes (acts as a baseline/fallback)
// Since rate limiters call next(), requests to /sign-in will go through 
// strictAuthLimiter -> generalAuthLimiter -> handler
// This is fine as the strict limit will trigger first/fail first if exceeded.
app.use('/api/v1/auth', generalAuthLimiter);

// Custom auth utility routes (e.g. GET /api/v1/auth/me)
app.use('/api/v1/auth', BetterAuthRoutes);

// Better Auth catch-all routes (Express v5 pattern)
app.all('/api/v1/auth/*splat', betterAuthCatchAll);
app.all('/api/v1/auth', betterAuthCatchAll);

// Mount body parsers after Better Auth routes
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// API Rate Limiter (for non-auth routes)
const apiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // Limit each IP to 300 requests per windowMs (approx 1 req/3sec)
    message: 'Too many requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

// Routes (Better Auth already mounted above)
// Apply rate limiter specifically to API routes
app.use('/api/v1', apiRateLimiter, router);

// Default route for testing
app.get('/', (req, res) => {
    res.send('API is running');
});

// seedSuperAdmin()

app.use(globalErrorHandler)

export default app;
