import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch } from '../helpers/factories.js';
import { DashboardService } from '../../modules/Dashboard/dashboard.service.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { PaymentModel } from '../../modules/Payment/payment.model.js';
import { EnrollmentStatus, Status } from '../../types/common.js';

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

let admin: any;

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
    admin = await createAdmin({ role: 'superadmin' });
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

const createPayment = async (userId: any, batchId: any, overrides: Record<string, unknown> = {}) =>
    PaymentModel.create({
        userId,
        batchId,
        enrollmentId: `ENR-${uniq()}`,
        transactionId: `TXN-${uniq()}`,
        amount: 5000,
        currency: 'BDT',
        status: Status.Success,
        method: 'SSLCommerz',
        ...overrides,
    });

describe('DashboardService.getUserStats', () => {
    it('counts total users and groups by role', async () => {
        await createUser({ email: `s1-${uniq()}@example.com`, status: 'active' });
        await createUser({ email: `s2-${uniq()}@example.com`, status: 'suspended' });
        await createUser({ email: `s3-${uniq()}@example.com`, role: 'instructor', status: 'active' });

        const stats = await DashboardService.getUserStats();

        expect(stats.totalUsers).toBeGreaterThanOrEqual(3);
        const roles = Object.fromEntries(stats.usersByRole.map((r: any) => [r._id, r.count]));
        expect(roles['learner']).toBeGreaterThanOrEqual(2);
        expect(roles['instructor']).toBeGreaterThanOrEqual(1);
    });

    // Regression: getUserStats used to query capitalized 'Active'/'Suspended'
    // while UserStatus stores lowercase, so the breakdown was always 0.
    it('counts active and suspended users with lowercase statuses', async () => {
        await createUser({ email: `s1-${uniq()}@example.com`, status: 'active' });
        await createUser({ email: `s2-${uniq()}@example.com`, status: 'suspended' });

        const stats = await DashboardService.getUserStats();

        expect(stats.suspendedUsers).toBe(1);
        expect(stats.activeUsers).toBe(1);
    });
});

describe('DashboardService.getDashboardMetaData', () => {
    it('aggregates enrolled students and income', async () => {
        const user = await createUser({ email: `dash-${uniq()}@example.com` });
        const course = await createCourse(admin._id, { status: 'published' });
        const batch = await createBatch(course._id);
        await createEnrollmentWithId(user._id, batch._id);
        await createPayment(user._id, batch._id, { amount: 5000 });

        const meta = await DashboardService.getDashboardMetaData();

        expect(meta.totalEnrolled).toBe(1);
        expect(meta.totalIncome).toBe(5000);
        expect(meta.batchWiseEnrolled).toHaveLength(1);
        expect(meta.batchWiseEnrolled[0].totalEnrolled).toBe(1);
        expect(meta.courseWiseStats).toHaveLength(1);
        expect(meta.courseWiseStats[0].totalIncome).toBe(5000);
        expect(meta.batchWiseIncome).toHaveLength(1);
        expect(meta.dayWiseStats.length).toBeGreaterThanOrEqual(1);
    });

    it('returns zeros when there is no data', async () => {
        const meta = await DashboardService.getDashboardMetaData();
        expect(meta.totalEnrolled).toBe(0);
        expect(meta.totalIncome).toBe(0);
        expect(meta.batchWiseEnrolled).toEqual([]);
    });

    it('ignores failed payments in income totals', async () => {
        const user = await createUser({ email: `dash-${uniq()}@example.com` });
        const course = await createCourse(admin._id, { status: 'published' });
        const batch = await createBatch(course._id);
        await createEnrollmentWithId(user._id, batch._id);
        await createPayment(user._id, batch._id, { amount: 5000, status: Status.Failed });

        const meta = await DashboardService.getDashboardMetaData();
        expect(meta.totalIncome).toBe(0);
        // enrollment itself is still active so student count is unaffected
        expect(meta.totalEnrolled).toBe(1);
    });

    it('filters by courseId', async () => {
        const user = await createUser({ email: `dash-${uniq()}@example.com` });
        const courseA = await createCourse(admin._id, { status: 'published' });
        const courseB = await createCourse(admin._id, { status: 'published' });
        const batchA = await createBatch(courseA._id);
        const batchB = await createBatch(courseB._id);
        await createEnrollmentWithId(user._id, batchA._id);
        const userB = await createUser({ email: `dash-b-${uniq()}@example.com` });
        await createEnrollmentWithId(userB._id, batchB._id);
        await createPayment(user._id, batchA._id, { amount: 3000 });
        await createPayment(userB._id, batchB._id, { amount: 7000 });

        const meta = await DashboardService.getDashboardMetaData(courseA._id.toString());
        expect(meta.totalEnrolled).toBe(1);
        expect(meta.totalIncome).toBe(3000);
    });

    it('rejects an invalid courseId', async () => {
        await expect(DashboardService.getDashboardMetaData('not-an-id')).rejects.toThrow(
            /Invalid courseId/i
        );
    });
});

describe('DashboardService.getAdminDashboard', () => {
    it('returns overview, trends, top batches and recent enrollments', async () => {
        const user = await createUser({ email: `dash-${uniq()}@example.com` });
        const course = await createCourse(admin._id, { status: 'published' });
        const batch = await createBatch(course._id);
        await createEnrollmentWithId(user._id, batch._id);
        await createPayment(user._id, batch._id, { amount: 5000 });

        const dash = await DashboardService.getAdminDashboard();

        expect(dash.overview.totalUsers).toBeGreaterThanOrEqual(1);
        // Regression: these used capitalized literals ('Published'/'Success')
        // that never match the lowercase enums, so they were always 0.
        expect(dash.overview.totalCourses).toBe(1);
        expect(dash.overview.totalBatches).toBe(1);
        expect(dash.overview.activeEnrollments).toBe(1);
        expect(dash.overview.totalRevenue).toBe(5000);
        expect(dash.overview.totalTransactions).toBe(1);
        expect(Array.isArray(dash.enrollmentTrends)).toBe(true);
        expect(dash.topBatches.length).toBeGreaterThanOrEqual(1);
        expect(dash.recentEnrollments.length).toBeGreaterThanOrEqual(1);
    });

    it('returns zero revenue when there are no successful payments', async () => {
        const dash = await DashboardService.getAdminDashboard();
        expect(dash.overview.totalRevenue).toBe(0);
        expect(dash.overview.totalTransactions).toBe(0);
    });
});

describe('DashboardService.getStudentDashboard', () => {
    it('returns enrolled courses, counts and recent activity', async () => {
        const user = await createUser({ email: `dash-${uniq()}@example.com` });
        const course = await createCourse(admin._id, { status: 'published' });
        const batch = await createBatch(course._id);
        await createEnrollmentWithId(user._id, batch._id);

        const dash = await DashboardService.getStudentDashboard(user._id.toString());

        expect(dash.enrolledCoursesCount).toBe(1);
        expect(dash.completedCoursesCount).toBe(0);
        expect(dash.enrolledCourses).toHaveLength(1);
        expect(dash.enrolledCourses[0].status).toBe(EnrollmentStatus.Active);
        expect(dash.recentActivity).toHaveLength(1);
    });

    it('counts completed courses separately', async () => {
        const user = await createUser({ email: `dash-${uniq()}@example.com` });
        const course = await createCourse(admin._id, { status: 'published' });
        const batch = await createBatch(course._id);
        await createEnrollmentWithId(user._id, batch._id, { status: EnrollmentStatus.Completed });

        const dash = await DashboardService.getStudentDashboard(user._id.toString());
        expect(dash.enrolledCoursesCount).toBe(1);
        expect(dash.completedCoursesCount).toBe(1);
    });

    it('returns empty dashboard for a student with no enrollments', async () => {
        const user = await createUser({ email: `dash-${uniq()}@example.com` });
        const dash = await DashboardService.getStudentDashboard(user._id.toString());
        expect(dash.enrolledCoursesCount).toBe(0);
        expect(dash.enrolledCourses).toEqual([]);
        expect(dash.recentActivity).toEqual([]);
    });
});

describe('DashboardService.getInstructorDashboard', () => {
    it('returns null course when instructor has no assigned course', async () => {
        const instructor = await createUser({
            email: `instr-${uniq()}@example.com`,
            role: 'instructor',
        });
        const dash = await DashboardService.getInstructorDashboard(instructor._id.toString());
        expect(dash.course).toBeNull();
        expect(dash.enrolledStudents).toBe(0);
    });

    it('returns course stats with enrolled students and batch counts', async () => {
        const instructor = await createUser({
            email: `instr-${uniq()}@example.com`,
            role: 'instructor',
        });
        const course = await createCourse(admin._id, {
            status: 'published',
            instructorId: instructor._id,
        });
        const batch = await createBatch(course._id, { status: 'running' });
        const student = await createUser({ email: `stud-${uniq()}@example.com` });
        await createEnrollmentWithId(student._id, batch._id);

        const dash = await DashboardService.getInstructorDashboard(instructor._id.toString());

        expect(dash.course).toBeDefined();
        expect(dash.enrolledStudents).toBe(1);
        expect(dash.totalBatches).toBe(1);
        expect(dash.activeBatches).toBe(1);
    });

});
