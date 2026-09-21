import { StatusCodes } from 'http-status-codes';
import { QuestionModel } from './question.model.js';
import { QuizModel } from './quiz.model.js';
import { QuizService } from './quiz.service.js';
import ApiError from '../../errors/ApiError.js';

/**
 * correctAnswer stores the option VALUE (option text, or `option-<index>`
 * fallback for textless options — same convention as the client). Reject
 * answers that match none of the options.
 */
const assertCorrectAnswerMatchesOptions = (options: any[] | undefined, correctAnswer: unknown) => {
    if (correctAnswer === undefined || correctAnswer === null || correctAnswer === '') return;
    const values = (options || []).map((o, i) => o?.text || `option-${i}`);
    if (!values.includes(correctAnswer)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'correctAnswer must match one of the options');
    }
};

/**
 * Only validate the answer when the option set itself has a valid size —
 * otherwise the schema's option-count error keeps precedence.
 */
const shouldValidateAnswer = (questionType: string | undefined, options: any[] | undefined) => {
    if (questionType === 'true_false') return true;
    const count = options?.length ?? 0;
    return count >= 2 && count <= 6;
};

const createQuestion = async (quizId: string, questionData: any) => {
    const quiz = await QuizModel.findById(quizId).lean();
    if (!quiz) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found');
    }

    if (questionData.orderIndex !== undefined) {
        const existing = await QuestionModel.findOne({
            quizId,
            orderIndex: questionData.orderIndex,
        }).lean();
        if (existing) {
            throw new ApiError(StatusCodes.CONFLICT, 'Question with this order index already exists');
        }
    } else {
        const maxOrder = await QuestionModel.findOne({ quizId }).sort({ orderIndex: -1 }).lean();
        questionData.orderIndex = maxOrder ? maxOrder.orderIndex + 1 : 0;
    }

    if (questionData.questionType === 'true_false') {
        questionData.options = [
            { type: 'text', text: 'True' },
            { type: 'text', text: 'False' },
        ];
    }

    if (shouldValidateAnswer(questionData.questionType, questionData.options)) {
        assertCorrectAnswerMatchesOptions(questionData.options, questionData.correctAnswer);
    }

    const question = await QuestionModel.create({
        ...questionData,
        quizId,
    });

    await QuizService.recalcQuizTotals(quizId);

    return question;
};

const getQuizQuestions = async (quizId: string) => {
    const questions = await QuestionModel.find({ quizId }).sort({ orderIndex: 1 }).lean();
    return questions;
};

const getQuestionById = async (questionId: string) => {
    const question = await QuestionModel.findById(questionId).lean();
    if (!question) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Question not found');
    }
    return question;
};

const updateQuestion = async (questionId: string, updateData: any) => {
    const questionDoc = await QuestionModel.findById(questionId);
    if (!questionDoc) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Question not found');
    }

    if (updateData.orderIndex !== undefined && updateData.orderIndex !== questionDoc.orderIndex) {
        const existing = await QuestionModel.findOne({
            quizId: questionDoc.quizId,
            orderIndex: updateData.orderIndex,
            _id: { $ne: questionId },
        }).lean();
        if (existing) {
            throw new ApiError(StatusCodes.CONFLICT, 'Question with this order index already exists');
        }
    }

    if (updateData.questionType === 'true_false') {
        updateData.options = [
            { type: 'text', text: 'True' },
            { type: 'text', text: 'False' },
        ];
    }

    const mergedOptions = updateData.options ?? questionDoc.options;
    const mergedType = updateData.questionType ?? questionDoc.questionType;
    if (shouldValidateAnswer(mergedType, mergedOptions)) {
        assertCorrectAnswerMatchesOptions(
            mergedOptions,
            updateData.correctAnswer ?? questionDoc.correctAnswer
        );
    }

    Object.assign(questionDoc, updateData);
    await questionDoc.save();

    await QuizService.recalcQuizTotals(questionDoc.quizId.toString());

    return questionDoc.toObject();
};

const deleteQuestion = async (questionId: string) => {
    const question = await QuestionModel.findById(questionId).lean();
    if (!question) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Question not found');
    }

    await QuestionModel.findByIdAndDelete(questionId);
    await QuizService.recalcQuizTotals(question.quizId.toString());

    return null;
};

const duplicateQuestion = async (questionId: string) => {
    const question = await QuestionModel.findById(questionId).lean();
    if (!question) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Question not found');
    }

    const maxOrder = await QuestionModel.findOne({ quizId: question.quizId })
        .sort({ orderIndex: -1 })
        .lean();

    const duplicated = await QuestionModel.create({
        quizId: question.quizId,
        questionType: question.questionType,
        content: question.content,
        options: question.options,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        marks: question.marks,
        zamesPoints: question.zamesPoints,
        orderIndex: maxOrder ? maxOrder.orderIndex + 1 : 0,
    });

    await QuizService.recalcQuizTotals(question.quizId.toString());

    return duplicated;
};

const reorderQuestions = async (quizId: string, questionOrders: { questionId: string; orderIndex: number }[]) => {
    if (!Array.isArray(questionOrders)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'questionOrders must be an array');
    }

    // Scoped to the quiz so a stray/foreign questionId can never move a
    // question that belongs to another quiz.
    await Promise.all(
        questionOrders.map(({ questionId, orderIndex }) =>
            QuestionModel.findOneAndUpdate({ _id: questionId, quizId }, { orderIndex })
        )
    );

    const questions = await QuestionModel.find({ quizId }).sort({ orderIndex: 1 }).lean();
    return questions;
};

export const QuestionService = {
    createQuestion,
    getQuizQuestions,
    getQuestionById,
    updateQuestion,
    deleteQuestion,
    duplicateQuestion,
    reorderQuestions,
};
