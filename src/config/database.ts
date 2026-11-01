import mongoose from "mongoose";
import { initializeAuth } from "./betterAuth.js";
import env from "./env.js";
import { logger } from "./logger.js";

const CONNECT_RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 30000];

let isConnected = false;

// Reset the cached flag when the driver drops: otherwise a post-connect
// network partition makes every later connectDB() a silent no-op.
mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn('MongoDB disconnected (connection event)');
});

// Atlas free tier caps connections and serverless (Vercel) multiplies them
// per invocation — 50/instance is a connection storm. 10 sustains normal API
// traffic; raise deliberately, not by default.
export const connectDB = async (poolSize = 10) => {
    if (isConnected) {
        logger.info('MongoDB already connected');
        return;
    }

    for (let attempt = 0; ; attempt++) {
        try {
            const db = await mongoose.connect(env.MONGO_URI, {
                bufferCommands: false,
                maxPoolSize: poolSize,
                serverSelectionTimeoutMS: 10000,
                socketTimeoutMS: 45000,
                retryWrites: true,
                w: 'majority',
            });
            isConnected = db.connections[0].readyState === 1;
            logger.info('MongoDB connected');

            await initializeAuth();
            logger.info('Better Auth initialized');
            return;
        } catch (error) {
            const delay = CONNECT_RETRY_DELAYS_MS[attempt];
            if (delay === undefined) {
                logger.error(error, 'MongoDB connection failed after all retries');
                throw error;
            }
            const reason = error instanceof Error ? error.message : String(error);
            // Strip embedded credentials: driver errors echo the full URI.
            const safeReason = reason.replace(/\/\/[^@]*@/, '//[credentials]@');
            logger.warn(
                `MongoDB connection attempt ${attempt + 1} failed (${safeReason}) — retrying in ${delay / 1000}s`
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
};

export const disconnectDB = async () => {
    if (!isConnected) return;
    try {
        await mongoose.disconnect();
        isConnected = false;
        logger.info('MongoDB disconnected');
    } catch (error) {
        logger.error(error, 'MongoDB disconnection error');
    }
};
