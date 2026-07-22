import { StatusCodes } from 'http-status-codes';
import { LeaderboardEntryModel } from './leaderboard.model.js';
import ApiError from '../../errors/ApiError.js';

interface LeaderboardUser {
    _id: string;
    name: string;
    email: string;
    avatar?: string;
    image?: string;
}

interface LeaderboardQuery {
    type: 'global' | 'course' | 'batch';
    referenceId?: string;
    period?: 'all_time' | 'monthly';
    month?: number;
    year?: number;
    page?: number;
    limit?: number;
}

const getLeaderboard = async (query: LeaderboardQuery) => {
    const {
        type = 'global',
        referenceId,
        period = 'all_time',
        month,
        year,
        page = 1,
        limit = 50,
    } = query;

    const matchFilter: Record<string, any> = { period };

    if (period === 'monthly') {
        const now = new Date();
        matchFilter.month = month || now.getMonth() + 1;
        matchFilter.year = year || now.getFullYear();
    }

    if (type === 'course' && referenceId) {
        matchFilter.courseId = referenceId as any;
    } else if (type === 'batch' && referenceId) {
        matchFilter.batchId = referenceId as any;
    } else if (type === 'global') {
    }

    const skip = (page - 1) * limit;

    const [entries, total] = await Promise.all([
        LeaderboardEntryModel.find(matchFilter)
            .sort({ totalZames: -1 })
            .skip(skip)
            .limit(limit)
            .populate<{ userId: LeaderboardUser }>('userId', 'name email avatar image')
            .lean(),
        LeaderboardEntryModel.countDocuments(matchFilter),
    ]);

    const rankedEntries = entries.map((entry, index) => ({
        rank: skip + index + 1,
        userId: entry.userId,
        totalZames: entry.totalZames,
        quizzesCompleted: entry.quizzesCompleted,
        averageScore: entry.averageScore,
        totalMarks: entry.totalMarks,
        lastActive: entry.lastActive,
    }));

    return {
        data: rankedEntries,
        meta: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};

const getUserRank = async (userId: string, period: 'all_time' | 'monthly' = 'all_time') => {
    const entry = await LeaderboardEntryModel.findOne({
        userId: userId as any,
        period,
    }).lean();

    if (!entry) {
        return null;
    }

    const rank = await LeaderboardEntryModel.countDocuments({
        period,
        totalZames: { $gt: entry.totalZames },
    });

    return {
        rank: rank + 1,
        totalZames: entry.totalZames,
        quizzesCompleted: entry.quizzesCompleted,
        averageScore: entry.averageScore,
    };
};

export const LeaderboardService = {
    getLeaderboard,
    getUserRank,
};
