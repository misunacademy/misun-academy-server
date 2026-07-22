import { StatusCodes } from 'http-status-codes';
import { ZamesTransactionModel } from './zames.model.js';
import { LeaderboardEntryModel } from './leaderboard.model.js';
import { QuizModel } from './quiz.model.js';
import { QuizAttemptModel } from './attempt.model.js';
import { QuestionModel } from './question.model.js';
import ApiError from '../../errors/ApiError.js';
import { ZamesSource } from '../../types/common.js';

interface AwardZamesParams {
    userId: string;
    quizAttemptId: string;
    quizId: string;
    points: number;
    source?: ZamesSource;
    metadata?: Record<string, any>;
}

const getCurrentBalance = async (userId: string): Promise<number> => {
    const lastTx = await ZamesTransactionModel.findOne({ userId })
        .sort({ createdAt: -1 })
        .lean();
    return lastTx?.balanceAfter || 0;
};

const awardZames = async (params: AwardZamesParams) => {
    const { userId, quizAttemptId, quizId, points, source = ZamesSource.Quiz, metadata = {} } = params;

    if (points <= 0) {
        return { pointsEarned: 0, newBalance: await getCurrentBalance(userId) };
    }

    const balanceBefore = await getCurrentBalance(userId);
    const balanceAfter = balanceBefore + points;

    const quiz = await QuizModel.findById(quizId).lean();
    const attempt = await QuizAttemptModel.findById(quizAttemptId).lean();

    const tx = await ZamesTransactionModel.create({
        userId: userId as any,
        quizAttemptId: quizAttemptId as any,
        quizId: quizId as any,
        source: source || ZamesSource.Quiz,
        points,
        balanceBefore,
        balanceAfter,
        metadata: {
            ...metadata,
            quizTitle: quiz?.title,
            attemptNumber: attempt?.attemptNumber,
        },
    });

    await updateLeaderboardEntry(userId, quizId, points, attempt);

    return { pointsEarned: points, newBalance: balanceAfter, transaction: tx };
};

const updateLeaderboardEntry = async (
    userId: string,
    quizId: string,
    points: number,
    attempt: any
) => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const allTimeUpdate: Record<string, any> = {
        $inc: {
            totalZames: points,
            quizzesCompleted: 1,
            totalMarks: attempt?.earnedMarks || 0,
        },
        $set: { lastActive: now },
        $max: { averageScore: attempt?.percentage || 0 },
    };

    await LeaderboardEntryModel.findOneAndUpdate(
        { userId: userId as any, period: 'all_time' },
        { $setOnInsert: { userId: userId as any, period: 'all_time', month: null, year: null } },
        { upsert: true }
    );

    await LeaderboardEntryModel.findOneAndUpdate(
        { userId: userId as any, period: 'all_time' },
        allTimeUpdate
    );

    await LeaderboardEntryModel.findOneAndUpdate(
        {
            userId: userId as any,
            period: 'monthly',
            month,
            year,
        },
        {
            $setOnInsert: {
                userId: userId as any,
                period: 'monthly',
                month,
                year,
            },
        },
        { upsert: true }
    );

    await LeaderboardEntryModel.findOneAndUpdate(
        {
            userId: userId as any,
            period: 'monthly',
            month,
            year,
        },
        allTimeUpdate
    );
};

const getStats = async (userId: string) => {
    const balance = await getCurrentBalance(userId);
    const [leaderboardEntry, attempts] = await Promise.all([
        LeaderboardEntryModel.findOne({ userId: userId as any, period: 'all_time' }).lean(),
        QuizAttemptModel.find({ userId: userId as any, status: 'completed' })
            .sort({ createdAt: -1 })
            .lean(),
    ]);

    const completedCount = attempts.length;
    const totalMarks = attempts.reduce((sum, a) => sum + a.earnedMarks, 0);
    const totalPossible = attempts.reduce((sum, a) => sum + a.totalMarks, 0);
    const averageScore = completedCount > 0 ? Math.round(totalMarks / completedCount) : 0;
    const highestScore = completedCount > 0 ? Math.max(...attempts.map(a => a.percentage)) : 0;

    const recentAttempts = attempts.slice(0, 5).map(a => ({
        attemptId: a._id,
        quizId: a.quizId,
        percentage: a.percentage,
        earnedMarks: a.earnedMarks,
        totalMarks: a.totalMarks,
        passed: a.passed,
        submittedAt: a.submittedAt,
    }));

    return {
        totalZames: balance,
        quizzesCompleted: completedCount,
        averageScore,
        highestScore,
        totalMarks,
        recentAttempts,
        currentRank: leaderboardEntry?.rank || null,
    };
};

const getTransactionHistory = async (userId: string, page = 1, limit = 20) => {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
        ZamesTransactionModel.find({ userId: userId as any })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ZamesTransactionModel.countDocuments({ userId: userId as any }),
    ]);

    return {
        data,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};

export const GamificationService = {
    awardZames,
    getStats,
    getTransactionHistory,
    getCurrentBalance,
};
