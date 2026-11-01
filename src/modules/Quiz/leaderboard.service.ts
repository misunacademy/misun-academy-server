import { LeaderboardEntryModel } from './leaderboard.model.js';

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

    // Clamp pagination: unbounded limits turn a ranking read into a full
    // collection scan + user-table join.
    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const safeLimit = Math.min(100, Math.max(1, Math.floor(Number(limit) || 50)));

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
    }

    const skip = (safePage - 1) * safeLimit;

    if (type === 'global') {
        const [entries, total] = await Promise.all([
            LeaderboardEntryModel.aggregate([
                { $match: matchFilter },
                {
                    $group: {
                        _id: '$userId',
                        totalZames: { $sum: '$totalZames' },
                        quizzesCompleted: { $sum: '$quizzesCompleted' },
                        totalMarks: { $sum: '$totalMarks' },
                        averageScore: { $max: '$averageScore' },
                        lastActive: { $max: '$lastActive' },
                    },
                },
                { $sort: { totalZames: -1 } },
                { $skip: skip },
                { $limit: safeLimit },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'user',
                    },
                },
                { $unwind: '$user' },
                {
                    $project: {
                        _id: 0,
                        userId: {
                            _id: '$_id',
                            name: '$user.name',
                                                        avatar: '$user.avatar',
                            image: '$user.image',
                        },
                        totalZames: 1,
                        quizzesCompleted: 1,
                        averageScore: 1,
                        totalMarks: 1,
                        lastActive: 1,
                    },
                },
            ]),
            LeaderboardEntryModel.aggregate([
                { $match: matchFilter },
                { $group: { _id: '$userId' } },
                { $count: 'total' },
            ]),
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
                page: safePage,
                limit: safeLimit,
                total: total[0]?.total || 0,
                totalPages: Math.ceil((total[0]?.total || 0) / safeLimit),
            },
        };
    }

    const [entries, total] = await Promise.all([
        LeaderboardEntryModel.find(matchFilter)
            .sort({ totalZames: -1 })
            .skip(skip)
            .limit(safeLimit)
            .populate<{ userId: LeaderboardUser }>('userId', 'name avatar image')
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
            page: safePage,
            limit: safeLimit,
            total,
            totalPages: Math.ceil(total / safeLimit),
        },
    };
};

const getUserRank = async (
    userId: string,
    period: 'all_time' | 'monthly' = 'all_time',
    courseId?: string,
    batchId?: string
) => {
    const filter: Record<string, any> = { userId: userId as any, period };
    if (courseId) filter.courseId = courseId as any;
    if (batchId) filter.batchId = batchId as any;

    const entry = await LeaderboardEntryModel.findOne(filter).lean();

    if (!entry) {
        return null;
    }

    const countFilter: Record<string, any> = { period, totalZames: { $gt: entry.totalZames } };
    if (courseId) countFilter.courseId = courseId as any;
    if (batchId) countFilter.batchId = batchId as any;

    const rank = await LeaderboardEntryModel.countDocuments(countFilter);

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
