import { StatusCodes } from 'http-status-codes';
import { InstructorModel } from './instructor.model.js';
import { BatchModel } from '../Batch/batch.model.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import { BatchStatus } from '../../types/common.js';
import ApiError from '../../errors/ApiError.js';
import { ModuleProgressModel } from '../Progress/moduleProgress.model.js';

/**
 * Get instructor profile
 */
const getProfile = async (userId: string) => {
    const instructor = await InstructorModel.findOne({ id: userId });
    if (!instructor) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Instructor profile not found');
    }
    return instructor;
};

/**
 * Update instructor profile
 */
const updateProfile = async (
    userId: string,
    updateData: {
        bio?: string;
        expertise?: string[];
        socialLinks?: any;
        profilePicture?: string;
    }
) => {
    const instructor = await InstructorModel.findOneAndUpdate(
        { id: userId },
        updateData,
        { new: true, runValidators: true }
    );

    if (!instructor) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Instructor profile not found');
    }

    return instructor;
};

/**
 * Get instructor dashboard stats
 */
const getDashboard = async (userId: string) => {
    const instructor = await InstructorModel.findOne({ id: userId }).populate('id', 'name email');
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

    return {
        instructor: {
            name: (instructor.id as any).name,
            rating: instructor.rating,
            totalBatches: instructor.totalBatchesTaught,
            totalStudents: totalStudents,
        },
        batches,
        stats: {
            activeBatches: batches.filter((b) => b.status === BatchStatus.Running).length,
            totalStudents,
        },
    };
};

/**
 * Get assigned batches
 */
const getAssignedBatches = async (userId: string, status?: string) => {
    const instructor = await InstructorModel.findOne({ id: userId });
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

    return batches;
};

/**
 * Get batch students roster
 */
const getBatchStudents = async (userId: string, batchId: string) => {
    // Verify instructor is assigned to this batch
    const instructor = await InstructorModel.findOne({ id: userId });
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
            const moduleProgress = await ModuleProgressModel.find(
                {
                    enrollmentId: enrollment._id,
                }
            );

            const completedModules = moduleProgress.filter(
                (p: any) => p.completionPercentage === 100
            ).length;
            const totalModules = moduleProgress.length;

            return {
                ...enrollment.toObject(),
                progress: {
                    completedModules,
                    totalModules,
                    overallProgress:
                        totalModules > 0 ? (completedModules / totalModules) * 100 : 0,
                },
            };
        })
    );

    return enrollmentsWithProgress;
};

/**
 * Get batch statistics
 */
const getBatchStatistics = async (userId: string, batchId: string) => {
    // Verify instructor is assigned to this batch
    const instructor = await InstructorModel.findOne({ id: userId });
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

    return {
        batch: {
            title: batch.title,
            batchNumber: batch.batchNumber,
            course: batch.courseId,
        },
        enrollments: {
            total: totalEnrollments,
            active: activeEnrollments,
        },
    };
};

export const InstructorService = {
    getProfile,
    updateProfile,
    getDashboard,
    getAssignedBatches,
    getBatchStudents,
    getBatchStatistics,
};
