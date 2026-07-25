import { StatusCodes } from 'http-status-codes';
import { QuestionModel } from './question.model.js';
import { QuizModel } from './quiz.model.js';
import { QuizService } from './quiz.service.js';
import ApiError from '../../errors/ApiError.js';

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

    await Promise.all(
        questionOrders.map(({ questionId, orderIndex }) =>
            QuestionModel.findByIdAndUpdate(questionId, { orderIndex })
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
