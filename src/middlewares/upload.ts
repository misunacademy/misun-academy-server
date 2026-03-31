import multer from 'multer';
import ApiError from '../errors/ApiError.js';
import { StatusCodes } from 'http-status-codes';
import { Request } from 'express';

// Define allowed file types
const ALLOWED_FORMATS = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// File filter to validate file types
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (ALLOWED_FORMATS.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new ApiError(
            StatusCodes.BAD_REQUEST,
            `Invalid file type. Only JPG, JPEG, PNG, and WEBP are allowed. Received: ${file.mimetype}`
        ));
    }
};

// Configure multer with memory storage
export const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: fileFilter,
    limits: {
        fileSize: MAX_FILE_SIZE,
    },
});

// Middleware to handle multer errors
export const handleMulterError = (error: any, req: Request, res: any, next: any) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(StatusCodes.BAD_REQUEST).json({
                success: false,
                message: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
            });
        }
        return res.status(StatusCodes.BAD_REQUEST).json({
            success: false,
            message: error.message,
        });
    }

    // Handle ApiError instances
    if (error instanceof ApiError) {
        return res.status(error.statusCode).json({
            success: false,
            message: error.message,
        });
    }

    next(error);
};
