import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch } from '../helpers/factories.js';
import { AdminService } from '../../modules/Admin/admin.service.js';
import { UserModel } from '../../modules/User/user.model.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { EnrollmentStatusHistoryModel } from '../../modules/Enrollment/enrollmentStatusHistory.model.js';
import { AuditLogModel } from '../../models/auditLog.model.js';
import { EnrollmentStatus, UserStatus } from '../../types/common.js';

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

const createEnrollmentWithId = async (userId: any, batchId: any, overrides: Record<string, unknown> = {}) =>
    EnrollmentModel.create({
        userId,
        batchId,
        status: EnrollmentStatus.Active,
        enrollmentId: `MA-${uniq()}`,
        enrolledAt: new Date(),
        ...overrides,
    });

describe('AdminService.getAllUsers', () => {
    it('paginates with meta', async () => {
        await createUser({ email: `u1-${uniq()}@example.com` });
        await createUser({ email: `u2-${uniq()}@example.com` });
        await createUser({ email: `u3-${uniq()}@example.com` });

        const result = await AdminService.getAllUsers({ page: 1, limit: 2 });

        expect(result.data).toHaveLength(2);
        expect(result.meta.total).toBe(3);
        expect(result.meta.page).toBe(1);
        expect(result.meta.limit).toBe(2);
        expect(result.meta.totalPages).toBe(2);
        // password must not leak
        expect((result.data[0] as any).password).toBeUndefined();
    });

    it('filters by role and status', async () => {
        await createUser({ email: `r-${uniq()}@example.com`, role: 'instructor' });
        await createUser({ email: `s-${uniq()}@example.com`, status: UserStatus.Suspended });

        const byRole = await AdminService.getAllUsers({ role: 'instructor' });
        expect(byRole.meta.total).toBe(1);
        expect(byRole.data[0].role).toBe('instructor');

        const byStatus = await AdminService.getAllUsers({ status: UserStatus.Suspended });
        expect(byStatus.meta.total).toBe(1);
    });

    it('searches by name and email', async () => {
        await createUser({ email: `needle-${uniq()}@example.com`, name: 'Needle Haystack' });
        await createUser({ email: `other-${uniq()}@example.com`, name: 'Someone Else' });

        const result = await AdminService.getAllUsers({ search: 'needle' });
        expect(result.meta.total).toBe(1);
        expect(result.data[0].name).toBe('Needle Haystack');
    });

    it('attaches enrollment info (enrolledBatches/isEnrolled)', async () => {
        const admin = await createAdmin({ role: 'superadmin' });
        const user = await createUser({ email: `enr-${uniq()}@example.com` });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id, { title: `Enrolled Batch ${uniq()}` });
        await createEnrollmentWithId(user._id, batch._id);

        const result = await AdminService.getAllUsers({ search: user.email });
        expect(result.data[0].isEnrolled).toBe(true);
        expect(result.data[0].enrolledBatches.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by batch title and by batch id', async () => {
        const admin = await createAdmin({ role: 'superadmin' });
        const user = await createUser({ email: `enr-${uniq()}@example.com` });
        const outsider = await createUser({ email: `out-${uniq()}@example.com` });
        const course = await createCourse(admin._id);
        const batchTitle = `Special Batch ${uniq()}`;
        const batch = await createBatch(course._id, { title: batchTitle });
        await createEnrollmentWithId(user._id, batch._id);

        const byTitle = await AdminService.getAllUsers({ batch: batchTitle });
        const emails = byTitle.data.map((u: any) => u.email);
        expect(emails).toContain(user.email);
        expect(emails).not.toContain(outsider.email);

        const byId = await AdminService.getAllUsers({ batch: batch._id.toString() });
        expect(byId.data.map((u: any) => u.email)).toContain(user.email);
    });

    it('returns empty result for an unknown batch title', async () => {
        await createUser({ email: `u-${uniq()}@example.com` });
        const result = await AdminService.getAllUsers({ batch: 'no such batch title xyz' });
        expect(result.data).toEqual([]);
        expect(result.meta.total).toBe(0);
    });

    it('filters enrolled=true / enrolled=false', async () => {
        const admin = await createAdmin({ role: 'superadmin' });
        const enrolled = await createUser({ email: `enr-${uniq()}@example.com` });
        const unenrolled = await createUser({ email: `unenr-${uniq()}@example.com` });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        await createEnrollmentWithId(enrolled._id, batch._id);

        const yes = await AdminService.getAllUsers({ enrolled: 'true' });
        expect(yes.data.map((u: any) => u.email)).toContain(enrolled.email);
        expect(yes.data.map((u: any) => u.email)).not.toContain(unenrolled.email);

        const no = await AdminService.getAllUsers({ enrolled: 'false' });
        expect(no.data.map((u: any) => u.email)).toContain(unenrolled.email);
        expect(no.data.map((u: any) => u.email)).not.toContain(enrolled.email);
    });
});

describe('AdminService.getUserById', () => {
    it('returns the user without password', async () => {
        const user = await createUser({ email: `u-${uniq()}@example.com` });
        const found: any = await AdminService.getUserById(user._id.toString());
        expect(found.email).toBe(user.email);
        expect(found.password).toBeUndefined();
    });

    it('throws NOT_FOUND for unknown id', async () => {
        await expect(
            AdminService.getUserById(new mongoose.Types.ObjectId().toString())
        ).rejects.toThrow(/User not found/i);
    });
});

describe('AdminService.updateUser / updateUserStatus / deleteUser', () => {
    it('updateUser applies changes and audits role changes', async () => {
        const actor = await createUser({ email: `actor-${uniq()}@example.com`, role: 'superadmin' });
        const user = await createUser({ email: `u-${uniq()}@example.com`, role: 'learner' });

        const updated: any = await AdminService.updateUser(
            user._id.toString(),
            { role: 'instructor', name: 'Promoted' },
            { id: actor._id.toString(), role: 'superadmin' }
        );

        expect(updated.role).toBe('instructor');
        expect(updated.name).toBe('Promoted');

        const audit = await AuditLogModel.findOne({ action: 'user.role_change' }).lean();
        expect(audit).toBeDefined();
        expect((audit?.metadata as any)?.to).toBe('instructor');
    });

    it('updateUser rejects role changes by non-superadmins', async () => {
        const actor = await createUser({ email: `actor-${uniq()}@example.com`, role: 'admin' });
        const user = await createUser({ email: `u-${uniq()}@example.com`, role: 'learner' });

        await expect(
            AdminService.updateUser(
                user._id.toString(),
                { role: 'instructor' },
                { id: actor._id.toString(), role: 'admin' }
            )
        ).rejects.toThrow(/Only superadmins can change user roles/i);
    });

    it('updateUser rejects self role changes', async () => {
        const actor = await createUser({ email: `actor-${uniq()}@example.com`, role: 'superadmin' });

        await expect(
            AdminService.updateUser(
                actor._id.toString(),
                { role: 'admin' },
                { id: actor._id.toString(), role: 'superadmin' }
            )
        ).rejects.toThrow(/own role/i);
    });

    it('updateUser throws NOT_FOUND for unknown id', async () => {
        await expect(
            AdminService.updateUser(new mongoose.Types.ObjectId().toString(), { name: 'x' })
        ).rejects.toThrow(/User not found/i);
    });

    it('updateUserStatus suspends user + enrollments and audits', async () => {
        const admin = await createAdmin({ role: 'superadmin' });
        const user = await createUser({ email: `u-${uniq()}@example.com` });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollmentWithId(user._id, batch._id);

        const updated: any = await AdminService.updateUserStatus(
            user._id.toString(),
            UserStatus.Suspended,
            admin._id.toString()
        );

        expect(updated.status).toBe(UserStatus.Suspended);
        const enr = await EnrollmentModel.findById(enrollment._id).lean();
        expect(enr?.status).toBe(EnrollmentStatus.Suspended);
        const audit = await AuditLogModel.findOne({ action: 'user.status_change' }).lean();
        expect(audit).toBeDefined();
    });

    it('updateUserStatus reactivates suspended enrollments', async () => {
        const user = await createUser({ email: `u-${uniq()}@example.com` });
        const admin = await createAdmin({ role: 'superadmin' });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollmentWithId(user._id, batch._id);

        await AdminService.updateUserStatus(user._id.toString(), UserStatus.Suspended);
        await AdminService.updateUserStatus(user._id.toString(), UserStatus.Active);

        const enr = await EnrollmentModel.findById(enrollment._id).lean();
        expect(enr?.status).toBe(EnrollmentStatus.Active);
    });

    it('updateUserStatus suspend writes enrollment status history', async () => {
        const admin = await createAdmin({ role: 'superadmin' });
        const user = await createUser({ email: `u-${uniq()}@example.com` });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollmentWithId(user._id, batch._id);

        await AdminService.updateUserStatus(
            user._id.toString(),
            UserStatus.Suspended,
            admin._id.toString()
        );

        const history = await EnrollmentStatusHistoryModel.find({
            enrollmentId: enrollment._id,
            to: EnrollmentStatus.Suspended,
        }).lean();

        expect(history.length).toBeGreaterThan(0);
        const row = history[0];
        expect(row.from).toBe(EnrollmentStatus.Active);
        expect(row.to).toBe(EnrollmentStatus.Suspended);
        expect(row.actorType).toBe('admin');
    });

    it('deleteUser writes enrollment status history for active enrollments', async () => {
        const actor = await createUser({ email: `actor-${uniq()}@example.com`, role: 'admin' });
        const user = await createUser({ email: `u-${uniq()}@example.com` });
        const admin = await createAdmin({ role: 'superadmin' });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        const enrollment = await createEnrollmentWithId(user._id, batch._id);

        await AdminService.deleteUser(user._id.toString(), actor._id.toString(), 'Test cleanup');

        const history = await EnrollmentStatusHistoryModel.find({
            enrollmentId: enrollment._id,
            to: EnrollmentStatus.Suspended,
        }).lean();

        expect(history.length).toBeGreaterThan(0);
        const row = history[0];
        expect(row.from).toBe(EnrollmentStatus.Active);
        expect(row.to).toBe(EnrollmentStatus.Suspended);
        expect(row.actorType).toBe('admin');
    });

    it('updateUserStatus with unchanged status returns without auditing', async () => {
        const user = await createUser({ email: `u-${uniq()}@example.com` });
        const updated: any = await AdminService.updateUserStatus(user._id.toString(), UserStatus.Active);
        expect(updated.status).toBe(UserStatus.Active);
        expect(await AuditLogModel.countDocuments({ action: 'user.status_change' })).toBe(0);
    });

    it('updateUserStatus throws NOT_FOUND for unknown id', async () => {
        await expect(
            AdminService.updateUserStatus(new mongoose.Types.ObjectId().toString(), UserStatus.Active)
        ).rejects.toThrow(/User not found/i);
    });

    it('deleteUser soft-deletes instead of hard-delete', async () => {
        const actor = await createUser({ email: `actor-${uniq()}@example.com`, role: 'admin' });
        const user = await createUser({ email: `u-${uniq()}@example.com` });

        await AdminService.deleteUser(user._id.toString(), actor._id.toString(), 'GDPR request');

        const softDeleted = await UserModel.findById(user._id).lean();
        expect(softDeleted).not.toBeNull();
        expect(softDeleted?.status).toBe(UserStatus.Deleted);
        expect(softDeleted?.deletedAt).toBeDefined();
        expect(softDeleted?.deletedBy).toBe(actor._id.toString());
        expect(softDeleted?.deletionReason).toBe('GDPR request');

        const audit = await AuditLogModel.findOne({ action: 'user.delete' }).lean();
        expect(audit).toBeDefined();
    });

    it('deleteUser requires deletionReason', async () => {
        const actor = await createUser({ email: `actor-${uniq()}@example.com`, role: 'admin' });
        const user = await createUser({ email: `u-${uniq()}@example.com` });

        await expect(
            AdminService.deleteUser(user._id.toString(), actor._id.toString())
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('deleteUser keeps user record queryable by userId for financial history', async () => {
        const actor = await createUser({ email: `actor-${uniq()}@example.com`, role: 'admin' });
        const user = await createUser({ email: `u-${uniq()}@example.com` });
        const admin = await createAdmin({ role: 'superadmin' });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        await createEnrollmentWithId(user._id, batch._id);

        await AdminService.deleteUser(user._id.toString(), actor._id.toString(), 'GDPR request');

        const userRecord = await UserModel.findById(user._id).lean();
        expect(userRecord?._id.toString()).toBe(user._id.toString());
        expect(userRecord?.status).toBe(UserStatus.Deleted);
    });

    it('deleteUser throws NOT_FOUND for unknown id', async () => {
        await expect(
            AdminService.deleteUser(new mongoose.Types.ObjectId().toString(), 'actor', 'cleanup')
        ).rejects.toThrow(/User not found/i);
    });

    describe('anonymizeUser (stage 2 data erasure)', () => {
        it('anonymizes PII for a soft-deleted user', async () => {
            const actor = await createUser({ email: `actor-${uniq()}@example.com`, role: 'admin' });
            const user = await createUser({ email: `u-${uniq()}@example.com` });

            await AdminService.deleteUser(user._id.toString(), actor._id.toString(), 'GDPR request');

            const anonymized = await AdminService.anonymizeUser(user._id.toString());

        expect(anonymized.email).toBe(`deleted+${user._id}@deleted.invalid`);
        expect(anonymized.name).toBe('Deleted User');
        expect(anonymized.phone).toBeUndefined();
        expect(anonymized.address).toBeUndefined();
        expect(anonymized.anonymizedAt).toBeDefined();

            const persisted = await UserModel.findById(user._id).lean();
            expect(persisted?.email).toBe(`deleted+${user._id}@deleted.invalid`);
            expect(persisted?.name).toBe('Deleted User');
            expect(persisted?.anonymizedAt).toBeDefined();
        });

        it('anonymizeUser throws if user is not soft-deleted', async () => {
            const user = await createUser({ email: `u-${uniq()}@example.com` });

            await expect(
                AdminService.anonymizeUser(user._id.toString())
            ).rejects.toMatchObject({ statusCode: 400 });
        });

        it('anonymizeUser removes OAuth account links', async () => {
            const actor = await createUser({ email: `actor-${uniq()}@example.com`, role: 'admin' });
            const user = await createUser({ email: `u-${uniq()}@example.com` });

            // Create an OAuth account link (Better Auth stores these in the 'account' collection)
            const db = mongoose.connection.db;
            if (db) {
                await db.collection('account').insertOne({
                    userId: user._id,
                    provider: 'google',
                    providerAccountId: 'google-12345',
                });
            }

            await AdminService.deleteUser(user._id.toString(), actor._id.toString(), 'GDPR request');
            await AdminService.anonymizeUser(user._id.toString());

            const oauthLinks = db ? await db.collection('account').find({ userId: user._id }).toArray() : [];
            expect(oauthLinks).toHaveLength(0);
        });

        it('anonymizeUser keeps financial and academic records linked by userId', async () => {
            const actor = await createUser({ email: `actor-${uniq()}@example.com`, role: 'admin' });
            const user = await createUser({ email: `u-${uniq()}@example.com` });
            const admin = await createAdmin({ role: 'superadmin' });
            const course = await createCourse(admin._id);
            const batch = await createBatch(course._id);
            const enrollment = await createEnrollmentWithId(user._id, batch._id);

            await AdminService.deleteUser(user._id.toString(), actor._id.toString(), 'GDPR request');
            await AdminService.anonymizeUser(user._id.toString());

            const enrollmentRecord = await EnrollmentModel.findById(enrollment._id).lean();
            expect(enrollmentRecord?.userId.toString()).toBe(user._id.toString());
        });
    });
});

describe('AdminService emails', () => {
    it('sendNewsUpdate requires subject and message', async () => {
        await expect(AdminService.sendNewsUpdate('', '')).rejects.toThrow(
            /Subject and message are required/i
        );
        await expect(AdminService.sendNewsUpdate('Subject', '')).rejects.toThrow(
            /Subject and message are required/i
        );
    });

    it('sendNewsUpdate targets enrolled users only', async () => {
        const admin = await createAdmin({ role: 'superadmin' });
        const enrolled = await createUser({
            email: `enr-${uniq()}@example.com`,
            emailVerified: true,
        });
        await createUser({ email: `unenr-${uniq()}@example.com`, emailVerified: true });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        await createEnrollmentWithId(enrolled._id, batch._id);

        const result = await AdminService.sendNewsUpdate('News', 'Hello students');
        expect(result.count).toBe(1);
    });

    it('sendEnrollmentReminder counts non-enrolled learners', async () => {
        const admin = await createAdmin({ role: 'superadmin' });
        const enrolled = await createUser({ email: `enr-${uniq()}@example.com`, role: 'learner' });
        const waiting = await createUser({ email: `wait-${uniq()}@example.com`, role: 'learner' });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id);
        await createEnrollmentWithId(enrolled._id, batch._id);

        const result = await AdminService.sendEnrollmentReminder();
        expect(result.count).toBeGreaterThanOrEqual(1);
        void waiting;
    });
});

describe('AdminService batch progress reminders', () => {
    it('sendRunningBatchProgressReminder requires courseId and batchId', async () => {
        await expect(AdminService.sendRunningBatchProgressReminder('', '')).rejects.toThrow(
            /Course ID and Batch ID are required/i
        );
    });

    it('sendRunningBatchProgressReminder throws for unknown batch', async () => {
        const admin = await createAdmin({ role: 'superadmin' });
        const course = await createCourse(admin._id);
        await expect(
            AdminService.sendRunningBatchProgressReminder(
                course._id.toString(),
                new mongoose.Types.ObjectId().toString()
            )
        ).rejects.toThrow(/Batch not found/i);
    });

    it('sendRunningBatchProgressReminder throws when batch does not belong to course', async () => {
        const admin = await createAdmin({ role: 'superadmin' });
        const courseA = await createCourse(admin._id);
        const courseB = await createCourse(admin._id);
        const batchB = await createBatch(courseB._id);
        await expect(
            AdminService.sendRunningBatchProgressReminder(courseA._id.toString(), batchB._id.toString())
        ).rejects.toThrow(/does not belong/i);
    });

    it('sendRunningBatchProgressReminder throws when batch is not running', async () => {
        const admin = await createAdmin({ role: 'superadmin' });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id, {
            status: 'upcoming',
            startDate: new Date('2030-01-01'),
            endDate: new Date('2030-06-01'),
        });
        await expect(
            AdminService.sendRunningBatchProgressReminder(course._id.toString(), batch._id.toString())
        ).rejects.toThrow(/not running/i);
    });

    it('sendRunningBatchProgressReminder returns count 0 with no enrollments', async () => {
        const admin = await createAdmin({ role: 'superadmin' });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id, {
            status: 'running',
            startDate: new Date('2020-01-01'),
            endDate: new Date('2030-01-01'),
        });
        const result = await AdminService.sendRunningBatchProgressReminder(
            course._id.toString(),
            batch._id.toString()
        );
        expect(result.count).toBe(0);
    });

    it('sendCompletedBatchIncompleteReminder throws when batch is not completed', async () => {
        const admin = await createAdmin({ role: 'superadmin' });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id, {
            status: 'running',
            startDate: new Date('2020-01-01'),
            endDate: new Date('2030-01-01'),
        });
        await expect(
            AdminService.sendCompletedBatchIncompleteReminder(course._id.toString(), batch._id.toString())
        ).rejects.toThrow(/not completed/i);
    });

    it('sendCompletedBatchIncompleteReminder returns count 0 with no enrollments', async () => {
        const admin = await createAdmin({ role: 'superadmin' });
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id, {
            status: 'completed',
            startDate: new Date('2020-01-01'),
            endDate: new Date('2020-06-01'),
        });
        const result = await AdminService.sendCompletedBatchIncompleteReminder(
            course._id.toString(),
            batch._id.toString()
        );
        expect(result.count).toBe(0);
    });
});

describe('AdminService.getAllInstructors / getRoleStats', () => {
    it('lists instructors and filters unassignedOnly', async () => {
        const admin = await createAdmin({ role: 'superadmin' });
        const assigned = await createUser({ email: `ia-${uniq()}@example.com`, role: 'instructor' });
        const free = await createUser({ email: `if-${uniq()}@example.com`, role: 'instructor' });
        await createUser({ email: `l-${uniq()}@example.com`, role: 'learner' });
        await createCourse(admin._id, { instructorId: assigned._id });

        const all = await AdminService.getAllInstructors();
        expect(all.map((u: any) => u.email)).toEqual(
            expect.arrayContaining([assigned.email, free.email])
        );
        expect(all.map((u: any) => u.email)).not.toContain(`l-`);

        const unassigned = await AdminService.getAllInstructors({ unassignedOnly: true });
        expect(unassigned.map((u: any) => u.email)).toContain(free.email);
        expect(unassigned.map((u: any) => u.email)).not.toContain(assigned.email);
    });

    it('getRoleStats totals users and breaks down by role/status', async () => {
        await createUser({ email: `g1-${uniq()}@example.com`, role: 'learner' });
        await createUser({ email: `g2-${uniq()}@example.com`, role: 'instructor' });

        const stats = await AdminService.getRoleStats();
        expect(stats.total).toBeGreaterThanOrEqual(2);
        const learner: any = stats.roles.find((r: any) => r.role === 'learner');
        expect(learner).toBeDefined();
        expect(learner.count).toBeGreaterThanOrEqual(1);
        expect(learner.active).toBeGreaterThanOrEqual(1);
        expect(stats.byRoleStatus['learner']).toBeDefined();
    });
});
