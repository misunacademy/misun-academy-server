import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
    createUser,
    createAdmin,
    createCourse,
    createBatch,
    createModule,
    createEnrollment,
} from '../helpers/factories.js';
import { QuizModel } from '../../modules/Quiz/quiz.model.js';
import { QuestionModel } from '../../modules/Quiz/question.model.js';
import { QuizAttemptModel } from '../../modules/Quiz/attempt.model.js';
import { NotificationModel } from '../../modules/Notification/notification.model.js';
import { QuizService } from '../../modules/Quiz/quiz.service.js';
import { EnrollmentStatus, AttemptStatus } from '../../types/common.js';

const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

const seedModule = async () => {
    const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
    const course = await createCourse(admin._id, { title: `Course ${uid()}`, slug: `course-${uid()}` });
    const batch = await createBatch(course._id);
    const mod = await createModule(course._id, batch._id, 1);
    return { admin, course, batch, mod };
};

const quizPayload = (overrides: Record<string, unknown> = {}) => ({
    title: `Quiz ${uid()}`,
    description: 'desc',
    instructions: 'answer all',
    passingPercentage: 50,
    ...overrides,
});

const addQuestion = (quizId: string, marks = 2, orderIndex = 0) =>
    QuestionModel.create({
        quizId,
        questionType: 'mcq',
        content: { type: 'text', text: 'Q?' },
        options: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
        ],
        correctAnswer: 'a',
        marks,
        orderIndex,
    });

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

describe('QuizService.createQuiz', () => {
    it('creates a quiz with generated slug, zero totals and auto orderIndex', async () => {
        const { admin, mod } = await seedModule();
        const quiz: any = await QuizService.createQuiz(
            mod._id.toString(),
            quizPayload({ title: 'My First Quiz' }),
            admin._id.toString()
        );
        expect(quiz.slug).toBe('my-first-quiz');
        expect(quiz.totalMarks).toBe(0);
        expect(quiz.totalQuestions).toBe(0);
        expect(quiz.orderIndex).toBe(0);
        expect(quiz.status).toBe('draft');
    });

    it('auto-increments orderIndex and generates unique slugs for duplicate titles', async () => {
        const { admin, mod } = await seedModule();
        const q1: any = await QuizService.createQuiz(
            mod._id.toString(),
            quizPayload({ title: 'Same Title' }),
            admin._id.toString()
        );
        const q2: any = await QuizService.createQuiz(
            mod._id.toString(),
            quizPayload({ title: 'Same Title' }),
            admin._id.toString()
        );
        expect(q2.orderIndex).toBe(q1.orderIndex + 1);
        expect(q2.slug).not.toBe(q1.slug);
        expect(q2.slug).toBe(`${q1.slug}-1`);
    });

    it('rejects a duplicate explicit orderIndex in the same module', async () => {
        const { admin, mod } = await seedModule();
        await QuizService.createQuiz(mod._id.toString(), quizPayload({ orderIndex: 2 }), admin._id.toString());
        await expect(
            QuizService.createQuiz(mod._id.toString(), quizPayload({ orderIndex: 2 }), admin._id.toString())
        ).rejects.toThrow(/order index already exists/i);
    });

    it('throws NOT_FOUND for an unknown module', async () => {
        const { admin } = await seedModule();
        const user = await createUser({ email: `u-${uid()}@example.com` });
        await expect(
            QuizService.createQuiz(user._id.toString(), quizPayload(), admin._id.toString())
        ).rejects.toThrow(/module not found/i);
    });
});

describe('QuizService reads', () => {
    it('getModuleQuizzes returns quizzes sorted by orderIndex', async () => {
        const { admin, mod } = await seedModule();
        await QuizService.createQuiz(mod._id.toString(), quizPayload({ orderIndex: 2 }), admin._id.toString());
        await QuizService.createQuiz(mod._id.toString(), quizPayload({ orderIndex: 0 }), admin._id.toString());
        const list = await QuizService.getModuleQuizzes(mod._id.toString());
        expect(list.map((q) => q.orderIndex)).toEqual([0, 2]);
    });

    it('getQuizById returns the quiz and throws for unknown id', async () => {
        const { admin, mod } = await seedModule();
        const quiz: any = await QuizService.createQuiz(mod._id.toString(), quizPayload(), admin._id.toString());
        const found = await QuizService.getQuizById(quiz._id.toString());
        expect((found as any).title).toBe(quiz.title);

        const user = await createUser({ email: `u-${uid()}@example.com` });
        await expect(QuizService.getQuizById(user._id.toString())).rejects.toThrow(/quiz not found/i);
    });

    it('getQuizBySlug populates the module and throws for unknown slug', async () => {
        const { admin, mod } = await seedModule();
        const quiz: any = await QuizService.createQuiz(mod._id.toString(), quizPayload(), admin._id.toString());
        const found: any = await QuizService.getQuizBySlug(quiz.slug);
        expect(found.title).toBe(quiz.title);
        expect(found.moduleId.title).toBe(mod.title);

        await expect(QuizService.getQuizBySlug('no-such-slug')).rejects.toThrow(/quiz not found/i);
    });
});

describe('QuizService.updateQuiz', () => {
    it('regenerates the slug when the title changes', async () => {
        const { admin, mod } = await seedModule();
        const quiz: any = await QuizService.createQuiz(
            mod._id.toString(),
            quizPayload({ title: 'Old Name Here' }),
            admin._id.toString()
        );
        const updated: any = await QuizService.updateQuiz(quiz._id.toString(), { title: 'Brand New Name' });
        expect(updated.slug).toBe('brand-new-name');
        expect(updated.slug).not.toBe(quiz.slug);
    });

    it('keeps the slug when other fields change', async () => {
        const { admin, mod } = await seedModule();
        const quiz: any = await QuizService.createQuiz(mod._id.toString(), quizPayload(), admin._id.toString());
        const updated: any = await QuizService.updateQuiz(quiz._id.toString(), { passingPercentage: 80 });
        expect(updated.slug).toBe(quiz.slug);
        expect(updated.passingPercentage).toBe(80);
    });

    it('rejects orderIndex colliding with a sibling quiz', async () => {
        const { admin, mod } = await seedModule();
        await QuizService.createQuiz(mod._id.toString(), quizPayload({ orderIndex: 0 }), admin._id.toString());
        const q2: any = await QuizService.createQuiz(
            mod._id.toString(),
            quizPayload({ orderIndex: 1 }),
            admin._id.toString()
        );
        await expect(QuizService.updateQuiz(q2._id.toString(), { orderIndex: 0 })).rejects.toThrow(
            /order index already exists/i
        );
    });

    it('throws NOT_FOUND for an unknown quiz', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        await expect(QuizService.updateQuiz(user._id.toString(), { title: 'x' })).rejects.toThrow(
            /quiz not found/i
        );
    });

    it('publishes a draft quiz and notifies enrolled learners', async () => {
        const { admin, mod, batch } = await seedModule();
        const learner = await createUser({ email: `learner-${uid()}@example.com` });
        await createEnrollment(learner._id, batch._id, { status: EnrollmentStatus.Active });
        const quiz: any = await QuizService.createQuiz(mod._id.toString(), quizPayload(), admin._id.toString());
        expect(quiz.status).toBe('draft');

        const updated: any = await QuizService.updateQuiz(quiz._id.toString(), { status: 'published' });
        expect(updated.status).toBe('published');

        // publish notification is fired via setImmediate — allow it to flush
        await new Promise((r) => setTimeout(r, 500));
        const notifs = await NotificationModel.find({ userId: learner._id }).lean();
        expect(notifs.length).toBeGreaterThanOrEqual(1);
        expect(notifs[0].type).toBe('quiz_published');
    });
});

describe('QuizService.deleteQuiz / reorderQuizzes / recalcQuizTotals', () => {
    it('deletes the quiz and its questions', async () => {
        const { admin, mod } = await seedModule();
        const quiz: any = await QuizService.createQuiz(mod._id.toString(), quizPayload(), admin._id.toString());
        await addQuestion(quiz._id.toString(), 2, 0);
        await addQuestion(quiz._id.toString(), 3, 1);

        await QuizService.deleteQuiz(quiz._id.toString());
        expect(await QuizModel.findById(quiz._id).lean()).toBeNull();
        expect(await QuestionModel.countDocuments({ quizId: quiz._id })).toBe(0);
    });

    it('deleteQuiz throws NOT_FOUND for unknown id', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        await expect(QuizService.deleteQuiz(user._id.toString())).rejects.toThrow(/quiz not found/i);
    });

    it('reorders quizzes and returns them sorted', async () => {
        const { admin, mod } = await seedModule();
        const q1: any = await QuizService.createQuiz(
            mod._id.toString(),
            quizPayload({ orderIndex: 0 }),
            admin._id.toString()
        );
        const q2: any = await QuizService.createQuiz(
            mod._id.toString(),
            quizPayload({ orderIndex: 1 }),
            admin._id.toString()
        );
        const reordered = await QuizService.reorderQuizzes(mod._id.toString(), [
            { quizId: q1._id.toString(), orderIndex: 1 },
            { quizId: q2._id.toString(), orderIndex: 0 },
        ]);
        expect(reordered.map((q) => q._id.toString())).toEqual([q2._id.toString(), q1._id.toString()]);
    });

    it('reorderQuizzes rejects a non-array payload', async () => {
        const { mod } = await seedModule();
        await expect(QuizService.reorderQuizzes(mod._id.toString(), 'nope' as any)).rejects.toThrow(
            /quizOrders must be an array/i
        );
    });

    it('recalcQuizTotals sums marks and counts questions', async () => {
        const { admin, mod } = await seedModule();
        const quiz: any = await QuizService.createQuiz(mod._id.toString(), quizPayload(), admin._id.toString());
        await addQuestion(quiz._id.toString(), 2, 0);
        await addQuestion(quiz._id.toString(), 3, 1);
        const totals = await QuizService.recalcQuizTotals(quiz._id.toString());
        expect(totals).toEqual({ totalMarks: 5, totalQuestions: 2 });

        const refreshed = await QuizModel.findById(quiz._id).lean();
        expect(refreshed?.totalMarks).toBe(5);
        expect(refreshed?.totalQuestions).toBe(2);
    });
});

describe('QuizService.getAllQuizzes / getQuizAnalytics', () => {
    const seedQuizWithAttempts = async () => {
        const { admin, mod, course, batch } = await seedModule();
        const learner = await createUser({ email: `learner-${uid()}@example.com` });
        const enrollment = await createEnrollment(learner._id, batch._id, { status: EnrollmentStatus.Active });
        const quiz: any = await QuizService.createQuiz(
            mod._id.toString(),
            quizPayload({ title: 'Searchable Quiz Alpha' }),
            admin._id.toString()
        );
        await addQuestion(quiz._id.toString(), 5, 0);
        await QuizAttemptModel.create({
            quizId: quiz._id,
            userId: learner._id,
            enrollmentId: enrollment._id,
            attemptNumber: 1,
            answers: [],
            totalMarks: 5,
            earnedMarks: 5,
            percentage: 100,
            passed: true,
            correctCount: 1,
            wrongCount: 0,
            unansweredCount: 0,
            zamesEarned: 5,
            startedAt: new Date(),
            submittedAt: new Date(),
            status: AttemptStatus.Completed,
        });
        return { admin, mod, course, quiz, learner };
    };

    it('lists quizzes with pagination meta and attempt stats', async () => {
        const { quiz } = await seedQuizWithAttempts();
        const result = await QuizService.getAllQuizzes({ page: 1, limit: 10 });

        expect(result.meta.total).toBe(1);
        expect(result.meta.page).toBe(1);
        expect(result.data).toHaveLength(1);
        expect(result.data[0]._id.toString()).toBe(quiz._id.toString());
        expect((result.data[0] as any).attemptStats.totalAttempts).toBe(1);
        expect((result.data[0] as any).attemptStats.passRate).toBe(100);
        expect(result.stats.totalAttempts).toBe(1);
        expect(result.stats.totalZamesAwarded).toBe(5);
    });

    it('filters by status and search text', async () => {
        const { admin, mod } = await seedQuizWithAttempts();
        await QuizService.createQuiz(mod._id.toString(), quizPayload({ title: 'Unrelated Draft Beta' }), admin._id.toString());

        const bySearch = await QuizService.getAllQuizzes({ search: 'alpha' });
        expect(bySearch.meta.total).toBe(1);

        const noMatch = await QuizService.getAllQuizzes({ search: 'zzz-no-match' });
        expect(noMatch.meta.total).toBe(0);
        expect(noMatch.data).toHaveLength(0);

        const drafts = await QuizService.getAllQuizzes({ status: 'draft' });
        expect(drafts.meta.total).toBe(2);
        expect(drafts.stats.draftCount).toBe(2);
    });

    it('filters by courseId', async () => {
        const { admin, course } = await seedQuizWithAttempts();
        const otherCourse = await createCourse(admin._id, { title: `Other ${uid()}`, slug: `other-${uid()}` });

        const inCourse = await QuizService.getAllQuizzes({ courseId: course._id.toString() });
        expect(inCourse.meta.total).toBe(1);

        const inOther = await QuizService.getAllQuizzes({ courseId: otherCourse._id.toString() });
        expect(inOther.meta.total).toBe(0);
    });

    it('getQuizAnalytics aggregates attempts and per-question stats', async () => {
        const { quiz } = await seedQuizWithAttempts();
        const analytics = await QuizService.getQuizAnalytics(quiz._id.toString());

        expect(analytics.totalAttempts).toBe(1);
        expect(analytics.averageScore).toBe(100);
        expect(analytics.passRate).toBe(100);
        expect(analytics.perQuestion).toHaveLength(1);
        expect(analytics.perQuestion[0].marks).toBe(5);
    });

    it('getQuizAnalytics returns zeros for a quiz with no attempts', async () => {
        const { admin, mod } = await seedModule();
        const quiz: any = await QuizService.createQuiz(mod._id.toString(), quizPayload(), admin._id.toString());
        await addQuestion(quiz._id.toString(), 2, 0);

        const analytics = await QuizService.getQuizAnalytics(quiz._id.toString());
        expect(analytics.totalAttempts).toBe(0);
        expect(analytics.averageScore).toBe(0);
        expect(analytics.passRate).toBe(0);
        expect(analytics.perQuestion).toHaveLength(1);
        expect(analytics.perQuestion[0].attemptCount).toBe(0);
    });
});
