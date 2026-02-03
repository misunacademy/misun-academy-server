import mongoose from "mongoose";
import { initializeAuth } from "./betterAuth";

let isConnected = false;

export const connectDB = async () => {
    if (isConnected) {
        console.log('MongoDB already connected');
        return;
    }

    try {
        const db = await mongoose.connect(process.env.MONGO_URI!, {
            // Disable buffering to fail fast
            bufferCommands: false,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        isConnected = db.connections[0].readyState === 1;
        console.log(" MongoDB connected");
        
        // Initialize Better Auth after database connection
        initializeAuth();
        console.log(" Better Auth initialized");
    } catch (error) {
        console.error(" MongoDB connection error:", error);
        throw error;
    }
};
