import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';
import { EnrollmentModel } from './enrollment.model.js';
import { BatchModel } from '../Batch/batch.model.js';
import { ModuleProgressModel } from '../Progress/moduleProgress.model.js';
import { LessonProgressModel } from '../Progress/lessonProgress.model.js';
import { QuizProgressModel } from '../Progress/quizProgress.model.js';
import { ProgressStatus, LessonProgressStatus, EnrollmentStatus } from '../../types/common.js';
import { LessonModel } from '../Lesson/lesson.model.js';
import { ModuleModel } from '../Module/module.model.js';
import { QuizModel } from '../Quiz/quiz.model.js';

const findEnrollmentForCourse = async (
    userId: string,
    courseId: string,
    statuses: EnrollmentStatus[],
    batchId?: string
) => {
    if (batchId) {
        return EnrollmentModel.findOne({
            userId,
            status: { $in: statuses },
            batchId,
        }).lean();
    }

    const batches = await BatchModel.find({ courseId }).select('_id').lean();
    const batchIds = batches.map((b) => b._id);

    if (batchIds.length === 0) {
        return null;
    }

    return EnrollmentModel.findOne({
        userId,
        status: { $in: statuses },
        batchId: { $in: batchIds },
    }).lean();
};

/**
 * Get course progress for a user
 */
const getCourseProgress = async (userId: string, courseId: string, batchId?: string) => {
    const enrollment = await findEnrollmentForCourse(userId, courseId, [
        EnrollmentStatus.Active,
        EnrollmentStatus.Completed,
    ], batchId);

    if (!enrollment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'No enrollment found for this course');
    }

    // Get module progress
    const moduleProgress = await ModuleProgressModel.find({
        enrollmentId: enrollment._id,
    }).populate('moduleId', 'title orderIndex').lean();

    // Get lesson progress
    const lessonProgress = await LessonProgressModel.find({
        enrollmentId: enrollment._id,
    }).lean();

    // Get quiz progress
    const quizProgress = await QuizProgressModel.find({
        enrollmentId: enrollment._id,
    }).lean();

    // Calculate overall progress from lesson + quiz completion
    const allCourseModules = await ModuleModel.find({ courseId, batchId: enrollment.batchId }).sort({ orderIndex: 1 }).lean();
    const allModuleIds = allCourseModules.map((m) => m._id);
    const [allLessons, allQuizzes] = await Promise.all([
        LessonModel.find({ moduleId: { $in: allModuleIds } }).lean(),
        QuizModel.find({ moduleId: { $in: allModuleIds }, status: 'published' }).lean(),
    ]);

    const totalItems = allLessons.length + allQuizzes.length;
    const completedLessonsCount = lessonProgress.filter(
        (lp) => lp.status === LessonProgressStatus.Completed
    ).length;
    const completedQuizzesCount = quizProgress.filter(
        (qp) => qp.status === 'completed'
    ).length;
    const completedItemsCount = completedLessonsCount + completedQuizzesCount;

    const overallProgress = totalItems > 0 ? Math.round((completedItemsCount / totalItems) * 100) : 0;

    // Find current lesson (first incomplete lesson or quiz in first incomplete module)
    let currentLesson = null;
    const sortedModules = moduleProgress.sort((a, b) => (a.moduleId as any).orderIndex - (b.moduleId as any).orderIndex);

    for (const modProgress of sortedModules) {
        if (modProgress.status !== ProgressStatus.Completed) {
            const [moduleLessons, moduleQuizzes] = await Promise.all([
                LessonModel.find({ moduleId: modProgress.moduleId }).sort({ orderIndex: 1 }).lean(),
                QuizModel.find({ moduleId: modProgress.moduleId, status: 'published' }).sort({ orderIndex: 1 }).lean(),
            ]);

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

            if (!currentLesson) {
                for (const quiz of moduleQuizzes) {
                    const quizProg = quizProgress.find(qp => qp.quizId.toString() === quiz._id.toString());
                    if (!quizProg || quizProg.status !== 'completed') {
                        currentLesson = {
                            moduleId: modProgress.moduleId,
                            lessonId: quiz._id,
                        };
                        break;
                    }
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
    }).lean();

    const completedLessons = completedLessonsWithModules.map(lesson => ({
        moduleId: lesson.moduleId.toString(),
        lessonId: lesson._id.toString(),
        completedAt: lessonProgress.find(lp => lp.lessonId.toString() === lesson._id.toString())?.completedAt,
    }));

    // Get completed quizzes with module info
    const completedQuizIds = quizProgress
        .filter(qp => qp.status === 'completed')
        .map(qp => qp.quizId);

    const completedQuizzesWithModules = await QuizModel.find({
        _id: { $in: completedQuizIds }
    }).lean();

    const completedQuizzes = completedQuizzesWithModules.map(quiz => ({
        moduleId: quiz.moduleId.toString(),
        quizId: quiz._id.toString(),
        completedAt: quizProgress.find(qp => qp.quizId.toString() === quiz._id.toString())?.completedAt,
    }));

    return {
        percentage: overallProgress,
        completedLessons,
        completedQuizzes,
        currentLesson,
    };
};

/**
 * Complete a lesson for a user
 */
const completeLesson = async (userId: string, courseId: string, moduleId: string, lessonId: string) => {
    const module = await ModuleModel.findById(moduleId).lean();
    const batchId = module?.batchId?.toString();

    const enrollment = await findEnrollmentForCourse(userId, courseId, [
        EnrollmentStatus.Active,
    ], batchId);

    if (!enrollment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'No active enrollment found for this course');
    }

    // Verify lesson exists and belongs to the module
    const lesson = await LessonModel.findById(lessonId).lean();
    if (!lesson || lesson.moduleId.toString() !== moduleId) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Lesson not found or does not belong to the specified module');
    }

    // Check if lesson is already completed
    const existingProgress = await LessonProgressModel.findOne({
        enrollmentId: enrollment._id,
        lessonId,
    }).lean();

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
    const [lessons, quizzes] = await Promise.all([
        LessonModel.find({ moduleId }).lean(),
        QuizModel.find({ moduleId, status: 'published' }).lean(),
    ]);

    const totalItems = lessons.length + quizzes.length;
    if (totalItems === 0) return;

    const [lessonProgress, quizProgress] = await Promise.all([
        LessonProgressModel.find({
            enrollmentId,
            lessonId: { $in: lessons.map((l) => l._id) },
        }).lean(),
        QuizProgressModel.find({
            enrollmentId,
            quizId: { $in: quizzes.map((q) => q._id) },
        }).lean(),
    ]);

    const completedLessons = lessonProgress.filter(
        (p) => p.status === LessonProgressStatus.Completed
    ).length;

    const completedQuizzes = quizProgress.filter(
        (p) => p.status === 'completed'
    ).length;

    const completedItems = completedLessons + completedQuizzes;
    const completionPercentage = Math.round((completedItems / totalItems) * 100);

    // Update module progress
    const existingModuleProgress = await ModuleProgressModel.findOne({
        enrollmentId,
        moduleId,
    }).lean();

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
    const currentModule = await ModuleModel.findById(currentModuleId).lean();

    if (!currentModule) return;

    // Find next module by orderIndex
    const nextModule = await ModuleModel.findOne({
        courseId: currentModule.courseId,
        orderIndex: currentModule.orderIndex + 1,
    }).lean();

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