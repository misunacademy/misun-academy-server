import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';
import { LessonProgressModel } from './lessonProgress.model.js';
import { ModuleProgressModel } from './moduleProgress.model.js';
import { LessonModel } from '../Lesson/lesson.model.js';
import { ModuleModel } from '../Module/module.model.js';
import { ProgressStatus, LessonProgressStatus } from '../../types/common.js';

/**
 * Update lesson progress (watch time tracking)
 */
const updateLessonProgress = async (
    enrollmentId: string,
    lessonId: string,
    watchTime: number,
    lastWatchedPosition: number
) => {
    const lesson = await LessonModel.findById(lessonId);

    if (!lesson) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found');
    }

    // Find or create lesson progress
    let progress = await LessonProgressModel.findOne({
        enrollmentId,
        lessonId,
    });

    if (!progress) {
        progress = new LessonProgressModel({
            enrollmentId,
            lessonId,
            status: LessonProgressStatus.InProgress,
            watchTime: 0,
            lastWatchedPosition: 0,
        });
    }

    // Update watch time and position
    progress.watchTime = Math.max(progress.watchTime || 0, watchTime);
    progress.lastWatchedPosition = lastWatchedPosition;

    // Mark as completed if watched >= 90% of video duration
    if (lesson.videoDuration && watchTime >= lesson.videoDuration * 0.9) {
        progress.status = LessonProgressStatus.Completed;
        progress.completedAt = new Date();
    } else {
        progress.status = LessonProgressStatus.InProgress;
    }

    await progress.save();

    // Recalculate module progress
    await recalculateModuleProgress(enrollmentId, lesson.moduleId.toString());

    return progress;
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
    const moduleProgress = await ModuleProgressModel.findOne({
        enrollmentId,
        moduleId,
    });

    if (moduleProgress) {
        moduleProgress.completionPercentage = completionPercentage;

        // Update status
        if (completionPercentage === 100) {
            moduleProgress.status = ProgressStatus.Completed;
            moduleProgress.completedAt = new Date();
        } else if (completionPercentage > 0) {
            moduleProgress.status = ProgressStatus.InProgress;
            if (!moduleProgress.startedAt) {
                moduleProgress.startedAt = new Date();
            }
        }

        await moduleProgress.save();

        // Check if next module should be unlocked (sequential unlocking)
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

/**
 * Get batch progress for an enrollment
 */
const getBatchProgress = async (enrollmentId: string) => {
    const moduleProgress = await ModuleProgressModel.find({ enrollmentId }).populate(
        'moduleId',
        'title orderIndex'
    );

    const lessonProgress = await LessonProgressModel.find({ enrollmentId });

    const allCourseModuleIds = moduleProgress.map((m) => m.moduleId.toString());
    const totalModules = allCourseModuleIds.length;
    const completedModules = moduleProgress.filter(
        (p) => p.status === ProgressStatus.Completed
    ).length;

    const totalLessons = lessonProgress.length;
    const completedLessons = lessonProgress.filter(
        (p) => p.status === LessonProgressStatus.Completed
    ).length;

    // When the module progress collection is missing entries for some modules, they are treated as 0%.
    const overallProgress =
        totalModules > 0
            ? Math.round(
                  (moduleProgress.reduce((sum, m) => sum + m.completionPercentage, 0) /
                      totalModules)
              )
            : 0;

    return {
        overallProgress,
        totalModules,
        completedModules,
        totalLessons,
        completedLessons,
        modules: moduleProgress,
    };
};

/**
 * Get module progress with lessons
 */
const getModuleProgress = async (enrollmentId: string, moduleId: string) => {
    const moduleProgress = await ModuleProgressModel.findOne({
        enrollmentId,
        moduleId,
    });

    if (!moduleProgress) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Module progress not found');
    }

    // Get all lessons in the module
    const lessons = await LessonModel.find({ moduleId }).sort({ orderIndex: 1 });

    // Get lesson progress
    const lessonProgress = await LessonProgressModel.find({
        enrollmentId,
        lessonId: { $in: lessons.map((l) => l._id) },
    });

    // Map progress to lessons
    const lessonsWithProgress = lessons.map((lesson) => {
        const progress = lessonProgress.find(
            (p) => p.lessonId.toString() === lesson._id.toString()
        );

        return {
            ...lesson.toObject(),
            progress: progress
                ? {
                      status: progress.status,
                      watchTime: progress.watchTime,
                      lastWatchedPosition: progress.lastWatchedPosition,
                      completed: progress.status === LessonProgressStatus.Completed,
                  }
                : {
                      status: LessonProgressStatus.NotStarted,
                      watchTime: 0,
                      completed: false,
                  },
        };
    });

    return {
        module: moduleProgress,
        lessons: lessonsWithProgress,
    };
};

export const ProgressService = {
    updateLessonProgress,
    recalculateModuleProgress,
    getBatchProgress,
    getModuleProgress,
    unlockNextModule,
};
