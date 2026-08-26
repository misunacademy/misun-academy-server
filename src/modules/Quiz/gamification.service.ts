import { ZamesTransactionModel } from './zames.model.js';
import { LeaderboardEntryModel } from './leaderboard.model.js';
import { QuizModel } from './quiz.model.js';
import { QuizAttemptModel } from './attempt.model.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import { ZamesSource } from '../../types/common.js';
import { LeaderboardService } from './leaderboard.service.js';

interface AwardZamesParams {
    userId: string;
    quizAttemptId: string;
    quizId: string;
    points: number;
    source?: ZamesSource;
    metadata?: Record<string, any>;
}

const getCurrentBalance = async (userId: string, courseId?: string, batchId?: string): Promise<number> => {
    const filter: Record<string, any> = { userId: userId as any };
    if (courseId) filter.courseId = courseId as any;
    if (batchId) filter.batchId = batchId as any;

    const lastTx = await ZamesTransactionModel.findOne(filter)
        .sort({ createdAt: -1 })
        .lean();
    return lastTx?.balanceAfter || 0;
};

const awardZames = async (params: AwardZamesParams) => {
    const { userId, quizAttemptId, quizId, points, source = ZamesSource.Quiz, metadata = {} } = params;

    if (points <= 0) {
        return { pointsEarned: 0, newBalance: await getCurrentBalance(userId) };
    }

    const quiz = await QuizModel.findById(quizId).lean();
    const attempt = await QuizAttemptModel.findById(quizAttemptId).lean();

    let courseId: string | undefined;
    let batchId: string | undefined;
    if (attempt?.enrollmentId) {
        const enrollment = await EnrollmentModel.findById(attempt.enrollmentId)
            .populate<{ batchId: { _id: any; courseId: any } }>('batchId')
            .lean();
        if (enrollment) {
            batchId = enrollment.batchId?._id?.toString();
            courseId = (enrollment.batchId as any)?.courseId?.toString();
        }
    }

    const balanceBefore = await getCurrentBalance(userId, courseId, batchId);
    const balanceAfter = balanceBefore + points;

    let tx;
    try {
        tx = await ZamesTransactionModel.create({
            userId: userId as any,
            courseId: courseId as any,
            batchId: batchId as any,
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
    } catch (error: any) {
        if (error?.code === 11000) {
            return { pointsEarned: 0, newBalance: balanceBefore, transaction: null };
        }
        throw error;
    }

    await updateLeaderboardEntry(userId, quizId, points, attempt, courseId, batchId);

    return { pointsEarned: points, newBalance: balanceAfter, transaction: tx };
};

const updateLeaderboardEntry = async (
    userId: string,
    quizId: string,
    points: number,
    attempt: any,
    courseId?: string,
    batchId?: string
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

    const allTimeFilter: Record<string, any> = {
        userId: userId as any,
        period: 'all_time',
    };
    const monthlyFilter: Record<string, any> = {
        userId: userId as any,
        period: 'monthly',
        month,
        year,
    };

    if (batchId) {
        allTimeFilter.batchId = batchId as any;
        monthlyFilter.batchId = batchId as any;
    }
    if (courseId) {
        allTimeFilter.courseId = courseId as any;
        monthlyFilter.courseId = courseId as any;
    }

    await LeaderboardEntryModel.findOneAndUpdate(
        allTimeFilter,
        allTimeUpdate,
        { upsert: true }
    );

    await LeaderboardEntryModel.findOneAndUpdate(
        monthlyFilter,
        allTimeUpdate,
        { upsert: true }
    );
};

const getStats = async (userId: string, courseId?: string, batchId?: string) => {
    let completedAttempts: any[] = [];

    if (courseId && batchId) {
        const enrollment = await EnrollmentModel.findOne({
            userId: userId as any,
            batchId: batchId as any,
        }).lean();

        if (enrollment) {
            completedAttempts = await QuizAttemptModel.find({
                enrollmentId: enrollment._id,
                status: 'completed',
            })
                .sort({ createdAt: -1 })
                .lean();
        }
    } else {
        completedAttempts = await QuizAttemptModel.find({ userId: userId as any, status: 'completed' })
            .sort({ createdAt: -1 })
            .lean();
    }

    const totalZames = completedAttempts.reduce((sum, a) => sum + (a.zamesEarned || 0), 0);
    const completedCount = completedAttempts.length;
    const totalMarks = completedAttempts.reduce((sum, a) => sum + a.earnedMarks, 0);
    const averageScore = completedCount > 0 ? Math.round(totalMarks / completedCount) : 0;
    const highestScore = completedCount > 0 ? Math.max(...completedAttempts.map(a => a.percentage)) : 0;

    const recentAttempts = completedAttempts.slice(0, 5).map(a => ({
        attemptId: a._id,
        quizId: a.quizId,
        percentage: a.percentage,
        earnedMarks: a.earnedMarks,
        totalMarks: a.totalMarks,
        passed: a.passed,
        submittedAt: a.submittedAt,
    }));

    let currentRank: number | null = null;
    try {
        const rankResult = await LeaderboardService.getUserRank(userId, "all_time", courseId, batchId);
        currentRank = rankResult?.rank || null;
    } catch {
        // rank lookup is best-effort; keep null
    }

    return {
        totalZames,
        quizzesCompleted: completedCount,
        averageScore,
        highestScore,
        totalMarks,
        recentAttempts,
        currentRank,
    };
};

const getTransactionHistory = async (userId: string, courseId?: string, batchId?: string, page = 1, limit = 20) => {
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = { userId: userId as any };
    if (courseId) filter.courseId = courseId as any;
    if (batchId) filter.batchId = batchId as any;

    const [data, total] = await Promise.all([
        ZamesTransactionModel.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ZamesTransactionModel.countDocuments(filter),
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
