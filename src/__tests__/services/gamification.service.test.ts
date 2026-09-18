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
import { QuizAttemptModel } from '../../modules/Quiz/attempt.model.js';
import { ZamesTransactionModel } from '../../modules/Quiz/zames.model.js';
import { LeaderboardEntryModel } from '../../modules/Quiz/leaderboard.model.js';
import { GamificationService } from '../../modules/Quiz/gamification.service.js';
import { EnrollmentStatus, AttemptStatus } from '../../types/common.js';

const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

const seedContext = async () => {
    const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
    const course = await createCourse(admin._id, { title: `Course ${uid()}`, slug: `course-${uid()}` });
    const batch = await createBatch(course._id);
    const mod = await createModule(course._id, batch._id, 1);
    const quiz = await QuizModel.create({
        moduleId: mod._id,
        slug: `quiz-${uid()}`,
        orderIndex: 0,
        createdBy: admin._id,
        title: `Quiz ${uid()}`,
        passingPercentage: 50,
        totalMarks: 10,
        totalQuestions: 1,
        status: 'published',
    });
    return { admin, course, batch, mod, quiz };
};

const seedAttempt = async (overrides: Record<string, unknown> = {}) => {
    const { quiz, batch, course } = await seedContext();
    const user = await createUser({ email: `learner-${uid()}@example.com` });
    const enrollment = await createEnrollment(user._id, batch._id, {
        status: EnrollmentStatus.Active,
        enrollmentId: `MA-${uid()}`,
        enrolledAt: new Date(),
    });
    const attempt = await QuizAttemptModel.create({
        quizId: quiz._id,
        userId: user._id,
        enrollmentId: enrollment._id,
        attemptNumber: 1,
        answers: [],
        totalMarks: 10,
        earnedMarks: 8,
        percentage: 80,
        passed: true,
        correctCount: 4,
        wrongCount: 1,
        unansweredCount: 0,
        zamesEarned: 8,
        startedAt: new Date(),
        submittedAt: new Date(),
        status: AttemptStatus.Completed,
        ...overrides,
    } as any);
    return { user, quiz, batch, course, enrollment, attempt };
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

describe('GamificationService.getCurrentBalance', () => {
    it('returns 0 when the user has no transactions', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        expect(await GamificationService.getCurrentBalance(user._id.toString())).toBe(0);
    });
});

describe('GamificationService.awardZames', () => {
    it('awards points, stores course/batch context and updates the leaderboard', async () => {
        const { user, quiz, attempt, batch, enrollment } = await seedAttempt();

        const result: any = await GamificationService.awardZames({
            userId: user._id.toString(),
            quizAttemptId: attempt._id.toString(),
            quizId: quiz._id.toString(),
            points: 10,
        });

        expect(result.pointsEarned).toBe(10);
        expect(result.newBalance).toBe(10);
        expect(result.transaction.balanceBefore).toBe(0);
        expect(result.transaction.balanceAfter).toBe(10);
        expect(result.transaction.batchId.toString()).toBe(batch._id.toString());
        expect(result.transaction.metadata.quizTitle).toBe(quiz.title);
        expect(result.transaction.metadata.attemptNumber).toBe(1);
        expect(enrollment._id).toBeDefined();

        expect(await GamificationService.getCurrentBalance(user._id.toString())).toBe(10);

        const entries = await LeaderboardEntryModel.find({ userId: user._id }).lean();
        expect(entries).toHaveLength(2); // all_time + monthly
        const periods = entries.map((e) => e.period).sort();
        expect(periods).toEqual(['all_time', 'monthly']);
        const allTime = entries.find((e) => e.period === 'all_time');
        expect(allTime?.totalZames).toBe(10);
        expect(allTime?.quizzesCompleted).toBe(1);
    });

    it('accumulates the balance across attempts', async () => {
        const { user, quiz, attempt } = await seedAttempt();
        await GamificationService.awardZames({
            userId: user._id.toString(),
            quizAttemptId: attempt._id.toString(),
            quizId: quiz._id.toString(),
            points: 10,
        });
        const second = await QuizAttemptModel.create({
            quizId: quiz._id,
            userId: user._id,
            enrollmentId: attempt.enrollmentId,
            attemptNumber: 2,
            answers: [],
            totalMarks: 10,
            earnedMarks: 6,
            percentage: 60,
            passed: true,
            correctCount: 3,
            wrongCount: 2,
            unansweredCount: 0,
            zamesEarned: 6,
            startedAt: new Date(),
            submittedAt: new Date(),
            status: AttemptStatus.Completed,
        } as any);
        const result: any = await GamificationService.awardZames({
            userId: user._id.toString(),
            quizAttemptId: second._id.toString(),
            quizId: quiz._id.toString(),
            points: 6,
        });
        expect(result.newBalance).toBe(16);
        expect(result.transaction.balanceBefore).toBe(10);
    });

    it('returns zero earnings without writing a transaction for non-positive points', async () => {
        const { user, quiz, attempt } = await seedAttempt();
        for (const points of [0, -5]) {
            const result: any = await GamificationService.awardZames({
                userId: user._id.toString(),
                quizAttemptId: attempt._id.toString(),
                quizId: quiz._id.toString(),
                points,
            });
            expect(result.pointsEarned).toBe(0);
            expect(result.newBalance).toBe(0);
        }
        expect(await ZamesTransactionModel.countDocuments({ userId: user._id })).toBe(0);
    });

    it('is idempotent for a repeated quizAttemptId (unique transaction)', async () => {
        const { user, quiz, attempt } = await seedAttempt();
        const params = {
            userId: user._id.toString(),
            quizAttemptId: attempt._id.toString(),
            quizId: quiz._id.toString(),
            points: 10,
        };
        await GamificationService.awardZames(params);
        const replay: any = await GamificationService.awardZames(params);

        expect(replay.pointsEarned).toBe(0);
        expect(replay.transaction).toBeNull();
        expect(replay.newBalance).toBe(10);
        expect(await ZamesTransactionModel.countDocuments({ userId: user._id })).toBe(1);
    });
});

describe('GamificationService.getStats', () => {
    it('returns zeros and null rank for a user with no attempts', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        const stats = await GamificationService.getStats(user._id.toString());
        expect(stats).toMatchObject({
            totalZames: 0,
            quizzesCompleted: 0,
            averageScore: 0,
            highestScore: 0,
            totalMarks: 0,
            currentRank: null,
        });
        expect(stats.recentAttempts).toHaveLength(0);
    });

    it('aggregates completed attempts and ignores in-progress ones', async () => {
        const { user, quiz, enrollment } = await seedAttempt();
        await QuizAttemptModel.create({
            quizId: quiz._id,
            userId: user._id,
            enrollmentId: enrollment._id,
            attemptNumber: 2,
            answers: [],
            totalMarks: 10,
            earnedMarks: 6,
            percentage: 60,
            passed: false,
            correctCount: 3,
            wrongCount: 2,
            unansweredCount: 0,
            zamesEarned: 6,
            startedAt: new Date(),
            submittedAt: new Date(),
            status: AttemptStatus.Completed,
        } as any);
        await QuizAttemptModel.create({
            quizId: quiz._id,
            userId: user._id,
            enrollmentId: enrollment._id,
            attemptNumber: 3,
            answers: [],
            totalMarks: 10,
            earnedMarks: 0,
            percentage: 0,
            passed: false,
            correctCount: 0,
            wrongCount: 0,
            unansweredCount: 5,
            zamesEarned: 0,
            startedAt: new Date(),
            status: AttemptStatus.InProgress,
        } as any);

        const stats = await GamificationService.getStats(user._id.toString());
        expect(stats.quizzesCompleted).toBe(2);
        expect(stats.totalZames).toBe(14);
        expect(stats.totalMarks).toBe(14);
        expect(stats.highestScore).toBe(80);
        expect(stats.recentAttempts).toHaveLength(2);
    });

    it('scopes stats to an enrollment when courseId and batchId are given', async () => {
        const { user, batch, course } = await seedAttempt();
        const stats = await GamificationService.getStats(
            user._id.toString(),
            course._id.toString(),
            batch._id.toString()
        );
        expect(stats.quizzesCompleted).toBe(1);
        expect(stats.totalZames).toBe(8);
    });

    it('reports averageScore as a percentage average, matching highestScore units', async () => {
        const { user, quiz, enrollment } = await seedAttempt(); // 8 marks / 80%
        await QuizAttemptModel.create({
            quizId: quiz._id,
            userId: user._id,
            enrollmentId: enrollment._id,
            attemptNumber: 2,
            answers: [],
            totalMarks: 10,
            earnedMarks: 6,
            percentage: 60,
            passed: true,
            correctCount: 3,
            wrongCount: 2,
            unansweredCount: 0,
            zamesEarned: 6,
            startedAt: new Date(),
            submittedAt: new Date(),
            status: AttemptStatus.Completed,
        } as any);

        const stats = await GamificationService.getStats(user._id.toString());
        expect(stats.averageScore).toBe(70);
        expect(stats.highestScore).toBe(80);
    });
});

describe('GamificationService.getTransactionHistory', () => {
    it('paginates the history newest-first with meta', async () => {
        const { user, quiz, attempt } = await seedAttempt();
        await GamificationService.awardZames({
            userId: user._id.toString(),
            quizAttemptId: attempt._id.toString(),
            quizId: quiz._id.toString(),
            points: 8,
        });
        for (const n of [2, 3]) {
            const extra = await QuizAttemptModel.create({
                quizId: quiz._id,
                userId: user._id,
                enrollmentId: attempt.enrollmentId,
                attemptNumber: n,
                answers: [],
                totalMarks: 10,
                earnedMarks: 5,
                percentage: 50,
                passed: true,
                correctCount: 2,
                wrongCount: 2,
                unansweredCount: 0,
                zamesEarned: 5,
                startedAt: new Date(),
                submittedAt: new Date(),
                status: AttemptStatus.Completed,
            } as any);
            await GamificationService.awardZames({
                userId: user._id.toString(),
                quizAttemptId: extra._id.toString(),
                quizId: quiz._id.toString(),
                points: 5,
            });
        }

        const page1 = await GamificationService.getTransactionHistory(user._id.toString(), undefined, undefined, 1, 2);
        expect(page1.data).toHaveLength(2);
        expect(page1.meta).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });

        const page2 = await GamificationService.getTransactionHistory(user._id.toString(), undefined, undefined, 2, 2);
        expect(page2.data).toHaveLength(1);
    });

    it('returns an empty page for a user with no history', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        const result = await GamificationService.getTransactionHistory(user._id.toString());
        expect(result.data).toHaveLength(0);
        expect(result.meta.total).toBe(0);
    });
});
