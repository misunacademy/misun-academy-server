import mongoose from "mongoose";
import { initializeAuth } from "./betterAuth.js";
import env from "./env.js";
import { logger } from "./logger.js";

let isConnected = false;

export const connectDB = async (poolSize = 50) => {
    if (isConnected) {
        logger.info('MongoDB already connected');
        return;
    }

    try {
        const db = await mongoose.connect(env.MONGO_URI, {
            bufferCommands: false,
            maxPoolSize: poolSize,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            retryWrites: true,
            w: 'majority',
        });
        isConnected = db.connections[0].readyState === 1;
        logger.info('MongoDB connected');

        await initializeAuth();
        logger.info('Better Auth initialized');
    } catch (error) {
        logger.error(error, 'MongoDB connection error');
        throw error;
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
