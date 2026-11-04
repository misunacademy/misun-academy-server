import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';
import { ProgressService } from '../Progress/progress.service.js';
import { EnrollmentModel } from './enrollment.model.js';
import { BatchModel } from '../Batch/batch.model.js';
import { ModuleProgressModel } from '../Progress/moduleProgress.model.js';
import { LessonProgressModel } from '../Progress/lessonProgress.model.js';
import { QuizProgressModel } from '../Progress/quizProgress.model.js';
import { ProgressStatus, LessonProgressStatus, EnrollmentStatus } from '../../types/common.js';
import { LessonModel } from '../Lesson/lesson.model.js';
import { ModuleModel } from '../Module/module.model.js';
import { QuizModel } from '../Quiz/quiz.model.js';
import mongoose from 'mongoose';
import { CourseModel } from '../Course/course.model.js';

// Minimum watch ratio required to mark a lesson complete (server-enforced,
// not client-trusted). A lesson is only "completed" when the learner has
// watched at least 90% of its duration via heartbeat events.
/**
 * Classroom URLs carry course slugs, not ObjectIds (see
 * courseEnrollment.validation.ts). Resolve either form to the canonical
 * course _id string, or 404. Without this, slug callers always 400 on the
 * module→course bind check below and progress can never advance.
 */
const resolveCourseId = async (courseIdOrSlug: string): Promise<string> => {
    if (mongoose.Types.ObjectId.isValid(courseIdOrSlug)) {
        return courseIdOrSlug;
    }
    const course = await CourseModel.findOne({ slug: courseIdOrSlug }).select('_id').lean();
    if (!course) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Course not found');
    }
    return (course._id as mongoose.Types.ObjectId).toString();
};

const findEnrollmentForCourse = async (
    userId: string,
    courseId: string,
    statuses: EnrollmentStatus[],
    batchId?: string
) => {
    const resolvedCourseId = await resolveCourseId(courseId);
    if (batchId) {
        return EnrollmentModel.findOne({
            userId,
            status: { $in: statuses },
            batchId,
        }).lean();
    }

    const batches = await BatchModel.find({ courseId: resolvedCourseId }).select('_id').lean();
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
 * Ensure a ModuleProgress row exists for every module of the enrollment's batch.
 * Modules added after enrollment are backfilled: unlocked when every previous
 * module is completed, locked otherwise.
 */
const ensureModuleProgress = async (enrollmentId: string, courseId: string, batchId?: string) => {
    const modules = await ModuleModel.find({ courseId, ...(batchId ? { batchId } : {}) })
        .sort({ orderIndex: 1 })
        .lean();

    if (modules.length === 0) return;

    const existing = await ModuleProgressModel.find({ enrollmentId }).lean();
    const byModuleId = new Map(existing.map((row) => [row.moduleId.toString(), row]));

    let allPreviousCompleted = true;

    for (const mod of modules) {
        const key = mod._id.toString();
        let row = byModuleId.get(key);

        if (!row) {
            const created = await ModuleProgressModel.create({
                enrollmentId,
                moduleId: mod._id,
                status: allPreviousCompleted ? ProgressStatus.Unlocked : ProgressStatus.Locked,
                ...(allPreviousCompleted ? { unlockedAt: new Date() } : {}),
                completionPercentage: 0,
            });
            row = created.toObject();
            byModuleId.set(key, row);
        } else if ((row.status as ProgressStatus) === ProgressStatus.Locked && allPreviousCompleted) {
            // Self-heal: every previous module is completed but this one stayed
            // locked (e.g. the unlock step previously missed its batch scope).
            await ModuleProgressModel.updateOne(
                { _id: row._id },
                { $set: { status: ProgressStatus.Unlocked, unlockedAt: new Date() } }
            );
            row = { ...row, status: ProgressStatus.Unlocked, unlockedAt: new Date() };
            byModuleId.set(key, row);
        }

        const current = byModuleId.get(key)!;
        if (current.status !== ProgressStatus.Completed) {
            allPreviousCompleted = false;
        }
    }
};

/**
 * Get course progress for a user
 */
const getCourseProgress = async (userId: string, courseId: string, batchId?: string) => {
    const resolvedCourseId = await resolveCourseId(courseId);
    const enrollment = await findEnrollmentForCourse(userId, resolvedCourseId, [
        EnrollmentStatus.Active,
        EnrollmentStatus.Completed,
    ], batchId);

    if (!enrollment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'No enrollment found for this course');
    }

    await ensureModuleProgress(enrollment._id.toString(), resolvedCourseId, batchId ?? enrollment.batchId?.toString());

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

    // Calculate overall progress from lesson + quiz completion. Only PASSED
    // quizzes count — a failed submit must not inflate the percentage.
    const allCourseModules = await ModuleModel.find({ courseId: resolvedCourseId, batchId: enrollment.batchId }).sort({ orderIndex: 1 }).lean();
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
        (qp) => qp.status === 'completed' && (qp as any).passed === true
    ).length;
    const completedItemsCount = completedLessonsCount + completedQuizzesCount;

    const overallProgress = totalItems > 0 ? Math.round((completedItemsCount / totalItems) * 100) : 0;

    // Find current lesson (first incomplete lesson or quiz in first incomplete module)
    let currentLesson = null;
    // Skip orphaned rows whose module was deleted; null-safe ordering
    const sortedModules = moduleProgress
        .filter((row) => row.moduleId && (row.moduleId as any)._id !== undefined)
        .sort((a, b) => ((a.moduleId as any)?.orderIndex ?? 0) - ((b.moduleId as any)?.orderIndex ?? 0));

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

    // Get completed quizzes with module info. Only PASSED attempts count —
    // otherwise the UI (curriculum-locks) unlocks content the server still
    // treats as locked, stranding users on 403s.
    const completedQuizIds = quizProgress
        .filter(qp => qp.status === 'completed' && (qp as any).passed === true)
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
    const resolvedCourseId = await resolveCourseId(courseId);
    const module = await ModuleModel.findById(moduleId).lean();
    if (!module) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');
    }
    if (module.courseId.toString() !== resolvedCourseId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Module does not belong to this course');
    }
    if (!module.batchId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Module is not assigned to a batch');
    }
    const batchId = module.batchId.toString();

    const enrollment = await findEnrollmentForCourse(userId, resolvedCourseId, [
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

    // Backfill progress rows for modules added after enrollment, then re-check
    await ensureModuleProgress(enrollment._id.toString(), resolvedCourseId, enrollment.batchId?.toString());

    const moduleProgress = await ModuleProgressModel.findOne({
        enrollmentId: enrollment._id,
        moduleId,
    }).lean();

    if (!moduleProgress || moduleProgress.status === ProgressStatus.Locked) {
        throw new ApiError(
            StatusCodes.FORBIDDEN,
            'This module is locked. Complete previous modules before attempting its lessons.'
        );
    }

    // Check if lesson is already completed
    const existingProgress = await LessonProgressModel.findOne({
        enrollmentId: enrollment._id,
        lessonId,
    }).lean();

    if (existingProgress && existingProgress.status === LessonProgressStatus.Completed) {
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
        },
        { upsert: true, new: true }
    );

    // Recalculate module progress
    await ProgressService.recalculateModuleProgress(enrollment._id.toString(), moduleId);

    return {
        lessonId,
        moduleId,
        completedAt: lessonProgress.completedAt,
    };
};



export const CourseEnrollmentService = {
    getCourseProgress,
    completeLesson,
};