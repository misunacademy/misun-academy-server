import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';
import { EnrollmentModel } from './enrollment.model.js';
import { BatchModel } from '../Batch/batch.model.js';
import { ModuleProgressModel } from '../Progress/moduleProgress.model.js';
import { LessonProgressModel } from '../Progress/lessonProgress.model.js';
import { ProgressStatus, LessonProgressStatus, EnrollmentStatus } from '../../types/common.js';
import { LessonModel } from '../Lesson/lesson.model.js';
import { ModuleModel } from '../Module/module.model.js';

const findEnrollmentForCourse = async (
    userId: string,
    courseId: string,
    statuses: EnrollmentStatus[]
) => {
    const batches = await BatchModel.find({ courseId }).select('_id');
    const batchIds = batches.map((b) => b._id);

    if (batchIds.length === 0) {
        return null;
    }

    return EnrollmentModel.findOne({
        userId,
        status: { $in: statuses },
        batchId: { $in: batchIds },
    });
};

/**
 * Get course progress for a user
 */
const getCourseProgress = async (userId: string, courseId: string) => {
    const enrollment = await findEnrollmentForCourse(userId, courseId, [
        EnrollmentStatus.Active,
        EnrollmentStatus.Completed,
    ]);

    if (!enrollment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'No enrollment found for this course');
    }

    // Get module progress
    const moduleProgress = await ModuleProgressModel.find({
        enrollmentId: enrollment._id,
    }).populate('moduleId', 'title orderIndex');

    // Get lesson progress
    const lessonProgress = await LessonProgressModel.find({
        enrollmentId: enrollment._id,
    });

    // Calculate overall progress from lesson completion (to match course-detail percentage approach)
    const allCourseModules = await ModuleModel.find({ courseId }).sort({ orderIndex: 1 });
    const allModuleIds = allCourseModules.map((m) => m._id);
    const allLessons = await LessonModel.find({ moduleId: { $in: allModuleIds } });

    const totalLessons = allLessons.length;
    const completedLessonsCount = lessonProgress.filter(
        (lp) => lp.status === LessonProgressStatus.Completed
    ).length;

    const overallProgress = totalLessons > 0 ? Math.round((completedLessonsCount / totalLessons) * 100) : 0;

    // Find current lesson (first incomplete lesson in first incomplete module)
    let currentLesson = null;
    const sortedModules = moduleProgress.sort((a, b) => (a.moduleId as any).orderIndex - (b.moduleId as any).orderIndex);

    for (const modProgress of sortedModules) {
        if (modProgress.status !== ProgressStatus.Completed) {
            // Find first incomplete lesson in this module
            const moduleLessons = await LessonModel.find({ moduleId: modProgress.moduleId }).sort({ orderIndex: 1 });
            for (const lesson of moduleLessons) {
                const lessonProg = lessonProgress.find(lp => lp.lessonId.toString() === lesson._id.toString());
                if (!lessonProg || lessonProg.status !== LessonProgressStatus.Completed) {
                    currentLesson = {
                        moduleId: modProgress.moduleId,
                        lessonId: lesson._id,
                    };
                    break;
                }
            }
            if (currentLesson) break;
        }
    }

    // Get completed lessons with module info
    const completedLessonIds = lessonProgress
        .filter(lp => lp.status === LessonProgressStatus.Completed)
        .map(lp => lp.lessonId);

    const completedLessonsWithModules = await LessonModel.find({
        _id: { $in: completedLessonIds }
    });

    const completedLessons = completedLessonsWithModules.map(lesson => ({
        moduleId: lesson.moduleId.toString(),
        lessonId: lesson._id.toString(),
        completedAt: lessonProgress.find(lp => lp.lessonId.toString() === lesson._id.toString())?.completedAt,
    }));

    return {
        percentage: overallProgress,
        completedLessons,
        currentLesson,
    };
};

/**
 * Complete a lesson for a user
 */
const completeLesson = async (userId: string, courseId: string, moduleId: string, lessonId: string) => {
    const enrollment = await findEnrollmentForCourse(userId, courseId, [
        EnrollmentStatus.Active,
    ]);

    if (!enrollment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'No active enrollment found for this course');
    }

    // Verify lesson exists and belongs to the module
    const lesson = await LessonModel.findById(lessonId);
    if (!lesson || lesson.moduleId.toString() !== moduleId) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found or does not belong to the specified module');
    }

    // Check if lesson is already completed
    const existingProgress = await LessonProgressModel.findOne({
        enrollmentId: enrollment._id,
        lessonId,
    });

    if (existingProgress && existingProgress.status === LessonProgressStatus.Completed) {
        // Already completed, return success
        return {
            lessonId,
            moduleId,
            completedAt: existingProgress.completedAt,
        };
    }

    // Mark lesson as completed
    const lessonProgress = await LessonProgressModel.findOneAndUpdate(
        {
            enrollmentId: enrollment._id,
            lessonId,
        },
        {
            status: LessonProgressStatus.Completed,
            completedAt: new Date(),
            watchTime: lesson.videoDuration || 0, // Assume full watch time for manual completion
            lastWatchedPosition: lesson.videoDuration || 0,
        },
        { upsert: true, new: true }
    );

    // Recalculate module progress
    await recalculateModuleProgress(enrollment._id.toString(), moduleId);

    return {
        lessonId,
        moduleId,
        completedAt: lessonProgress.completedAt,
    };
};

/**
 * Recalculate module progress based on lesson completions
 */
const recalculateModuleProgress = async (enrollmentId: string, moduleId: string) => {
    // Get all lessons in the module
    const lessons = await LessonModel.find({ moduleId });
    const totalLessons = lessons.length;

    if (totalLessons === 0) return;

    // Get lesson progress
    const lessonProgress = await LessonProgressModel.find({
        enrollmentId,
        lessonId: { $in: lessons.map((l) => l._id) },
    });

    const completedLessons = lessonProgress.filter(
        (p) => p.status === LessonProgressStatus.Completed
    ).length;

    const completionPercentage = Math.round((completedLessons / totalLessons) * 100);

    // Update module progress
    let existingModuleProgress = await ModuleProgressModel.findOne({
        enrollmentId,
        moduleId,
    });

    const updateData: any = {
        completionPercentage,
        status: completionPercentage === 100
            ? ProgressStatus.Completed
            : completionPercentage > 0
                ? ProgressStatus.InProgress
                : ProgressStatus.Unlocked,
        completedAt: completionPercentage === 100 ? new Date() : undefined,
    };

    if (completionPercentage > 0 && !existingModuleProgress?.startedAt) {
        updateData.startedAt = new Date();
    }

    const moduleProgress = await ModuleProgressModel.findOneAndUpdate(
        {
            enrollmentId,
            moduleId,
        },
        updateData,
        { upsert: true, new: true }
    );

    // Check if next module should be unlocked
    if (completionPercentage === 100) {
        await unlockNextModule(enrollmentId, moduleId);
    }

    return moduleProgress;
};

/**
 * Unlock next module after current module completion
 */
const unlockNextModule = async (enrollmentId: string, currentModuleId: string) => {
    const currentModule = await ModuleModel.findById(currentModuleId);

    if (!currentModule) return;

    // Find next module by orderIndex
    const nextModule = await ModuleModel.findOne({
        courseId: currentModule.courseId,
        orderIndex: currentModule.orderIndex + 1,
    });

    if (!nextModule) return; // No next module

    // Check if next module is locked
    const nextModuleProgress = await ModuleProgressModel.findOne({
        enrollmentId,
        moduleId: nextModule._id,
    });

    if (nextModuleProgress && nextModuleProgress.status === ProgressStatus.Locked) {
        nextModuleProgress.status = ProgressStatus.Unlocked;
        nextModuleProgress.unlockedAt = new Date();
        await nextModuleProgress.save();
    }
};

export const CourseEnrollmentService = {
    getCourseProgress,
    completeLesson,
};