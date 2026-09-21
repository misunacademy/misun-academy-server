import { NextFunction, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../errors/ApiError.js';
import { EnrollmentModel } from '../modules/Enrollment/enrollment.model.js';
import { EnrollmentStatus } from '../types/common.js';

/**
 * Middleware to verify that the user is enrolled in a specific batch
 * Expects req.params.batchId and req.user.userId to be set
 */
export const checkBatchEnrollment = async (req: any, res: Response, next: NextFunction) => {
    try {
        const { batchId } = req.params;
        const userId = req.user?.id;

        if (!userId) {
            throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');
        }

        if (!batchId) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Batch ID is required');
        }

        // Graduates keep lifetime access: approving a certificate flips the
        // enrollment to Completed, which must still pass this gate. Only
        // terminal/revoked states are blocked.
        const enrollment = await EnrollmentModel.findOne({
            userId,
            batchId,
            status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
        });

        if (!enrollment) {
            throw new ApiError(
                StatusCodes.FORBIDDEN,
                'You are not enrolled in this batch or your enrollment is not active'
            );
        }

        // Attach enrollment to request for use in controllers
        req.enrollment = enrollment;

        next();
    } catch (error) {
        next(error);
    }
};
