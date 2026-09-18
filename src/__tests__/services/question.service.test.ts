import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
    createUser,
    createAdmin,
    createCourse,
    createBatch,
    createModule,
} from '../helpers/factories.js';
import { QuizModel } from '../../modules/Quiz/quiz.model.js';
import { QuestionModel } from '../../modules/Quiz/question.model.js';
import { QuestionService } from '../../modules/Quiz/question.service.js';

const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

const seedQuiz = async () => {
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
        totalMarks: 0,
        totalQuestions: 0,
        status: 'draft',
    });
    return { admin, quiz };
};

const mcqData = (overrides: Record<string, unknown> = {}) => ({
    questionType: 'mcq',
    content: { type: 'text', text: 'What is 2+2?' },
    options: [
        { type: 'text', text: '3' },
        { type: 'text', text: '4' },
    ],
    correctAnswer: '4',
    marks: 2,
    ...overrides,
});

const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'text', text: `Option ${i}` }));

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

describe('QuestionService.createQuestion', () => {
    it('creates an mcq with auto orderIndex 0 and recalcs quiz totals', async () => {
        const { quiz } = await seedQuiz();
        const q = await QuestionService.createQuestion(quiz._id.toString(), mcqData());

        expect(q.orderIndex).toBe(0);
        expect(q.correctAnswer).toBe('4');

        const updated = await QuizModel.findById(quiz._id).lean();
        expect(updated?.totalQuestions).toBe(1);
        expect(updated?.totalMarks).toBe(2);
    });

    it('auto-increments orderIndex for subsequent questions', async () => {
        const { quiz } = await seedQuiz();
        const q1 = await QuestionService.createQuestion(quiz._id.toString(), mcqData());
        const q2 = await QuestionService.createQuestion(quiz._id.toString(), mcqData());
        expect(q2.orderIndex).toBe((q1 as any).orderIndex + 1);
    });

    it('rejects a duplicate explicit orderIndex', async () => {
        const { quiz } = await seedQuiz();
        await QuestionService.createQuestion(quiz._id.toString(), mcqData({ orderIndex: 5 }));
        await expect(
            QuestionService.createQuestion(quiz._id.toString(), mcqData({ orderIndex: 5 }))
        ).rejects.toThrow(/order index already exists/i);
    });

    it('throws NOT_FOUND for an unknown quiz', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        await expect(
            QuestionService.createQuestion(user._id.toString(), mcqData())
        ).rejects.toThrow(/quiz not found/i);
    });

    it('rejects mcq with fewer than 2 options', async () => {
        const { quiz } = await seedQuiz();
        await expect(
            QuestionService.createQuestion(quiz._id.toString(), mcqData({ options: opts(1) }))
        ).rejects.toThrow(/invalid number of options/i);
    });

    it('rejects mcq with more than 6 options', async () => {
        const { quiz } = await seedQuiz();
        await expect(
            QuestionService.createQuestion(quiz._id.toString(), mcqData({ options: opts(7) }))
        ).rejects.toThrow(/invalid number of options/i);
    });

    it('accepts mcq with exactly 6 options', async () => {
        const { quiz } = await seedQuiz();
        const q = await QuestionService.createQuestion(quiz._id.toString(), mcqData({ options: opts(6), correctAnswer: 'Option 2' }));
        expect((q as any).options).toHaveLength(6);
    });

    it('forces true_false options to True/False regardless of input', async () => {
        const { quiz } = await seedQuiz();
        const q: any = await QuestionService.createQuestion(
            quiz._id.toString(),
            mcqData({ questionType: 'true_false', options: opts(4), correctAnswer: 'True' })
        );
        expect(q.options).toHaveLength(2);
        expect(q.options.map((o: any) => o.text)).toEqual(['True', 'False']);
    });
});

describe('QuestionService reads', () => {
    it('getQuizQuestions returns questions sorted by orderIndex', async () => {
        const { quiz } = await seedQuiz();
        await QuestionService.createQuestion(quiz._id.toString(), mcqData({ orderIndex: 3 }));
        await QuestionService.createQuestion(quiz._id.toString(), mcqData({ orderIndex: 1 }));
        await QuestionService.createQuestion(quiz._id.toString(), mcqData({ orderIndex: 2 }));

        const list = await QuestionService.getQuizQuestions(quiz._id.toString());
        expect(list.map((q) => q.orderIndex)).toEqual([1, 2, 3]);
    });

    it('getQuestionById returns the question and throws for unknown id', async () => {
        const { quiz } = await seedQuiz();
        const q: any = await QuestionService.createQuestion(quiz._id.toString(), mcqData());
        const found = await QuestionService.getQuestionById(q._id.toString());
        expect((found as any).correctAnswer).toBe('4');

        const user = await createUser({ email: `u-${uid()}@example.com` });
        await expect(QuestionService.getQuestionById(user._id.toString())).rejects.toThrow(
            /question not found/i
        );
    });
});

describe('QuestionService.updateQuestion', () => {
    it('updates content/marks and recalcs quiz totals', async () => {
        const { quiz } = await seedQuiz();
        const q: any = await QuestionService.createQuestion(quiz._id.toString(), mcqData({ marks: 2 }));
        const updated: any = await QuestionService.updateQuestion(q._id.toString(), {
            content: { type: 'text', text: 'Updated?' },
            marks: 5,
        });
        expect(updated.content.text).toBe('Updated?');

        const refreshed = await QuizModel.findById(quiz._id).lean();
        expect(refreshed?.totalMarks).toBe(5);
    });

    it('throws NOT_FOUND for an unknown question', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        await expect(QuestionService.updateQuestion(user._id.toString(), { marks: 3 })).rejects.toThrow(
            /question not found/i
        );
    });

    it('rejects orderIndex colliding with a sibling question', async () => {
        const { quiz } = await seedQuiz();
        const q1: any = await QuestionService.createQuestion(quiz._id.toString(), mcqData({ orderIndex: 1 }));
        const q2: any = await QuestionService.createQuestion(quiz._id.toString(), mcqData({ orderIndex: 2 }));
        expect(q1.orderIndex).toBe(1);
        await expect(
            QuestionService.updateQuestion(q2._id.toString(), { orderIndex: 1 })
        ).rejects.toThrow(/order index already exists/i);
    });

    it('resets options when switching type to true_false', async () => {
        const { quiz } = await seedQuiz();
        const q: any = await QuestionService.createQuestion(quiz._id.toString(), mcqData({ options: opts(4), correctAnswer: 'Option 1' }));
        expect(q.options).toHaveLength(4);
        const updated: any = await QuestionService.updateQuestion(q._id.toString(), {
            questionType: 'true_false',
            correctAnswer: 'True',
        });
        expect(updated.options).toHaveLength(2);
        expect(updated.options.map((o: any) => o.text)).toEqual(['True', 'False']);
    });
});

describe('QuestionService.deleteQuestion / duplicateQuestion / reorderQuestions', () => {
    it('deletes a question and recalcs totals', async () => {
        const { quiz } = await seedQuiz();
        const q: any = await QuestionService.createQuestion(quiz._id.toString(), mcqData({ marks: 3 }));
        await QuestionService.deleteQuestion(q._id.toString());

        expect(await QuestionModel.findById(q._id).lean()).toBeNull();
        const refreshed = await QuizModel.findById(quiz._id).lean();
        expect(refreshed?.totalQuestions).toBe(0);
        expect(refreshed?.totalMarks).toBe(0);
    });

    it('deleteQuestion throws NOT_FOUND for unknown id', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        await expect(QuestionService.deleteQuestion(user._id.toString())).rejects.toThrow(
            /question not found/i
        );
    });

    it('duplicates a question at max orderIndex + 1 and recalcs totals', async () => {
        const { quiz } = await seedQuiz();
        const q: any = await QuestionService.createQuestion(quiz._id.toString(), mcqData({ orderIndex: 0, marks: 2 }));
        const dup: any = await QuestionService.duplicateQuestion(q._id.toString());

        expect(dup._id.toString()).not.toBe(q._id.toString());
        expect(dup.orderIndex).toBe(1);
        expect(dup.correctAnswer).toBe(q.correctAnswer);
        expect(dup.marks).toBe(2);

        const refreshed = await QuizModel.findById(quiz._id).lean();
        expect(refreshed?.totalQuestions).toBe(2);
        expect(refreshed?.totalMarks).toBe(4);
    });

    it('duplicateQuestion throws NOT_FOUND for unknown id', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        await expect(QuestionService.duplicateQuestion(user._id.toString())).rejects.toThrow(
            /question not found/i
        );
    });

    it('reorders questions and returns them sorted', async () => {
        const { quiz } = await seedQuiz();
        const q1: any = await QuestionService.createQuestion(quiz._id.toString(), mcqData({ orderIndex: 0 }));
        const q2: any = await QuestionService.createQuestion(quiz._id.toString(), mcqData({ orderIndex: 1 }));

        const reordered = await QuestionService.reorderQuestions(quiz._id.toString(), [
            { questionId: q1._id.toString(), orderIndex: 1 },
            { questionId: q2._id.toString(), orderIndex: 0 },
        ]);
        expect(reordered.map((q) => q._id.toString())).toEqual([q2._id.toString(), q1._id.toString()]);
    });

    it('reorderQuestions rejects a non-array payload', async () => {
        const { quiz } = await seedQuiz();
        await expect(
            QuestionService.reorderQuestions(quiz._id.toString(), 'nope' as any)
        ).rejects.toThrow(/questionOrders must be an array/i);
    });
});

describe('QuestionService correctAnswer consistency', () => {
    it('rejects create when correctAnswer matches no option', async () => {
        const { quiz } = await seedQuiz();
        await expect(
            QuestionService.createQuestion(quiz._id.toString(), mcqData({ correctAnswer: 'Nope' }))
        ).rejects.toThrow(/correctAnswer must match one of the options/i);
    });

    it('rejects create for true_false with a non True/False answer', async () => {
        const { quiz } = await seedQuiz();
        await expect(
            QuestionService.createQuestion(
                quiz._id.toString(),
                mcqData({ questionType: 'true_false', correctAnswer: 'Maybe' })
            )
        ).rejects.toThrow(/correctAnswer must match one of the options/i);
    });

    it('rejects update that breaks the answer/option pairing', async () => {
        const { quiz } = await seedQuiz();
        const q: any = await QuestionService.createQuestion(quiz._id.toString(), mcqData());
        await expect(
            QuestionService.updateQuestion(q._id.toString(), { correctAnswer: 'Nope' })
        ).rejects.toThrow(/correctAnswer must match one of the options/i);

        await expect(
            QuestionService.updateQuestion(q._id.toString(), {
                options: [
                    { type: 'text', text: 'A' },
                    { type: 'text', text: 'B' },
                ],
            })
        ).rejects.toThrow(/correctAnswer must match one of the options/i);
    });

    it('accepts update that changes options and answer together', async () => {
        const { quiz } = await seedQuiz();
        const q: any = await QuestionService.createQuestion(quiz._id.toString(), mcqData());
        const updated: any = await QuestionService.updateQuestion(q._id.toString(), {
            options: [
                { type: 'text', text: 'A' },
                { type: 'text', text: 'B' },
            ],
            correctAnswer: 'B',
        });
        expect(updated.correctAnswer).toBe('B');
    });
});
