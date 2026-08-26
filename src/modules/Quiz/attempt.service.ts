import { StatusCodes } from 'http-status-codes';
import { QuizModel } from './quiz.model.js';
import { QuestionModel } from './question.model.js';
import { QuizAttemptModel } from './attempt.model.js';
import { ScoringEngine, QuizAnswerInput } from './scoring.service.js';
import { GamificationService } from './gamification.service.js';
import { QuizProgressModel } from '../Progress/quizProgress.model.js';
import { ProgressService } from '../Progress/progress.service.js';
import ApiError from '../../errors/ApiError.js';
import { AttemptStatus } from '../../types/common.js';
import { NotificationService } from '../Notification/notification.service.js';
import { logger } from '../../config/logger.js';

const shuffleArray = <T>(arr: T[]): T[] => {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        shuffled[i] = shuffled[j] = arr[Math.floor(Math.random() * arr.length)];
    }
    return shuffled;
};

const getExpiredAttemptDeadline = (startedAt: Date | string | undefined, timeLimit?: number | null): number | null => {
    if (!timeLimit || !startedAt) return null;
    return new Date(startedAt).getTime() + timeLimit * 60_000;
};

const startAttempt = async (quizId: string, userId: string, enrollmentId: string) => {
    const quiz = await QuizModel.findById(quizId).lean();
    if (!quiz) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found');
    }

    if (quiz.status !== 'published') {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'This quiz is not published yet');
    }

    const existingInProgress = await QuizAttemptModel.findOne({
        quizId,
        userId: userId as any,
        status: AttemptStatus.InProgress,
    }).lean();

    if (existingInProgress) {
        const deadline = getExpiredAttemptDeadline(existingInProgress.startedAt, quiz.timeLimit);
        if (deadline !== null && Date.now() > deadline) {
            await QuizAttemptModel.updateOne(
                { _id: existingInProgress._id, status: AttemptStatus.InProgress },
                {
                    $set: {
                        status: AttemptStatus.Completed,
                        submittedAt: new Date(),
                        timeTaken: null,
                        expired: true,
                    },
                }
            );
        } else {
        let existingQuestions = await QuestionModel.find({ quizId })
            .sort({ orderIndex: 1 })
            .lean();

        if (quiz.shuffleQuestions) {
            existingQuestions = shuffleArray(existingQuestions);
        }

        if (quiz.shuffleOptions) {
            existingQuestions = existingQuestions.map(q => ({
                ...q,
                options: shuffleArray(q.options),
            }));
        }

        return {
            attempt: {
                _id: existingInProgress._id,
                attemptNumber: existingInProgress.attemptNumber,
                quizId: existingInProgress.quizId,
                startedAt: existingInProgress.startedAt,
                status: existingInProgress.status,
            },
            quiz: {
                _id: quiz._id,
                title: quiz.title,
                timeLimit: quiz.timeLimit,
                totalMarks: quiz.totalMarks,
                totalQuestions: quiz.totalQuestions,
                shuffleQuestions: quiz.shuffleQuestions,
                shuffleOptions: quiz.shuffleOptions,
            },
            questions: existingQuestions.map(q => ({
                _id: q._id,
                questionType: q.questionType,
                content: q.content,
                options: q.options,
                marks: q.marks,
                orderIndex: q.orderIndex,
            })),
        };
        }
    }

    const completedAttempts = await QuizAttemptModel.countDocuments({
        quizId,
        userId: userId as any,
        status: AttemptStatus.Completed,
    });

    if (quiz.maxAttempts > 0 && completedAttempts >= quiz.maxAttempts) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'You have reached the maximum number of attempts');
    }

    let questions = await QuestionModel.find({ quizId })
        .sort({ orderIndex: 1 })
        .lean();

    if (questions.length === 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'This quiz has no questions');
    }

    if (quiz.shuffleQuestions) {
        questions = shuffleArray(questions);
    }

    if (quiz.shuffleOptions) {
        questions = questions.map(q => ({
            ...q,
            options: shuffleArray(q.options),
        }));
    }

    const attempt = await QuizAttemptModel.create({
        quizId: quizId as any,
        userId: userId as any,
        enrollmentId: enrollmentId as any,
        attemptNumber: completedAttempts + 1,
        answers: [],
        totalMarks: questions.reduce((sum, q) => sum + q.marks, 0),
        earnedMarks: 0,
        percentage: 0,
        passed: false,
        correctCount: 0,
        wrongCount: 0,
        unansweredCount: questions.length,
        zamesEarned: 0,
        startedAt: new Date(),
        status: AttemptStatus.InProgress,
    });

    const questionData = questions.map(q => ({
        _id: q._id,
        questionType: q.questionType,
        content: q.content,
        options: q.options,
        marks: q.marks,
        orderIndex: q.orderIndex,
    }));

    return {
        attempt: {
            _id: attempt._id,
            attemptNumber: attempt.attemptNumber,
            quizId: attempt.quizId,
            startedAt: attempt.startedAt,
            status: attempt.status,
        },
        quiz: {
            _id: quiz._id,
            title: quiz.title,
            timeLimit: quiz.timeLimit,
            totalMarks: quiz.totalMarks,
            totalQuestions: quiz.totalQuestions,
            shuffleQuestions: quiz.shuffleQuestions,
            shuffleOptions: quiz.shuffleOptions,
        },
        questions: questionData,
    };
};

const submitAttempt = async (attemptId: string, userId: string, answers: QuizAnswerInput[], timeTaken?: number) => {
    const attempt = await QuizAttemptModel.findById(attemptId).lean();
    if (!attempt) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Attempt not found');
    }

    if (attempt.userId.toString() !== userId) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'This attempt does not belong to you');
    }

    if (attempt.status === AttemptStatus.Completed) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'This attempt has already been submitted');
    }

    const quiz = await QuizModel.findById(attempt.quizId).lean();
    if (!quiz) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found');
    }

    const deadline = getExpiredAttemptDeadline(attempt.startedAt, quiz.timeLimit);
    if (deadline !== null && Date.now() > deadline) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'This attempt has expired. The time limit for this quiz has passed.'
        );
    }

    const questions = await QuestionModel.find({ quizId: attempt.quizId }).lean();

    const result = ScoringEngine.evaluate(questions, answers, quiz.passingPercentage);

    if (timeTaken === undefined && quiz.timeLimit) {
        const elapsed = Math.floor((Date.now() - new Date(attempt.startedAt).getTime()) / 1000);
        timeTaken = elapsed;
    }

    const updatedAttempt = await QuizAttemptModel.findOneAndUpdate(
        {
            _id: attemptId,
            status: { $ne: AttemptStatus.Completed },
        },
        {
            $set: {
                answers: result.answers,
                earnedMarks: result.earnedMarks,
                percentage: result.percentage,
                passed: result.passed,
                correctCount: result.correctCount,
                wrongCount: result.wrongCount,
                unansweredCount: result.unansweredCount,
                zamesEarned: result.zamesEarned,
                submittedAt: new Date(),
                timeTaken: timeTaken || null,
                status: AttemptStatus.Completed,
            },
        },
        { new: true }
    );

    if (!updatedAttempt) {
        throw new ApiError(StatusCodes.CONFLICT, 'This attempt has already been submitted');
    }

    if (result.zamesEarned > 0) {
        await GamificationService.awardZames({
            userId,
            quizAttemptId: attemptId,
            quizId: attempt.quizId.toString(),
            points: result.zamesEarned,
        });
    }

    if (updatedAttempt) {
        await QuizProgressModel.findOneAndUpdate(
            {
                enrollmentId: attempt.enrollmentId,
                quizId: attempt.quizId,
            },
            {
                status: 'completed',
                passed: result.passed,
                score: result.earnedMarks,
                attemptId: updatedAttempt._id,
                completedAt: new Date(),
            },
            { upsert: true, new: true }
        );

        if (quiz.moduleId) {
            await ProgressService.recalculateModuleProgress(
                attempt.enrollmentId.toString(),
                quiz.moduleId.toString()
            );
        }

        setImmediate(async () => {
            try {
                await NotificationService.createNotification({
                    userId,
                    type: 'quiz_result',
                    title: result.passed ? 'Quiz Passed' : 'Quiz Completed',
                    message: result.passed
                        ? `You scored ${result.percentage}% on "${quiz.title}" and earned ${result.zamesEarned} Zames!`
                        : `You scored ${result.percentage}% on "${quiz.title}". Keep practicing!`,
                    link: '/my-classes',
                    relatedTo: { model: 'Quiz', id: quiz._id.toString() },
                });
            } catch (error) {
                logger.error(error, 'Failed to send quiz result notification');
            }
        });
    }

    return updatedAttempt || attempt;
};

const getAttemptResult = async (attemptId: string, userId: string) => {
    const attempt = await QuizAttemptModel.findById(attemptId).lean();

    if (!attempt) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Attempt not found');
    }

    if (attempt.userId.toString() !== userId) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'This attempt does not belong to you');
    }

    const quiz = await QuizModel.findById(attempt.quizId).lean();

    let questions: any[] = [];
    if (quiz?.showCorrectAnswers || quiz?.allowReview) {
        questions = await QuestionModel.find({ quizId: attempt.quizId })
            .sort({ orderIndex: 1 })
            .lean();
    }

    const motivationalMessage = getMotivationalMessage(attempt.percentage);

    return {
        attempt,
        motivationalMessage,
        questions: quiz?.showCorrectAnswers
            ? questions.map(q => ({
                _id: q._id,
                questionType: q.questionType,
                content: q.content,
                options: q.options,
                correctAnswer: q.correctAnswer,
                explanation: q.explanation,
                marks: q.marks,
            }))
            : quiz?.allowReview
                ? questions.map(q => ({
                    _id: q._id,
                    questionType: q.questionType,
                    content: q.content,
                    options: q.options,
                    marks: q.marks,
                }))
                : [],
    };
};

const getUserAttempts = async (quizId: string, userId: string) => {
    const attempts = await QuizAttemptModel.find({
        quizId: quizId as any,
        userId: userId as any,
    })
        .sort({ attemptNumber: -1 })
        .lean();

    return attempts;
};

const getAttemptById = async (attemptId: string, userId: string) => {
    const attempt = await QuizAttemptModel.findById(attemptId).lean();
    if (!attempt) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Attempt not found');
    }
    if (attempt.userId.toString() !== userId) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'This attempt does not belong to you');
    }
    return attempt;
};

interface MotivationalMessage {
    emoji: string;
    title: string;
    message: string;
    level: 'outstanding' | 'great' | 'good' | 'keep_practicing' | 'keep_learning';
}

const getMotivationalMessage = (percentage: number): MotivationalMessage => {
    if (percentage >= 90) {
        return {
            emoji: '🎉',
            title: 'Outstanding!',
            message: "You're mastering this topic. Keep up the excellent work!",
            level: 'outstanding',
        };
    }
    if (percentage >= 75) {
        return {
            emoji: '👏',
            title: 'Great Job!',
            message: "You're very close to perfection.",
            level: 'great',
        };
    }
    if (percentage >= 60) {
        return {
            emoji: '👍',
            title: 'Good Effort!',
            message: "Review a few concepts and you'll improve quickly.",
            level: 'good',
        };
    }
    if (percentage >= 40) {
        return {
            emoji: '💪',
            title: 'Keep Practicing!',
            message: "You're making progress, and another attempt will help.",
            level: 'keep_practicing',
        };
    }
    return {
        emoji: '📚',
        title: "Don't Give Up!",
        message: "Review the lessons and try again—you've got this.",
        level: 'keep_learning',
    };
};

export const AttemptService = {
    startAttempt,
    submitAttempt,
    getAttemptResult,
    getUserAttempts,
    getAttemptById,
    getMotivationalMessage,
};
