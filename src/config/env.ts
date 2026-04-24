import "dotenv/config";
import { z } from "zod";
import ApiError from "../errors/ApiError.js";

// Define the environment schema with validation
const EnvSchema = z.object({
    // General
    PORT: z.string().default("5000"),
    NODE_ENV: z.enum(["development", "production", "stage"]),
    LOG_LEVEL: z.string().default("info"),
    // Database
    MONGO_URI: z.string(),

    SUPER_ADMIN_EMAIL: z.string(),
    SUPER_ADMIN_PASSWORD: z.string(),

    // Better Auth (NEW)
    BETTER_AUTH_SECRET: z.string(),
    BETTER_AUTH_URL: z.string(),
    AUTH_COOKIE_DOMAIN: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string(),
    GOOGLE_CLIENT_SECRET: z.string(),
    CLIENT_URL: z.string().optional(),

    // JWT (DEPRECATED - will be removed after migration)
    JWT_SECRET: z.string().optional(),
    JWT_REFRESH_SECRET: z.string().optional().default("yourRefreshSecretKey"),
    JWT_EXPIRY: z.string().optional(),

    SSL_STORE_ID: z.string(),
    SSL_STORE_PASSWORD: z.string(),
    SSL_IS_LIVE: z.string(),
    SSL_PAYMENT_API: z.string(),
    SSL_VALIDATION_API: z.string(),
    SERVER_URL: z.string(),
    MA_FRONTEND_URL: z.string(),
    EP_FRONTEND_URL: z.string(),
    // Email provider settings (optional - sensible defaults used)
    EMAIL_USER: z.string(),
    EMAIL_PASS: z.string(),
    EMAIL_PROVIDER: z.string().optional(),
    EMAIL_HOST: z.string().optional(),
    EMAIL_PORT: z.string().optional(),
    EMAIL_SECURE: z.string().optional(),
    EMAIL_FROM: z.string().optional().default('"Misun Academy" <no-reply@misun-academy.com>'),
    EMAIL_MAX_RETRIES: z.string().optional().default('3'),

    // Social media group links (optional)
    MA_FACEBOOK_GROUP_LINK: z.string().optional(),
    MA_WHATSAPP_GROUP_LINK: z.string().optional(),
    EP_FACEBOOK_GROUP_LINK: z.string().optional(),
    EP_WHATSAPP_GROUP_LINK: z.string().optional(),

    MA_EMAIL_SOCIAL_YOUTUBE: z.string().optional(),
    MA_EMAIL_SOCIAL_FACEBOOK: z.string().optional(),
    MA_EMAIL_SOCIAL_TWITTER: z.string().optional(),
    MA_EMAIL_SOCIAL_LINKEDIN: z.string().optional(),
    MA_EMAIL_SOCIAL_WEBSITE: z.string().optional(),

    EP_EMAIL_SOCIAL_YOUTUBE: z.string().optional(),
    EP_EMAIL_SOCIAL_FACEBOOK: z.string().optional(),

    // Cloudinary config (required for image uploads)
    CLOUDINARY_CLOUD_NAME: z.string(),
    CLOUDINARY_API_KEY: z.string(),
    CLOUDINARY_API_SECRET: z.string()
});

// Validate and parse environment variables
const parsedEnv = EnvSchema.safeParse(process.env);

if (!parsedEnv.success) {
    const errorMessage = parsedEnv.error.issues
        .map((issue) => `❌ ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");

    throw new ApiError(500, `Environment variables validation failed:\n${errorMessage}`);
}


const env = parsedEnv.data;
export default env;