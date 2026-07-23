import { StatusCodes } from 'http-status-codes';
import slugify from '../../utils/slugify.js';
import { Types } from 'mongoose';
import { QuizModel } from './quiz.model.js';
import { QuestionModel } from './question.model.js';
import { ModuleModel } from '../Module/module.model.js';
import { CourseModel } from '../Course/course.model.js';
import { QuizAttemptModel } from './attempt.model.js';
import ApiError from '../../errors/ApiError.js';
import { AttemptStatus } from '../../types/common.js';

const generateUniqueSlug = async (title: string, existingId?: string): Promise<string> => {
    let slug = slugify(title);
    let counter = 0;
    let uniqueSlug = slug;

    while (true) {
        const existing = await QuizModel.findOne({ slug: uniqueSlug }).lean();
        if (!existing || (existingId && existing._id?.toString() === existingId)) {
            return uniqueSlug;
        }
        counter++;
        uniqueSlug = `${slug}-${counter}`;
    }
};

const recalcQuizTotals = async (quizId: string) => {
    const questions = await QuestionModel.find({ quizId }).lean();
    const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0);
    const totalQuestions = questions.length;

    await QuizModel.findByIdAndUpdate(quizId, {
        totalMarks,
        totalQuestions,
    });

    return { totalMarks, totalQuestions };
};

const createQuiz = async (moduleId: string, quizData: any, userId: string) => {
    const module = await ModuleModel.findById(moduleId).lean();
    if (!module) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Module not found');
    }

    if (quizData.orderIndex !== undefined) {
        const existing = await QuizModel.findOne({
            moduleId,
            orderIndex: quizData.orderIndex,
        }).lean();
        if (existing) {
            throw new ApiError(StatusCodes.CONFLICT, 'Quiz with this order index already exists');
        }
    } else {
        const maxOrder = await QuizModel.findOne({ moduleId }).sort({ orderIndex: -1 }).lean();
        quizData.orderIndex = maxOrder ? maxOrder.orderIndex + 1 : 0;
    }

    const slug = await generateUniqueSlug(quizData.title);

    const quiz = await QuizModel.create({
        ...quizData,
        moduleId,
        slug,
        createdBy: userId,
        totalMarks: 0,
        totalQuestions: 0,
    });

    return quiz;
};

const getModuleQuizzes = async (moduleId: string) => {
    const quizzes = await QuizModel.find({ moduleId }).sort({ orderIndex: 1 }).lean();
    return quizzes;
};

const getQuizById = async (quizId: string) => {
    const quiz = await QuizModel.findById(quizId).lean();
    if (!quiz) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found');
    }
    return quiz;
};

const getQuizBySlug = async (slug: string) => {
    const quiz = await QuizModel.findOne({ slug }).populate('moduleId').lean();
    if (!quiz) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found');
    }
    return quiz;
};

const updateQuiz = async (quizId: string, updateData: any) => {
    const quiz = await QuizModel.findById(quizId).lean();
    if (!quiz) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found');
    }

    if (updateData.title && updateData.title !== quiz.title) {
        updateData.slug = await generateUniqueSlug(updateData.title, quizId);
    }

    if (updateData.orderIndex !== undefined && updateData.orderIndex !== quiz.orderIndex) {
        const existing = await QuizModel.findOne({
            moduleId: quiz.moduleId,
            orderIndex: updateData.orderIndex,
            _id: { $ne: quizId },
        }).lean();
        if (existing) {
            throw new ApiError(StatusCodes.CONFLICT, 'Quiz with this order index already exists');
        }
    }

    const updated = await QuizModel.findByIdAndUpdate(
        quizId,
        { $set: updateData },
        { new: true, runValidators: true }
    );

    if (!updated) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found');
    }

    return updated;
};

const deleteQuiz = async (quizId: string) => {
    const quiz = await QuizModel.findById(quizId).lean();
    if (!quiz) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found');
    }

    await QuestionModel.deleteMany({ quizId });
    await QuizModel.findByIdAndDelete(quizId);
    return null;
};

const reorderQuizzes = async (moduleId: string, quizOrders: { quizId: string; orderIndex: number }[]) => {
    if (!Array.isArray(quizOrders)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'quizOrders must be an array');
    }

    await Promise.all(
        quizOrders.map(({ quizId, orderIndex }) =>
            QuizModel.findByIdAndUpdate(quizId, { orderIndex })
        )
    );

    const quizzes = await QuizModel.find({ moduleId }).sort({ orderIndex: 1 }).lean();
    return quizzes;
};

const getAllQuizzes = async (filters: {
    search?: string;
    status?: string;
    courseId?: string;
    page?: number;
    limit?: number;
}) => {
    const { search, status, courseId, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const match: Record<string, any> = {};

    if (status) {
        match.status = status;
    }

    if (courseId) {
        const modules = await ModuleModel.find({ courseId }).select('_id').lean();
        const moduleIds = modules.map(m => m._id);
        match.moduleId = { $in: moduleIds };
    }

    if (search) {
        match.title = { $regex: search, $options: 'i' };
    }

    const [quizzes, total] = await Promise.all([
        QuizModel.find(match)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate({
                path: 'moduleId',
                select: 'title courseId',
                populate: { path: 'courseId', select: 'title slug' },
            })
            .populate('createdBy', 'name email')
            .lean(),
        QuizModel.countDocuments(match),
    ]);

    const quizIds = quizzes.map(q => q._id);

    const attemptStats = await QuizAttemptModel.aggregate([
        { $match: { quizId: { $in: quizIds }, status: AttemptStatus.Completed } },
        {
            $group: {
                _id: '$quizId',
                totalAttempts: { $sum: 1 },
                averageScore: { $avg: '$percentage' },
                passCount: { $sum: { $cond: ['$passed', 1, 0] } },
            },
        },
    ]);

    const statsMap = new Map<string, typeof attemptStats[0]>();
    for (const stat of attemptStats) {
        statsMap.set(stat._id.toString(), stat);
    }

    const data = quizzes.map(quiz => {
        const stats = statsMap.get(quiz._id.toString());
        return {
            ...quiz,
            attemptStats: stats
                ? {
                    totalAttempts: stats.totalAttempts,
                    averageScore: Math.round(stats.averageScore),
                    passRate: stats.totalAttempts > 0
                        ? Math.round((stats.passCount / stats.totalAttempts) * 100)
                        : 0,
                }
                : {
                    totalAttempts: 0,
                    averageScore: 0,
                    passRate: 0,
                },
        };
    });

    const globalStats = await QuizAttemptModel.aggregate([
        { $match: { status: AttemptStatus.Completed } },
        {
            $group: {
                _id: null,
                totalAttempts: { $sum: 1 },
                totalZamesAwarded: { $sum: '$zamesEarned' },
            },
        },
    ]);

    const [publishedCount, draftCount] = await Promise.all([
        QuizModel.countDocuments({ status: 'published' }),
        QuizModel.countDocuments({ status: 'draft' }),
    ]);

    return {
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
        stats: {
            totalQuizzes: total,
            publishedCount,
            draftCount,
            totalAttempts: globalStats[0]?.totalAttempts || 0,
            totalZamesAwarded: globalStats[0]?.totalZamesAwarded || 0,
        },
    };
};

const getQuizAnalytics = async (quizId: string) => {
    const [attemptStats, questionStats, questions] = await Promise.all([
        QuizAttemptModel.aggregate([
            { $match: { quizId: new Types.ObjectId(quizId), status: AttemptStatus.Completed } },
            {
                $group: {
                    _id: null,
                    totalAttempts: { $sum: 1 },
                    averageScore: { $avg: '$percentage' },
                    passCount: { $sum: { $cond: ['$passed', 1, 0] } },
                },
            },
        ]),
        QuizAttemptModel.aggregate([
            { $match: { quizId: new Types.ObjectId(quizId), status: AttemptStatus.Completed } },
            { $unwind: '$answers' },
            {
                $group: {
                    _id: '$answers.questionId',
                    attemptCount: { $sum: 1 },
                    correctCount: { $sum: { $cond: ['$answers.isCorrect', 1, 0] } },
                },
            },
        ]),
        QuestionModel.find({ quizId }).sort({ orderIndex: 1 }).lean(),
    ]);

    const stats = attemptStats[0] || { totalAttempts: 0, averageScore: 0, passCount: 0 };
    const passRate = stats.totalAttempts > 0
        ? Math.round((stats.passCount / stats.totalAttempts) * 100)
        : 0;

    const questionStatsMap = new Map<string, { attemptCount: number; correctCount: number }>();
    for (const qs of questionStats) {
        questionStatsMap.set(qs._id.toString(), {
            attemptCount: qs.attemptCount,
            correctCount: qs.correctCount,
        });
    }

    const perQuestion = questions.map(q => {
        const qs = questionStatsMap.get(q._id.toString());
        return {
            _id: q._id,
            content: q.content,
            marks: q.marks,
            orderIndex: q.orderIndex,
            attemptCount: qs?.attemptCount || 0,
            correctCount: qs?.correctCount || 0,
            correctPercent: qs?.attemptCount
                ? Math.round((qs.correctCount / qs.attemptCount) * 100)
                : 0,
        };
    });

    return {
        totalAttempts: stats.totalAttempts,
        averageScore: Math.round(stats.averageScore),
        passRate,
        perQuestion,
    };
};

export const QuizService = {
    createQuiz,
    getModuleQuizzes,
    getQuizById,
    getQuizBySlug,
    updateQuiz,
    deleteQuiz,
    reorderQuizzes,
    recalcQuizTotals,
    getAllQuizzes,
    getQuizAnalytics,
};
