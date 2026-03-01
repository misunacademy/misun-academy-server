import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import router from './routes';
import globalErrorHandler from './middlewares/globalErrorHandler';
import env from './config/env';
import { connectDB } from './config/database';

const app = express();

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
    origin: [
        env.FRONTEND_URL!,
        env.CLIENT_URL!,
        'http://localhost:3000' // Fallback for development
    ].filter(Boolean),
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
import BetterAuthRoutes from './routes/betterAuth.routes';

// Enable body parsing BEFORE auth routes so Better Auth can read request body
app.use(express.urlencoded({ extended: true })); // FOR FORM DATA
app.use(express.json()); // FOR JSON

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

// Mount Better Auth routes (inherits auth rate limiter above)
app.use('/api/v1/auth', BetterAuthRoutes);

// Now safe to apply express.json() for other routes
// app.use(express.urlencoded({ extended: true })); // FOR FORM DATA
// app.use(express.json()); // FOR JSON

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
