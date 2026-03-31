/* eslint-disable no-unused-vars */
/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import env from '../config/env.js';
import { logger } from '../config/logger.js';
import handleValidationError from '../errors/handleValidationError.js';
import handleZodError from '../errors/handleZodError.js';
import handleCastError from '../errors/handleCastError.js';
import ApiError from '../errors/ApiError.js';
import { IGenericErrorMessage } from '../types/error.js';

const isMongoDuplicateKeyError = (
    err: unknown
): err is {
    code: number;
    keyPattern?: Record<string, number>;
    keyValue?: Record<string, unknown>;
} => {
    if (!err || typeof err !== 'object') {
        return false;
    }

    return 'code' in err && (err as { code?: number }).code === 11000;
};

const globalErrorHandler: ErrorRequestHandler = (
    error,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    env.NODE_ENV === 'development'
        ? console.log(`🐱‍🏍 globalErrorHandler ~~`, { error })
        : logger.error(`🐱‍🏍 globalErrorHandler ~~`, error);

    let statusCode = 500;
    let message = 'Something went wrong !';
    let errorMessages: IGenericErrorMessage[] = [];

    if (error?.name === 'ValidationError') {
        const simplifiedError = handleValidationError(error);
        statusCode = simplifiedError.statusCode;
        message = simplifiedError.message;
        errorMessages = simplifiedError.errorMessages;
    } else if (error instanceof ZodError) {
        const simplifiedError = handleZodError(error);
        statusCode = simplifiedError.statusCode;
        message = simplifiedError.message;
        errorMessages = simplifiedError.errorMessages;
    } else if (error?.name === 'CastError') {
        const simplifiedError = handleCastError(error);
        statusCode = simplifiedError.statusCode;
        message = simplifiedError.message;
        errorMessages = simplifiedError.errorMessages;
    } else if (isMongoDuplicateKeyError(error)) {
        statusCode = 409;
        const duplicateField =
            Object.keys(error.keyPattern || {})[0] ||
            Object.keys(error.keyValue || {})[0] ||
            '';
        const duplicateValue = duplicateField
            ? error.keyValue?.[duplicateField]
            : undefined;

        message = duplicateField
            ? `${duplicateField} already exists`
            : 'Duplicate key error';

        errorMessages = [
            {
                path: duplicateField,
                message:
                    duplicateValue !== undefined
                        ? `${duplicateField} '${String(duplicateValue)}' already exists`
                        : message,
            },
        ];
    } else if (error instanceof ApiError) {
        statusCode = error?.statusCode;
        message = error.message;
        errorMessages = error?.message
            ? [
                {
                    path: '',
                    message: error?.message,
                },
            ]
            : [];
    } else if (error instanceof Error) {
        message = error?.message;
        errorMessages = error?.message
            ? [
                {
                    path: '',
                    message: error?.message,
                },
            ]
            : [];
    }

    res.status(statusCode).json({
        success: false,
        message,
        errorMessages,
        stack: env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
};

export default globalErrorHandler;