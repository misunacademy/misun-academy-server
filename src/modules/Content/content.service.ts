import { StatusCodes } from 'http-status-codes';
import { ModuleModel } from '../Module/module.model';
import { LessonModel } from '../Lesson/lesson.model';
import { ResourceModel } from '../Resource/resource.model';
import { ModuleProgressModel } from '../Progress/moduleProgress.model';
import { ProgressService } from '../Progress/progress.service';
import { ProgressStatus } from '../../types/common';
import ApiError from '../../errors/ApiError';
import { BatchModel } from '../Batch/batch.model';

/**
 * Get all modules for a batch with progress
 */
const getBatchModules = async (batchId: string, enrollmentId: string) => {
    // Get batch and course info
    const batch = await BatchModel.findById(batchId).populate('courseId');

    if (!batch) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');
    }

    // Get all modules for the course
    const modules = await ModuleModel.find({ courseId: batch.courseId }).sort({ orderIndex: 1 });

    // Get progress for all modules
    const moduleProgress = await ModuleProgressModel.find({ enrollmentId });

    // Map progress to modules
    const modulesWithProgress = modules.map((module) => {
        const progress = moduleProgress.find(
            (p) => p.moduleId.toString() === module._id.toString()
        );

        return {
            ...module.toObject(),
            progress: progress
                ? {
                    status: progress.status,
                    completionPercentage: progress.completionPercentage,
                    unlockedAt: progress.unlockedAt,
                    completedAt: progress.completedAt,
                }
                : {
                    status: ProgressStatus.Locked,
                    completionPercentage: 0,
                },
        };
    });

    return modulesWithProgress;
};

/**
 * Get lessons for a module with progress
 */
const getModuleLessons = async (enrollmentId: string, moduleId: string) => {
    // Check if module is unlocked
    const moduleProgress = await ModuleProgressModel.findOne({
        enrollmentId,
        moduleId,
    });

    if (!moduleProgress || moduleProgress.status === ProgressStatus.Locked) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'This module is locked');
    }

    // Get module progress with lessons
    return await ProgressService.getModuleProgress(enrollmentId, moduleId);
};

/**
 * Get lesson details with video URL
 */
const getLessonDetails = async (enrollmentId: string, moduleId: string, lessonId: string) => {
    // Check module access
    const moduleProgress = await ModuleProgressModel.findOne({
        enrollmentId,
        moduleId,
    });

    if (!moduleProgress || moduleProgress.status === ProgressStatus.Locked) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'This module is locked');
    }

    // Get lesson
    const lesson = await LessonModel.findById(lessonId).lean();

    if (!lesson || lesson.moduleId.toString() !== moduleId) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found in this module');
    }

    // Get resources for this lesson
    const resources = await ResourceModel.find({ lessonId }).sort({ orderIndex: 1 });

    return {
        lesson,
        resources,
    };
};

/**
 * Get module resources
 */
const getModuleResources = async (enrollmentId: string, moduleId: string) => {
    // Check module access
    const moduleProgress = await ModuleProgressModel.findOne({
        enrollmentId,
        moduleId,
    });

    if (!moduleProgress || moduleProgress.status === ProgressStatus.Locked) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'This module is locked');
    }

    // Get resources
    const resources = await ResourceModel.find({ moduleId }).sort({ orderIndex: 1 });

    return resources;
};

/**
 * Update lesson progress
 */
const updateLessonProgress = async (
    enrollmentId: string,
    lessonId: string,
    watchTime: number,
    lastWatchedPosition: number
) => {
    return await ProgressService.updateLessonProgress(
        enrollmentId,
        lessonId,
        watchTime,
        lastWatchedPosition
    );
};

/**
 * Get batch overall progress
 */
const getBatchProgress = async (enrollmentId: string) => {
    return await ProgressService.getBatchProgress(enrollmentId);
};

export const ContentService = {
    getBatchModules,
    getModuleLessons,
    getLessonDetails,
    getModuleResources,
    updateLessonProgress,
    getBatchProgress,
};
