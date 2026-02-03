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

// Initialize database connection on first request (for Vercel serverless)
app.use(async (req, res, next) => {
    if (!dbConnected) {
        try {
            await connectDB();
            console.log('✅ Database connected');
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

// Middleware
app.use(cors({
    origin: [
        env.FRONTEND_URL,
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
app.use(express.urlencoded({ extended: true })); // FOR FORM DATA
app.use(express.json()); // FOR JSON (not needed by SSLCommerz)

// Global Rate Limiter
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Stricter Rate Limiter for Auth Routes (prevents brute force attacks)
const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 requests per windowMs
    message: 'Too many authentication attempts, please try again after 15 minutes',
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/v1/auth/sign-in', authRateLimiter);
app.use('/api/v1/auth/sign-up', authRateLimiter);
app.use('/api/v1/auth/forget-password', authRateLimiter);
app.use('/api/v1/auth/reset-password', authRateLimiter);

// Routes
app.use('/api/v1', router);

// Default route for testing
app.get('/', (req, res) => {
    res.send('API is running');
});

// seedSuperAdmin()

app.use(globalErrorHandler)

export default app;
