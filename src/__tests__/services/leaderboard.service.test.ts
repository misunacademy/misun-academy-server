import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
    createUser,
    createAdmin,
    createCourse,
    createBatch,
} from '../helpers/factories.js';
import { LeaderboardEntryModel } from '../../modules/Quiz/leaderboard.model.js';
import { LeaderboardService } from '../../modules/Quiz/leaderboard.service.js';

const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

const addEntry = (userId: unknown, overrides: Record<string, unknown> = {}) =>
    LeaderboardEntryModel.create({
        userId,
        period: 'all_time',
        totalZames: 0,
        quizzesCompleted: 0,
        averageScore: 0,
        totalMarks: 0,
        lastActive: new Date(),
        ...overrides,
    } as any);

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

describe('LeaderboardService.getLeaderboard (global)', () => {
    it('returns an empty ranking with zero totals', async () => {
        const result = await LeaderboardService.getLeaderboard({ type: 'global' });
        expect(result.data).toHaveLength(0);
        expect(result.meta).toMatchObject({ page: 1, total: 0, totalPages: 0 });
    });

    it('ranks users by totalZames descending with 1-based ranks', async () => {
        const [u1, u2, u3] = await Promise.all([
            createUser({ email: `a-${uid()}@example.com` }),
            createUser({ email: `b-${uid()}@example.com` }),
            createUser({ email: `c-${uid()}@example.com` }),
        ]);
        await addEntry(u1._id, { totalZames: 30, quizzesCompleted: 3 });
        await addEntry(u2._id, { totalZames: 100, quizzesCompleted: 5 });
        await addEntry(u3._id, { totalZames: 60, quizzesCompleted: 2 });

        const result = await LeaderboardService.getLeaderboard({ type: 'global' });
        expect(result.data).toHaveLength(3);
        expect(result.data.map((e) => e.totalZames)).toEqual([100, 60, 30]);
        expect(result.data.map((e) => e.rank)).toEqual([1, 2, 3]);
        expect((result.data[0].userId as any).email).toBe(u2.email);
        expect(result.meta.total).toBe(3);
    });

    it('aggregates multiple entries of the same user globally', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        await addEntry(user._id, { totalZames: 40, quizzesCompleted: 1 });
        await addEntry(user._id, { totalZames: 20, quizzesCompleted: 2 });

        const result = await LeaderboardService.getLeaderboard({ type: 'global' });
        expect(result.data).toHaveLength(1);
        expect(result.data[0].totalZames).toBe(60);
        expect(result.data[0].quizzesCompleted).toBe(3);
    });

    it('paginates with correct rank offsets', async () => {
        const users = await Promise.all(
            [1, 2, 3].map((n) => createUser({ email: `p${n}-${uid()}@example.com` }))
        );
        await addEntry(users[0]._id, { totalZames: 30 });
        await addEntry(users[1]._id, { totalZames: 20 });
        await addEntry(users[2]._id, { totalZames: 10 });

        const page2 = await LeaderboardService.getLeaderboard({ type: 'global', page: 2, limit: 1 });
        expect(page2.data).toHaveLength(1);
        expect(page2.data[0].rank).toBe(2);
        expect(page2.data[0].totalZames).toBe(20);
        expect(page2.meta).toMatchObject({ page: 2, limit: 1, total: 3, totalPages: 3 });
    });
});

describe('LeaderboardService.getLeaderboard (scoped)', () => {
    it('filters batch leaderboards by referenceId', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const course = await createCourse(admin._id, { title: `Course ${uid()}`, slug: `course-${uid()}` });
        const batchA = await createBatch(course._id, { batchNumber: 11, title: 'Batch A' });
        const batchB = await createBatch(course._id, { batchNumber: 12, title: 'Batch B' });
        const [u1, u2] = await Promise.all([
            createUser({ email: `a-${uid()}@example.com` }),
            createUser({ email: `b-${uid()}@example.com` }),
        ]);
        await addEntry(u1._id, { totalZames: 50, batchId: batchA._id });
        await addEntry(u2._id, { totalZames: 90, batchId: batchB._id });

        const onlyA = await LeaderboardService.getLeaderboard({ type: 'batch', referenceId: batchA._id.toString() });
        expect(onlyA.data).toHaveLength(1);
        expect(onlyA.data[0].totalZames).toBe(50);
        expect((onlyA.data[0].userId as any).email).toBe(u1.email);
    });

    it('filters course leaderboards by referenceId', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const courseA = await createCourse(admin._id, { title: `CA ${uid()}`, slug: `ca-${uid()}` });
        const courseB = await createCourse(admin._id, { title: `CB ${uid()}`, slug: `cb-${uid()}` });
        const user = await createUser({ email: `u-${uid()}@example.com` });
        await addEntry(user._id, { totalZames: 10, courseId: courseA._id });
        await addEntry(user._id, { totalZames: 40, courseId: courseB._id });

        const onlyB = await LeaderboardService.getLeaderboard({ type: 'course', referenceId: courseB._id.toString() });
        expect(onlyB.data).toHaveLength(1);
        expect(onlyB.data[0].totalZames).toBe(40);
    });

    it('isolates monthly entries by month and year', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        const now = new Date();
        const thisMonth = now.getMonth() + 1;
        const thisYear = now.getFullYear();
        await addEntry(user._id, { period: 'monthly', month: thisMonth, year: thisYear, totalZames: 70 });
        await addEntry(user._id, { period: 'monthly', month: 1, year: 2000, totalZames: 999 });

        const current = await LeaderboardService.getLeaderboard({ type: 'global', period: 'monthly' });
        expect(current.data).toHaveLength(1);
        expect(current.data[0].totalZames).toBe(70);
    });
});

describe('LeaderboardService.getUserRank', () => {
    it('returns null when the user has no entry', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        expect(await LeaderboardService.getUserRank(user._id.toString())).toBeNull();
    });

    it('ranks the top scorer first and others below', async () => {
        const [top, mid] = await Promise.all([
            createUser({ email: `top-${uid()}@example.com` }),
            createUser({ email: `mid-${uid()}@example.com` }),
        ]);
        await addEntry(top._id, { totalZames: 200, quizzesCompleted: 4, averageScore: 90 });
        await addEntry(mid._id, { totalZames: 50, quizzesCompleted: 2, averageScore: 60 });

        const topRank = await LeaderboardService.getUserRank(top._id.toString());
        expect(topRank?.rank).toBe(1);
        expect(topRank?.totalZames).toBe(200);

        const midRank = await LeaderboardService.getUserRank(mid._id.toString());
        expect(midRank?.rank).toBe(2);
        expect(midRank?.quizzesCompleted).toBe(2);
    });

    it('scopes rank to a batch', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const course = await createCourse(admin._id, { title: `Course ${uid()}`, slug: `course-${uid()}` });
        const batch = await createBatch(course._id);
        const [u1, u2] = await Promise.all([
            createUser({ email: `a-${uid()}@example.com` }),
            createUser({ email: `b-${uid()}@example.com` }),
        ]);
        await addEntry(u1._id, { totalZames: 10, batchId: batch._id });
        await addEntry(u2._id, { totalZames: 80, batchId: batch._id });
        // global heavyweight outside the batch must not affect batch rank
        const outsider = await createUser({ email: `out-${uid()}@example.com` });
        await addEntry(outsider._id, { totalZames: 1000 });

        const rank = await LeaderboardService.getUserRank(u1._id.toString(), 'all_time', undefined, batch._id.toString());
        expect(rank?.rank).toBe(2);
    });
});
