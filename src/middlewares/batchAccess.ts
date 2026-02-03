import { NextFunction, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../errors/ApiError';
import { EnrollmentModel } from '../modules/Enrollment/enrollment.model';
import { EnrollmentStatus, ProgressStatus } from '../types/common';
import { ModuleProgressModel } from '../modules/Progress/moduleProgress.model';

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

        // Check if user has active enrollment in this batch
        const enrollment = await EnrollmentModel.findOne({
            userId,
            batchId,
            status: EnrollmentStatus.Active,
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

/**
 * Middleware to verify module access for enrolled learner
 * Checks if module is unlocked for the batch
 */
export const checkModuleAccess = async (req: any, res: Response, next: NextFunction) => {
    try {
        const { moduleId } = req.params;
        const enrollment = req.enrollment;

        if (!enrollment) {
            throw new ApiError(StatusCodes.FORBIDDEN, 'Enrollment verification required');
        }

      
        // Check ModuleProgress to see if module is unlocked
        const moduleProgress = await ModuleProgressModel.findOne({
            enrollmentId: enrollment._id,
            moduleId,
        });

        if (!moduleProgress || moduleProgress.status === ProgressStatus.Locked) {
            throw new ApiError(StatusCodes.FORBIDDEN, 'Module is not unlocked yet');
        }
        
        next();
    } catch (error) {
        next(error);
    }
};
