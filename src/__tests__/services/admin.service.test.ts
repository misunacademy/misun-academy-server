import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch } from '../helpers/factories.js';
import { AdminService } from '../../modules/Admin/admin.service.js';
import { UserModel } from '../../modules/User/user.model.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
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
        const actor = await createUser({ email: `actor-${uniq()}@example.com`, role: 'admin' });
        const user = await createUser({ email: `u-${uniq()}@example.com`, role: 'learner' });

        const updated: any = await AdminService.updateUser(
            user._id.toString(),
            { role: 'instructor', name: 'Promoted' },
            actor._id.toString()
        );

        expect(updated.role).toBe('instructor');
        expect(updated.name).toBe('Promoted');

        const audit = await AuditLogModel.findOne({ action: 'user.role_change' }).lean();
        expect(audit).toBeDefined();
        expect((audit?.metadata as any)?.to).toBe('instructor');
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

    it('deleteUser removes the user and audits', async () => {
        const actor = await createUser({ email: `actor-${uniq()}@example.com`, role: 'admin' });
        const user = await createUser({ email: `u-${uniq()}@example.com` });

        await AdminService.deleteUser(user._id.toString(), actor._id.toString());
        expect(await UserModel.countDocuments({ _id: user._id })).toBe(0);
        const audit = await AuditLogModel.findOne({ action: 'user.delete' }).lean();
        expect(audit).toBeDefined();
    });

    it('deleteUser throws NOT_FOUND for unknown id', async () => {
        await expect(
            AdminService.deleteUser(new mongoose.Types.ObjectId().toString())
        ).rejects.toThrow(/User not found/i);
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
