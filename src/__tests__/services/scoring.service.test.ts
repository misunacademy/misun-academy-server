import { describe, it, expect } from '@jest/globals';
import mongoose from 'mongoose';
import { ScoringEngine, QuizAnswerInput } from '../../modules/Quiz/scoring.service.js';
import { IQuestion } from '../../modules/Quiz/question.interface.js';

const qid = () => new mongoose.Types.ObjectId();

const buildQuestion = (overrides: Partial<IQuestion> = {}): IQuestion =>
    ({
        _id: qid(),
        questionType: 'mcq',
        content: { type: 'text', text: 'What is 2+2?' },
        options: [
            { type: 'text', text: '3' },
            { type: 'text', text: '4' },
        ],
        correctAnswer: '4',
        marks: 2,
        zamesPoints: 5,
        orderIndex: 1,
        ...overrides,
    }) as IQuestion;

describe('ScoringEngine.evaluate', () => {
    it('awards full marks, 100% and zames when every answer is correct', () => {
        const questions = [buildQuestion(), buildQuestion({ correctAnswer: '3', marks: 3, zamesPoints: 7 })];
        const answers: QuizAnswerInput[] = questions.map((q) => ({
            questionId: q._id!.toString(),
            selectedAnswer: q.correctAnswer,
        }));

        const result = ScoringEngine.evaluate(questions, answers, 50);

        expect(result.totalMarks).toBe(5);
        expect(result.earnedMarks).toBe(5);
        expect(result.percentage).toBe(100);
        expect(result.passed).toBe(true);
        expect(result.correctCount).toBe(2);
        expect(result.wrongCount).toBe(0);
        expect(result.unansweredCount).toBe(0);
        expect(result.zamesEarned).toBe(12);
        expect(result.answers).toHaveLength(2);
        expect(result.answers.every((a) => a.isCorrect)).toBe(true);
    });

    it('counts correct, wrong and unanswered separately and awards only correct marks', () => {
        const questions = [buildQuestion({ marks: 2 }), buildQuestion({ marks: 4 }), buildQuestion({ marks: 4 })];
        const answers: QuizAnswerInput[] = [
            { questionId: questions[0]._id!.toString(), selectedAnswer: '4' },
            { questionId: questions[1]._id!.toString(), selectedAnswer: 'wrong' },
            // third question left unanswered
        ];

        const result = ScoringEngine.evaluate(questions, answers, 50);

        expect(result.totalMarks).toBe(10);
        expect(result.earnedMarks).toBe(2);
        expect(result.percentage).toBe(20);
        expect(result.passed).toBe(false);
        expect(result.correctCount).toBe(1);
        expect(result.wrongCount).toBe(1);
        expect(result.unansweredCount).toBe(1);
        expect(result.answers[1].marksAwarded).toBe(0);
        expect(result.answers[2].selectedAnswer).toBeNull();
    });

    it('treats null and empty-string selections as unanswered', () => {
        const questions = [buildQuestion(), buildQuestion()];
        const answers: QuizAnswerInput[] = [
            { questionId: questions[0]._id!.toString(), selectedAnswer: null },
            { questionId: questions[1]._id!.toString(), selectedAnswer: '' },
        ];

        const result = ScoringEngine.evaluate(questions, answers, 50);

        expect(result.unansweredCount).toBe(2);
        expect(result.wrongCount).toBe(0);
        expect(result.earnedMarks).toBe(0);
        expect(result.percentage).toBe(0);
    });

    it('ignores answers for unknown question ids', () => {
        const questions = [buildQuestion()];
        const answers: QuizAnswerInput[] = [
            { questionId: questions[0]._id!.toString(), selectedAnswer: '4' },
            { questionId: new mongoose.Types.ObjectId().toString(), selectedAnswer: '4' },
        ];

        const result = ScoringEngine.evaluate(questions, answers, 50);

        expect(result.answers).toHaveLength(1);
        expect(result.earnedMarks).toBe(2);
        expect(result.correctCount).toBe(1);
    });

    it('rounds the percentage and passes on the exact threshold', () => {
        const questions = [buildQuestion({ marks: 1 }), buildQuestion({ marks: 1 }), buildQuestion({ marks: 1 })];
        const answers: QuizAnswerInput[] = [
            { questionId: questions[0]._id!.toString(), selectedAnswer: '4' },
        ];

        const atBoundary = ScoringEngine.evaluate(questions, answers, 33);
        expect(atBoundary.percentage).toBe(33);
        expect(atBoundary.passed).toBe(true);

        const above = ScoringEngine.evaluate(questions, answers, 34);
        expect(above.passed).toBe(false);
    });

    it('handles an empty quiz without dividing by zero', () => {
        const result = ScoringEngine.evaluate([], [], 50);

        expect(result.totalMarks).toBe(0);
        expect(result.percentage).toBe(0);
        expect(result.passed).toBe(false);
        expect(result.answers).toHaveLength(0);
    });

    it('never scores a selection that matches no option, even if it equals a legacy index correctAnswer', () => {
        const questions = [
            buildQuestion({
                options: [
                    { type: 'text', text: 'aaa' },
                    { type: 'text', text: 'bbb' },
                ],
                correctAnswer: '0', // legacy bare-index row
                marks: 2,
            }),
        ];
        const answers: QuizAnswerInput[] = [
            { questionId: questions[0]._id!.toString(), selectedAnswer: '0' },
        ];

        const result = ScoringEngine.evaluate(questions, answers, 50);

        expect(result.earnedMarks).toBe(0);
        expect(result.correctCount).toBe(0);
        expect(result.wrongCount).toBe(1);
        expect(result.answers[0].isCorrect).toBe(false);
    });
});
