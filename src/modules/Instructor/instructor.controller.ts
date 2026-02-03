import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { InstructorModel } from './instructor.model';
import { BatchModel } from '../Batch/batch.model';
import { EnrollmentModel } from '../Enrollment/enrollment.model';
import { BatchStatus } from '../../types/common';
import ApiError from '../../errors/ApiError';

/**
 * Get instructor profile
 */
const getProfile = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;

    const instructor = await InstructorModel.findOne({ id });
    if (!instructor) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Instructor profile not found');
    }

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Instructor profile retrieved successfully',
        data: instructor,
    });
});

/**
 * Update instructor profile
 */
const updateProfile = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { bio, expertise, socialLinks, profilePicture } = req.body;

    const instructor = await InstructorModel.findOneAndUpdate(
        { id },
        { bio, expertise, socialLinks, profilePicture },
        { new: true, runValidators: true }
    );

    if (!instructor) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Instructor profile not found');
    }

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Profile updated successfully',
        data: instructor,
    });
});

/**
 * Get instructor dashboard stats
 */
const getDashboard = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;

    const instructor = await InstructorModel.findOne({ id }).populate('id', 'name email');
    if (!instructor) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Instructor profile not found');
    }

    // Get assigned batches
    const batches = await BatchModel.find({
        'instructors.instructorId': instructor._id,
    })
        .populate('courseId', 'title')
        .select('title batchNumber startDate endDate currentEnrollment maxCapacity status');

    // Calculate total students across all batches
    const totalStudents = batches.reduce((sum, batch) => sum + batch.currentEnrollment, 0);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Dashboard data retrieved successfully',
        data: {
            instructor: {
                name: (instructor.id as any).name,
                rating: instructor.rating,
                totalBatches: instructor.totalBatchesTaught,
                totalStudents: totalStudents,
            },
            batches,
            stats: {
                activeBatches: batches.filter(b => b.status === BatchStatus.Running).length,
                totalStudents,
            },
        },
    });
});

/**
 * Get assigned batches
 */
const getAssignedBatches = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { status } = req.query;

    const instructor = await InstructorModel.findOne({ id });
    if (!instructor) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Instructor profile not found');
    }

    const query: any = { 'instructors.instructorId': instructor._id };
    if (status) {
        query.status = status;
    }

    const batches = await BatchModel.find(query)
        .populate('courseId', 'title description thumbnail')
        .sort({ startDate: -1 });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Assigned batches retrieved successfully',
        data: batches,
    });
});

/**
 * Get batch students roster
 */
const getBatchStudents = catchAsync(async (req: Request, res: Response) => {
    const { batchId } = req.params;
    const { id } = req.user as any;

    // Verify instructor is assigned to this batch
    const instructor = await InstructorModel.findOne({ id });
    if (!instructor) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Instructor profile not found');
    }

    const batch = await BatchModel.findOne({
        _id: batchId,
        'instructors.instructorId': instructor._id,
    });

    if (!batch) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this batch');
    }

    // Get enrollments with user and progress data
    const enrollments = await EnrollmentModel.find({ batchId })
        .populate('id', 'name email profilePicture')
        .select('enrollmentId status enrolledAt accessExpiresAt');

    // Get progress for each enrollment
    const enrollmentsWithProgress = await Promise.all(
        enrollments.map(async (enrollment) => {
            const moduleProgress = await require('../Progress/moduleProgress.model').ModuleProgressModel.find({
                enrollmentId: enrollment._id,
            });

            const completedModules = moduleProgress.filter((p: any) => p.completionPercentage === 100).length;
            const totalModules = moduleProgress.length;

            return {
                ...enrollment.toObject(),
                progress: {
                    completedModules,
                    totalModules,
                    overallProgress: totalModules > 0 ? (completedModules / totalModules) * 100 : 0,
                },
            };
        })
    );

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Batch students retrieved successfully',
        data: enrollmentsWithProgress,
    });
});



/**
 * Get batch statistics
 */
const getBatchStatistics = catchAsync(async (req: Request, res: Response) => {
    const { batchId } = req.params;
    const { id } = req.user as any;

    // Verify instructor is assigned to this batch
    const instructor = await InstructorModel.findOne({ id });
    if (!instructor) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Instructor profile not found');
    }

    const batch = await BatchModel.findOne({
        _id: batchId,
        'instructors.instructorId': instructor._id,
    }).populate('courseId', 'title');

    if (!batch) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'You are not assigned to this batch');
    }

    // Get enrollment statistics
    const totalEnrollments = await EnrollmentModel.countDocuments({ batchId });
    const activeEnrollments = await EnrollmentModel.countDocuments({
        batchId,
        status: 'Active',
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Batch statistics retrieved successfully',
        data: {
            batch: {
                title: batch.title,
                batchNumber: batch.batchNumber,
                course: batch.courseId,
            },
            enrollments: {
                total: totalEnrollments,
                active: activeEnrollments,
            },
        },
    });
});

export const InstructorController = {
    getProfile,
    updateProfile,
    getDashboard,
    getAssignedBatches,
    getBatchStudents,
    getBatchStatistics,
};
