import { IQuestion } from './question.interface.js';
import { IQuizAnswer } from './attempt.interface.js';

export interface QuizAnswerInput {
    questionId: string;
    selectedAnswer: string | null;
}

export interface ScoringResult {
    answers: IQuizAnswer[];
    totalMarks: number;
    earnedMarks: number;
    percentage: number;
    passed: boolean;
    correctCount: number;
    wrongCount: number;
    unansweredCount: number;
    zamesEarned: number;
}

const evaluateQuiz = (
    questions: IQuestion[],
    userAnswers: QuizAnswerInput[],
    passingPercentage: number
): ScoringResult => {
    const answersMap = new Map<string, QuizAnswerInput>();
    for (const answer of userAnswers) {
        answersMap.set(answer.questionId, answer);
    }

    const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);
    let earnedMarks = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;
    let zamesEarned = 0;

    const answers: IQuizAnswer[] = [];

    for (const question of questions) {
        const qId = question._id?.toString() || '';
        const userAnswer = answersMap.get(qId);

        if (!userAnswer || userAnswer.selectedAnswer === null || userAnswer.selectedAnswer === '') {
            unansweredCount++;
            answers.push({
                questionId: question._id!,
                selectedAnswer: null,
                isCorrect: false,
                marksAwarded: 0,
            });
            continue;
        }

        // A selection only counts when it is one of the question's option
        // values (option text, or `option-<index>` for textless options — the
        // same convention the player sends). This guards against legacy rows
        // where a bare index was stored: with shuffling enabled an index no
        // longer points at the intended option, so it must never score.
        const optionValues = new Set(
            (question.options || []).map((o: any, i: number) => o?.text || `option-${i}`)
        );
        const isCorrect =
            optionValues.has(userAnswer.selectedAnswer) &&
            userAnswer.selectedAnswer === question.correctAnswer;

        if (isCorrect) {
            earnedMarks += question.marks;
            zamesEarned += question.zamesPoints;
            correctCount++;
        } else {
            wrongCount++;
        }

        answers.push({
            questionId: question._id!,
            selectedAnswer: userAnswer.selectedAnswer,
            isCorrect,
            marksAwarded: isCorrect ? question.marks : 0,
        });
    }

    const percentage = totalMarks > 0 ? Math.round((earnedMarks / totalMarks) * 100) : 0;
    const passed = percentage >= passingPercentage;

    return {
        answers,
        totalMarks,
        earnedMarks,
        percentage,
        passed,
        correctCount,
        wrongCount,
        unansweredCount,
        zamesEarned,
    };
};

export const ScoringEngine = {
    evaluate: evaluateQuiz,
};
