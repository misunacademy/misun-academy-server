import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
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
import { QuizModel } from '../../modules/Quiz/quiz.model.js';
import { QuestionModel } from '../../modules/Quiz/question.model.js';
import { QuizAttemptModel } from '../../modules/Quiz/attempt.model.js';
import { AttemptService } from '../../modules/Quiz/attempt.service.js';

const REAL_NOW = Date.now();

const seedTimedQuiz = async (overrides: Record<string, unknown> = {}) => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id);
    const batch = await createBatch(course._id);
    const mod = await createModule(course._id, batch._id, 1);
    const enrollment = await createActiveEnrollment(user._id, batch._id);

    const quiz = await QuizModel.create({
        moduleId: mod._id,
        slug: `timed-quiz-${Date.now()}`,
        orderIndex: 1,
        createdBy: admin._id,
        title: `Timed Quiz ${Date.now()}`,
        description: 'Expiry enforcement',
        instructions: 'Answer all',
        passingPercentage: 50,
        totalMarks: 2,
        totalQuestions: 2,
        timeLimit: 1,
        maxAttempts: 2,
        status: 'published',
        ...overrides,
    });

    const q1 = await QuestionModel.create({
        quizId: quiz._id,
        questionType: 'mcq',
        content: { type: 'text', text: '2+2?' },
        options: [
            { type: 'text', text: '3' },
            { type: 'text', text: '4' },
        ],
        correctAnswer: '4',
        marks: 1,
        orderIndex: 1,
    });
    const q2 = await QuestionModel.create({
        quizId: quiz._id,
        questionType: 'mcq',
        content: { type: 'text', text: '3+3?' },
        options: [
            { type: 'text', text: '6' },
            { type: 'text', text: '7' },
        ],
        correctAnswer: '6',
        marks: 1,
        orderIndex: 2,
    });

    return { user, course, quiz, questions: [q1, q2], enrollment };
};

const answersFor = (questions: { _id: mongoose.Types.ObjectId; correctAnswer: string }[]) =>
    questions.map((q) => ({ questionId: q._id.toString(), selectedAnswer: q.correctAnswer }));

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(REAL_NOW + (Date.now() - REAL_NOW));
});

describe('AttemptService — server-side timed quiz expiry', () => {
    it('accepts a submission before the deadline', async () => {
        const { user, quiz, questions, enrollment } = await seedTimedQuiz();
        const started = await AttemptService.startAttempt(
            quiz._id.toString(),
            user._id.toString(),
            enrollment._id.toString()
        );

        jest.spyOn(Date, 'now').mockReturnValue(new Date(started.attempt.startedAt).getTime() + 30_000);

        const result = await AttemptService.submitAttempt(
            started.attempt._id.toString(),
            user._id.toString(),
            answersFor(questions)
        );
        expect(result.status).toBe('completed');
        expect(result.earnedMarks).toBe(2);
    });

    it('accepts a submission exactly at the deadline boundary and rejects one second later', async () => {
        const { user, quiz, questions, enrollment } = await seedTimedQuiz();
        const started = await AttemptService.startAttempt(
            quiz._id.toString(),
            user._id.toString(),
            enrollment._id.toString()
        );
        const deadline = new Date(started.attempt.startedAt).getTime() + (quiz.timeLimit ?? 0) * 60_000;

        jest.spyOn(Date, 'now').mockReturnValue(deadline);
        const atBoundary = await AttemptService.submitAttempt(
            started.attempt._id.toString(),
            user._id.toString(),
            answersFor(questions)
        );
        expect(atBoundary.status).toBe('completed');

        const secondStart = await AttemptService.startAttempt(
            quiz._id.toString(),
            user._id.toString(),
            enrollment._id.toString()
        );
        jest.spyOn(Date, 'now').mockReturnValue(deadline + 60_000 * 5);
        await expect(
            AttemptService.submitAttempt(
                secondStart.attempt._id.toString(),
                user._id.toString(),
                answersFor(questions)
            )
        ).rejects.toThrow(/expired/i);
    });

    it('rejects a late submission without mutating the attempt, then expires the stale attempt on restart', async () => {
        const { user, quiz, questions, enrollment } = await seedTimedQuiz({ maxAttempts: 2 });
        const started = await AttemptService.startAttempt(
            quiz._id.toString(),
            user._id.toString(),
            enrollment._id.toString()
        );
        jest.spyOn(Date, 'now').mockReturnValue(new Date(started.attempt.startedAt).getTime() + 61_000 * 10);

        await expect(
            AttemptService.submitAttempt(started.attempt._id.toString(), user._id.toString(), answersFor(questions))
        ).rejects.toThrow(/expired/i);

        const untouched = await QuizAttemptModel.findById(started.attempt._id).lean();
        expect(untouched?.status).toBe('in_progress');
        expect(untouched?.answers).toHaveLength(0);

        await AttemptService.startAttempt(quiz._id.toString(), user._id.toString(), enrollment._id.toString());

        const stale = await QuizAttemptModel.findById(started.attempt._id).lean();
        expect(stale?.status).toBe('completed');
        expect(stale?.expired).toBe(true);
        expect(stale?.earnedMarks).toBe(0);
    });

    it('does not affect untimed quizzes regardless of elapsed time', async () => {
        const { user, quiz, questions, enrollment } = await seedTimedQuiz({ timeLimit: null });
        const started = await AttemptService.startAttempt(
            quiz._id.toString(),
            user._id.toString(),
            enrollment._id.toString()
        );
        jest.spyOn(Date, 'now').mockReturnValue(new Date(started.attempt.startedAt).getTime() + 86_400_000);

        const result = await AttemptService.submitAttempt(
            started.attempt._id.toString(),
            user._id.toString(),
            answersFor(questions)
        );
        expect(result.status).toBe('completed');
    });

    it('still enforces attempt limits across expired attempts', async () => {
        const { user, quiz, questions, enrollment } = await seedTimedQuiz({ maxAttempts: 2 });
        const first = await AttemptService.startAttempt(
            quiz._id.toString(),
            user._id.toString(),
            enrollment._id.toString()
        );
        jest.spyOn(Date, 'now').mockReturnValue(new Date(first.attempt.startedAt).getTime() + 120_000);
        await expect(
            AttemptService.submitAttempt(first.attempt._id.toString(), user._id.toString(), answersFor(questions))
        ).rejects.toThrow(/expired/i);

        jest.spyOn(Date, 'now').mockReturnValue(new Date(first.attempt.startedAt).getTime() + 125_000);
        const second = await AttemptService.startAttempt(
            quiz._id.toString(),
            user._id.toString(),
            enrollment._id.toString()
        );
        expect(second.attempt.attemptNumber).toBe(2);

        const consumed = await QuizAttemptModel.countDocuments({
            quizId: quiz._id,
            userId: user._id,
            status: 'completed',
            expired: true,
        });
        expect(consumed).toBe(1);

        jest.spyOn(Date, 'now').mockReturnValue(
            new Date((second.attempt as { startedAt: Date }).startedAt).getTime() + 30_000
        );
        const submitted = await AttemptService.submitAttempt(
            second.attempt._id.toString(),
            user._id.toString(),
            answersFor(questions)
        );
        expect(submitted.status).toBe('completed');

        await expect(
            AttemptService.startAttempt(quiz._id.toString(), user._id.toString(), enrollment._id.toString())
        ).rejects.toThrow(/maximum number of attempts/i);
    });
});
