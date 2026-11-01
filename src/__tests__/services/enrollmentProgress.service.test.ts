import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
    createUser,
    createAdmin,
    createCourse,
    createBatch,
    createEnrollment,
    createActiveEnrollment,
    createModule,
} from '../helpers/factories.js';
import {
    initializeModuleProgress,
    getUserEnrollments,
    getEnrollmentDetails,
} from '../../modules/Enrollment/enrollmentProgress.service.js';
import { ModuleProgressModel } from '../../modules/Progress/moduleProgress.model.js';
import { EnrollmentStatus, ProgressStatus } from '../../types/common.js';

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const year = new Date().getFullYear();

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

describe('initializeModuleProgress — first unlocked, rest locked', () => {
    it('unlocks the first module and locks the rest in order', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        const m2 = await createModule(course._id, batch._id, 2);
        const m3 = await createModule(course._id, batch._id, 3);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        await initializeModuleProgress(enrollment._id.toString());

        const progress = await ModuleProgressModel.find({ enrollmentId: enrollment._id }).lean();
        expect(progress).toHaveLength(3);

        const byModule = new Map(progress.map((p: any) => [p.moduleId.toString(), p]));
        expect(byModule.get(m1._id.toString())?.status).toBe(ProgressStatus.Unlocked);
        expect(byModule.get(m2._id.toString())?.status).toBe(ProgressStatus.Locked);
        expect(byModule.get(m3._id.toString())?.status).toBe(ProgressStatus.Locked);

        // first module records an unlock timestamp, locked ones do not
        expect(byModule.get(m1._id.toString())?.unlockedAt).toBeDefined();
        expect(byModule.get(m2._id.toString())?.unlockedAt).toBeUndefined();
    });

    it('unlocks a single-module course', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        await initializeModuleProgress(enrollment._id.toString());

        const progress = await ModuleProgressModel.findOne({ enrollmentId: enrollment._id, moduleId: m1._id }).lean();
        expect(progress?.status).toBe(ProgressStatus.Unlocked);
    });

    it('unlocks every module for recorded / evergreen batches', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id, { deliveryMode: 'recorded' });
        await createModule(course._id, batch._id, 1);
        await createModule(course._id, batch._id, 2);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        await initializeModuleProgress(enrollment._id.toString());

        const progress = await ModuleProgressModel.find({ enrollmentId: enrollment._id }).lean();
        expect(progress).toHaveLength(2);
        for (const p of progress) {
            expect(p.status).toBe(ProgressStatus.Unlocked);
            expect(p.unlockedAt).toBeDefined();
        }
    });

    it('unlocks every module for evergreen batches', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id, { isEvergreen: true });
        await createModule(course._id, batch._id, 1);
        await createModule(course._id, batch._id, 2);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        await initializeModuleProgress(enrollment._id.toString());

        const statuses = (await ModuleProgressModel.find({ enrollmentId: enrollment._id }).lean()).map((p) => p.status);
        expect(statuses).toEqual([ProgressStatus.Unlocked, ProgressStatus.Unlocked]);
    });

    it('is idempotent — a second call does not duplicate progress', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        await createModule(course._id, batch._id, 1);
        await createModule(course._id, batch._id, 2);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        await initializeModuleProgress(enrollment._id.toString());
        await initializeModuleProgress(enrollment._id.toString());

        expect(await ModuleProgressModel.countDocuments({ enrollmentId: enrollment._id })).toBe(2);
    });

    it('returns null when the enrollment does not exist', async () => {
        const result = await initializeModuleProgress(new mongoose.Types.ObjectId().toString());
        expect(result).toBeNull();
    });

    it('returns null when the batch has no modules', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        const result = await initializeModuleProgress(enrollment._id.toString());

        expect(result).toBeNull();
        expect(await ModuleProgressModel.countDocuments({ enrollmentId: enrollment._id })).toBe(0);
    });

    it('isolates progress between learners in the same batch', async () => {
        const user1 = await createUser({ email: `ep1-${uniq()}@example.com` });
        const user2 = await createUser({ email: `ep2-${uniq()}@example.com` });
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        await createModule(course._id, batch._id, 1);
        const e1 = await createEnrollment(user1._id, batch._id, {
            status: EnrollmentStatus.Active, enrollmentId: `MA-1${year}00011`, enrolledAt: new Date(),
        });
        const e2 = await createEnrollment(user2._id, batch._id, {
            status: EnrollmentStatus.Active, enrollmentId: `MA-1${year}00012`, enrolledAt: new Date(),
        });

        await initializeModuleProgress(e1._id.toString());

        expect(await ModuleProgressModel.countDocuments({ enrollmentId: e1._id })).toBe(1);
        expect(await ModuleProgressModel.countDocuments({ enrollmentId: e2._id })).toBe(0);
    });
});

describe('getUserEnrollments — progress aggregation', () => {
    it('aggregates total/completed modules and overall progress', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        await createModule(course._id, batch._id, 2);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        await initializeModuleProgress(enrollment._id.toString());
        await ModuleProgressModel.updateOne(
            { enrollmentId: enrollment._id, moduleId: m1._id },
            { status: ProgressStatus.Completed, completionPercentage: 100 }
        );

        const enrollments = await getUserEnrollments(user._id.toString());

        expect(enrollments).toHaveLength(1);
        expect(enrollments[0].progress.totalModules).toBe(2);
        expect(enrollments[0].progress.completedModules).toBe(1);
        expect(enrollments[0].progress.overallProgress).toBe(50);
    });

    it('filters by enrollment status', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        await createActiveEnrollment(user._id, batch._id);

        const active = await getUserEnrollments(user._id.toString(), EnrollmentStatus.Active);
        const pending = await getUserEnrollments(user._id.toString(), EnrollmentStatus.Pending);

        expect(active).toHaveLength(1);
        expect(pending).toHaveLength(0);
    });

    it('returns empty for a user with no enrollments', async () => {
        const user = await createUser();
        expect(await getUserEnrollments(user._id.toString())).toEqual([]);
    });
});

describe('getEnrollmentDetails', () => {
    it('returns enrollment with per-module progress attached', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        await createModule(course._id, batch._id, 2);
        const enrollment = await createActiveEnrollment(user._id, batch._id);
        await initializeModuleProgress(enrollment._id.toString());

        const details = await getEnrollmentDetails(enrollment._id.toString(), user._id.toString());

        expect(details.modules).toHaveLength(2);
        expect(details.progress.totalModules).toBe(2);
        const withProgress = details.modules.find((m: any) => m._id.toString() === m1._id.toString());
        expect(withProgress.progress).not.toBeNull();
        expect(withProgress.progress.status).toBe(ProgressStatus.Unlocked);
    });

    it('throws NOT_FOUND for another user’s enrollment', async () => {
        const user = await createUser();
        const other = await createUser({ email: `other-${uniq()}@example.com` });
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        await expect(
            getEnrollmentDetails(enrollment._id.toString(), other._id.toString())
        ).rejects.toThrow(/not found/i);
    });

    it('throws NOT_FOUND for a nonexistent enrollment', async () => {
        const user = await createUser();
        await expect(
            getEnrollmentDetails(new mongoose.Types.ObjectId().toString(), user._id.toString())
        ).rejects.toThrow(/not found/i);
    });
});

describe('initializeModuleProgress — backfill', () => {
    it('backfills modules added after a partial initialization', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        await createModule(course._id, batch._id, 2);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        await initializeModuleProgress(enrollment._id.toString());
        // Simulate a half-completed init: only the first row exists.
        const rows = await ModuleProgressModel.find({ enrollmentId: enrollment._id }).lean();
        expect(rows).toHaveLength(2);
        await ModuleProgressModel.deleteOne({ enrollmentId: enrollment._id, moduleId: rows[1].moduleId });

        await initializeModuleProgress(enrollment._id.toString());

        const healed = await ModuleProgressModel.find({ enrollmentId: enrollment._id }).lean();
        expect(healed).toHaveLength(2);
        const byModule = new Map(healed.map((p: any) => [p.moduleId.toString(), p.status]));
        expect(byModule.get(m1._id.toString())).toBe(ProgressStatus.Unlocked);
    });

    it('unlocks a backfilled module when all predecessors are completed', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const m1 = await createModule(course._id, batch._id, 1);
        const enrollment = await createActiveEnrollment(user._id, batch._id);

        await initializeModuleProgress(enrollment._id.toString());
        await ModuleProgressModel.updateOne(
            { enrollmentId: enrollment._id, moduleId: m1._id },
            { $set: { status: ProgressStatus.Completed, completionPercentage: 100 } }
        );

        const m2 = await createModule(course._id, batch._id, 2);
        await initializeModuleProgress(enrollment._id.toString());

        const row = await ModuleProgressModel.findOne({ enrollmentId: enrollment._id, moduleId: m2._id }).lean();
        expect(row?.status).toBe(ProgressStatus.Unlocked);
    });
});
