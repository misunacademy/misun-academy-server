import { StatusCodes } from 'http-status-codes';
import { ModuleModel } from '../Module/module.model.js';
import { LessonModel } from '../Lesson/lesson.model.js';
import { ResourceModel } from '../Resource/resource.model.js';
import { ModuleProgressModel } from '../Progress/moduleProgress.model.js';
import { ProgressService } from '../Progress/progress.service.js';
import { QuizModel } from '../Quiz/quiz.model.js';
import { QuizAttemptModel } from '../Quiz/attempt.model.js';
import { ProgressStatus, AttemptStatus } from '../../types/common.js';
import ApiError from '../../errors/ApiError.js';
import { BatchModel } from '../Batch/batch.model.js';

/**
 * Get all modules for a batch with progress
 */
const getBatchModules = async (batchId: string, enrollmentId: string) => {
    // Get batch and course info
    const batch = await BatchModel.findById(batchId).populate('courseId').lean();

    if (!batch) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');
    }

    // Get all modules for the batch
    const modules = await ModuleModel.find({ courseId: batch.courseId, batchId }).sort({ orderIndex: 1 });

    // Get progress for all modules
    const moduleProgress = await ModuleProgressModel.find({ enrollmentId }).lean();

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
    }).lean();

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
    }).lean();

    if (!moduleProgress || moduleProgress.status === ProgressStatus.Locked) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'This module is locked');
    }

    // Get lesson
    const lesson = await LessonModel.findById(lessonId).lean();

    if (!lesson || lesson.moduleId.toString() !== moduleId) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found in this module');
    }

    // Get resources for this lesson
    const resources = await ResourceModel.find({ lessonId }).sort({ orderIndex: 1 }).lean();

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
    }).lean();

    if (!moduleProgress || moduleProgress.status === ProgressStatus.Locked) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'This module is locked');
    }

    // Get resources
    const resources = await ResourceModel.find({ moduleId }).sort({ orderIndex: 1 }).lean();

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

/**
 * Get quizzes for a module with attempt progress
 */
const getModuleQuizzes = async (enrollmentId: string, moduleId: string) => {
    const moduleProgress = await ModuleProgressModel.findOne({
        enrollmentId,
        moduleId,
    }).lean();

    if (!moduleProgress || moduleProgress.status === ProgressStatus.Locked) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'This module is locked');
    }

    const quizzes = await QuizModel.find({ moduleId, status: 'published' })
        .sort({ orderIndex: 1 })
        .lean();

    const quizzesWithProgress = await Promise.all(
        quizzes.map(async (quiz) => {
            const attempts = await QuizAttemptModel.find({
                quizId: quiz._id,
                enrollmentId: enrollmentId as any,
            })
                .sort({ attemptNumber: -1 })
                .lean();

            const completedAttempts = attempts.filter(a => a.status === AttemptStatus.Completed);
            const bestAttempt = completedAttempts.length > 0
                ? completedAttempts.reduce((best, a) =>
                    a.percentage > best.percentage ? a : best
                )
                : null;

            return {
                ...quiz,
                totalAttempts: completedAttempts.length,
                bestScore: bestAttempt?.percentage || null,
                bestScoreEarned: bestAttempt?.earnedMarks || null,
                bestScoreTotal: bestAttempt?.totalMarks || null,
                lastAttemptAt: attempts[0]?.submittedAt || null,
            };
        })
    );

    return quizzesWithProgress;
};

/**
 * Get unified curriculum (lessons + quizzes) for a module, sorted by orderIndex
 */
const getModuleCurriculum = async (enrollmentId: string, moduleId: string) => {
    const moduleProgress = await ModuleProgressModel.findOne({
        enrollmentId,
        moduleId,
    }).lean();

    if (!moduleProgress || moduleProgress.status === ProgressStatus.Locked) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'This module is locked');
    }

    const [lessons, quizzes] = await Promise.all([
        ProgressService.getModuleProgress(enrollmentId, moduleId),
        QuizModel.find({ moduleId, status: 'published' }).sort({ orderIndex: 1 }).lean(),
    ]);

    const quizzesWithProgress = await Promise.all(
        quizzes.map(async (quiz) => {
            const attempts = await QuizAttemptModel.find({
                quizId: quiz._id,
                enrollmentId: enrollmentId as any,
            })
                .sort({ attemptNumber: -1 })
                .lean();

            const completedAttempts = attempts.filter(a => a.status === AttemptStatus.Completed);
            const bestAttempt = completedAttempts.length > 0
                ? completedAttempts.reduce((best, a) =>
                    a.percentage > best.percentage ? a : best
                )
                : null;

            return {
                type: 'quiz',
                _id: quiz._id,
                title: quiz.title,
                slug: quiz.slug,
                description: quiz.description,
                timeLimit: quiz.timeLimit,
                totalQuestions: quiz.totalQuestions,
                totalMarks: quiz.totalMarks,
                orderIndex: quiz.orderIndex,
                status: quiz.status,
                totalAttempts: completedAttempts.length,
                bestScore: bestAttempt?.percentage || null,
                bestScoreEarned: bestAttempt?.earnedMarks || null,
                bestScoreTotal: bestAttempt?.totalMarks || null,
                lastAttemptAt: attempts[0]?.submittedAt || null,
            };
        })
    );

    const lessonsWithType = lessons.lessons.map((lesson: any) => ({
        type: 'lesson',
        ...lesson,
    }));

    const curriculum = [...lessonsWithType, ...quizzesWithProgress].sort(
        (a, b) => a.orderIndex - b.orderIndex
    );

    return curriculum;
};

export const ContentService = {
    getBatchModules,
    getModuleLessons,
    getLessonDetails,
    getModuleResources,
    updateLessonProgress,
    getBatchProgress,
    getModuleQuizzes,
    getModuleCurriculum,
};
