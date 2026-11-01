import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
    createUser,
    createAdmin,
    createCourse,
    createBatch,
    createActiveEnrollment,
    createModule,
} from '../helpers/factories.js';
import { LessonModel } from '../../modules/Lesson/lesson.model.js';
import { QuizModel } from '../../modules/Quiz/quiz.model.js';
import { ModuleProgressModel } from '../../modules/Progress/moduleProgress.model.js';
import { LessonProgressModel } from '../../modules/Progress/lessonProgress.model.js';
import { ProgressService } from '../../modules/Progress/progress.service.js';
import { initializeModuleProgress } from '../../modules/Enrollment/enrollmentProgress.service.js';
import { ProgressStatus, LessonType, LessonProgressStatus } from '../../types/common.js';

const buildLesson = (moduleId: mongoose.Types.ObjectId, orderIndex: number, videoDuration = 100) =>
    LessonModel.create({
        moduleId,
        title: `Lesson ${orderIndex}`,
        type: LessonType.Video,
        orderIndex,
        videoSource: 'youtube',
        videoId: `vid-${orderIndex}-${Date.now()}`,
        videoDuration,
    });

const buildQuiz = (
    moduleId: mongoose.Types.ObjectId,
    adminId: mongoose.Types.ObjectId,
    orderIndex: number,
    status: 'published' | 'draft' = 'published'
) =>
    QuizModel.create({
        moduleId,
        title: `Quiz ${orderIndex}`,
        slug: `quiz-${orderIndex}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passingPercentage: 50,
        totalMarks: 2,
        totalQuestions: 2,
        orderIndex,
        status,
        createdBy: adminId,
    });

const seedCourse = async (moduleCount = 1) => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id);
    const batch = await createBatch(course._id);
    const modules = [];
    for (let i = 0; i < moduleCount; i++) {
        modules.push(await createModule(course._id, batch._id, i));
    }
    const enrollment = await createActiveEnrollment(user._id, batch._id);
    await initializeModuleProgress(enrollment._id.toString());
    return { user, admin, course, batch, modules, enrollment };
};

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

describe('ProgressService.recalculateModuleProgress', () => {
    it('marks a module Completed at 100% when its only lesson is done', async () => {
        const { modules, enrollment } = await seedCourse(1);
        const lesson = await buildLesson(modules[0]._id, 0);

        await ProgressService.updateLessonProgress(enrollment._id.toString(), lesson._id.toString(), 100, 100);

        const progress = await ModuleProgressModel.findOne({ enrollmentId: enrollment._id, moduleId: modules[0]._id }).lean();
        expect(progress?.status).toBe(ProgressStatus.Completed);
        expect(progress?.completionPercentage).toBe(100);
    });

    it('marks a module InProgress at 50% with one of two lessons done', async () => {
        const { modules, enrollment } = await seedCourse(1);
        await buildLesson(modules[0]._id, 0);
        await buildLesson(modules[0]._id, 1);
        const lessons = await LessonModel.find({ moduleId: modules[0]._id }).sort({ orderIndex: 1 }).lean();

        await ProgressService.updateLessonProgress(enrollment._id.toString(), lessons[0]._id.toString(), 100, 100);

        const progress = await ModuleProgressModel.findOne({ enrollmentId: enrollment._id, moduleId: modules[0]._id }).lean();
        expect(progress?.status).toBe(ProgressStatus.InProgress);
        expect(progress?.completionPercentage).toBe(50);
    });

    it('ignores draft quizzes when computing totals', async () => {
        const { admin, modules, enrollment } = await seedCourse(1);
        const lesson = await buildLesson(modules[0]._id, 0);
        await buildQuiz(modules[0]._id, admin._id, 0, 'draft');

        await ProgressService.updateLessonProgress(enrollment._id.toString(), lesson._id.toString(), 100, 100);

        const progress = await ModuleProgressModel.findOne({ enrollmentId: enrollment._id, moduleId: modules[0]._id }).lean();
        expect(progress?.completionPercentage).toBe(100);
        expect(progress?.status).toBe(ProgressStatus.Completed);
    });

    it('unlocks the next module in the same batch after completion', async () => {
        const { modules, enrollment } = await seedCourse(2);
        const lesson = await buildLesson(modules[0]._id, 0);

        const lockedBefore = await ModuleProgressModel.findOne({
            enrollmentId: enrollment._id,
            moduleId: modules[1]._id,
        }).lean();
        expect(lockedBefore?.status).toBe(ProgressStatus.Locked);

        await ProgressService.updateLessonProgress(enrollment._id.toString(), lesson._id.toString(), 100, 100);

        const unlockedAfter = await ModuleProgressModel.findOne({
            enrollmentId: enrollment._id,
            moduleId: modules[1]._id,
        }).lean();
        expect(unlockedAfter?.status).toBe(ProgressStatus.Unlocked);
    });
});

describe('ProgressService.updateLessonProgress — 90% watch rule', () => {
    it('stays InProgress below 90% and completes at 90%', async () => {
        const { modules, enrollment } = await seedCourse(1);
        const lesson = await buildLesson(modules[0]._id, 0, 100);
        const enrollmentId = enrollment._id.toString();
        const lessonId = lesson._id.toString();

        await ProgressService.updateLessonProgress(enrollmentId, lessonId, 89, 89);
        let lp = await LessonProgressModel.findOne({ enrollmentId: enrollment._id, lessonId: lesson._id }).lean();
        expect(lp?.status).toBe(LessonProgressStatus.InProgress);

        await ProgressService.updateLessonProgress(enrollmentId, lessonId, 90, 90);
        lp = await LessonProgressModel.findOne({ enrollmentId: enrollment._id, lessonId: lesson._id }).lean();
        expect(lp?.status).toBe(LessonProgressStatus.Completed);
        expect(lp?.completedAt).toBeDefined();
    });

    it('keeps the maximum watch time across updates', async () => {
        const { modules, enrollment } = await seedCourse(1);
        const lesson = await buildLesson(modules[0]._id, 0, 200);

        await ProgressService.updateLessonProgress(enrollment._id.toString(), lesson._id.toString(), 50, 50);
        await ProgressService.updateLessonProgress(enrollment._id.toString(), lesson._id.toString(), 30, 10);

        const lp = await LessonProgressModel.findOne({ enrollmentId: enrollment._id, lessonId: lesson._id }).lean();
        expect(lp?.watchTime).toBe(50);
    });
});

describe('ProgressService.getModuleProgress', () => {
    it('maps per-lesson completion flags', async () => {
        const { modules, enrollment } = await seedCourse(1);
        await buildLesson(modules[0]._id, 0);
        await buildLesson(modules[0]._id, 1);
        const lessons = await LessonModel.find({ moduleId: modules[0]._id }).sort({ orderIndex: 1 }).lean();

        await ProgressService.updateLessonProgress(enrollment._id.toString(), lessons[0]._id.toString(), 100, 100);

        const result = await ProgressService.getModuleProgress(enrollment._id.toString(), modules[0]._id.toString());
        expect(result.lessons).toHaveLength(2);
        expect(result.lessons[0].progress.completed).toBe(true);
        expect(result.lessons[1].progress.completed).toBe(false);
    });
});
