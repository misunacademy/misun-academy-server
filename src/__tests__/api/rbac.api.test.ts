import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import type { Express } from 'express';
import { connectTestDB, disconnectTestDB } from '../helpers/db.js';
import {
    createAdmin,
    createCourse,
    createBatch,
    createActiveEnrollment,
    createModule,
} from '../helpers/factories.js';
import { LessonModel } from '../../modules/Lesson/lesson.model.js';
import { UserModel } from '../../modules/User/user.model.js';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/test-placeholder';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'test-secret-test-secret-test-secret';
process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL || 'http://localhost:5000/api/v1/auth';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-id';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';
process.env.SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@test.local';
process.env.SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'superpass123';
process.env.SSL_STORE_ID = process.env.SSL_STORE_ID || 'test-store';
process.env.SSL_STORE_PASSWORD = process.env.SSL_STORE_PASSWORD || 'test-store-pass';
process.env.SSL_IS_LIVE = process.env.SSL_IS_LIVE || 'false';
process.env.SSL_VALIDATION_API = process.env.SSL_VALIDATION_API || 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php';
process.env.SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';
process.env.MA_FRONTEND_URL = process.env.MA_FRONTEND_URL || 'http://localhost:3000';
process.env.EP_FRONTEND_URL = process.env.EP_FRONTEND_URL || 'http://localhost:3001';
process.env.EMAIL_USER = process.env.EMAIL_USER || 'test@example.com';
process.env.EMAIL_PASS = process.env.EMAIL_PASS || 'test-email-pass';

const postWithRetry = async (
    url: string,
    body: Record<string, unknown>,
    attempts = 4
): Promise<request.Response> => {
    let lastRes: request.Response | undefined;
    for (let i = 0; i < attempts; i++) {
        lastRes = await request(app)
            .post(url)
            .set('Origin', TRUSTED_ORIGIN)
            .send(body);
        if (lastRes.status !== 500) return lastRes;
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
    return lastRes!;
};

let app: Express;

const TRUSTED_ORIGIN = 'http://localhost:3000';

const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}@test.local`;

const passwordFor = () => 'Str0ngPassw0rd!';

const seedApiUser = async (
    role: 'learner' | 'employee' | 'instructor' | 'admin' | 'superadmin',
    overrides: Record<string, unknown> = {}
) => {
    const email = uniqueEmail(role);
    const password = passwordFor();
    const res = await postWithRetry('/api/v1/auth/sign-up/email', { name: `${role} Tester`, email, password });
    expect([200, 201]).toContain(res.status);

    const update: Record<string, unknown> = { emailVerified: true, role };
    const user = await UserModel.findOneAndUpdate({ email }, { $set: { ...update, ...overrides } }, { new: true });
    expect(user).toBeTruthy();

    const signInRes = await postWithRetry('/api/v1/auth/sign-in/email', { email, password });
    expect(signInRes.status).toBe(200);

    const cookieHeader = ((signInRes.headers['set-cookie'] ?? []) as unknown as string[])
        .map((c) => c.split(';')[0])
        .join('; ');

    return { id: user!._id.toString(), email, cookieHeader };
};

const agentFor = (cookieHeader: string) => ({
    get: (url: string) => request(app).get(url).set('Cookie', cookieHeader),
    post: (url: string, body?: Record<string, unknown>) =>
        request(app).post(url).set('Cookie', cookieHeader).set('Origin', TRUSTED_ORIGIN).send(body ?? {}),
    patch: (url: string, body?: Record<string, unknown>) =>
        request(app).patch(url).set('Cookie', cookieHeader).set('Origin', TRUSTED_ORIGIN).send(body ?? {}),
    put: (url: string, body?: Record<string, unknown>) =>
        request(app).put(url).set('Cookie', cookieHeader).set('Origin', TRUSTED_ORIGIN).send(body ?? {}),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookieHeader).set('Origin', TRUSTED_ORIGIN),
});

beforeAll(async () => {
    await connectTestDB();
    const { initializeAuth } = await import('../../config/betterAuth.js');
    await initializeAuth();
    const imported = await import('../../app.js');
    app = imported.default;
});

afterAll(async () => {
    await disconnectTestDB();
});

describe('API-level RBAC & IDOR matrix', () => {
    let learnerA: { id: string; cookieHeader: string };
    let learnerB: { id: string; cookieHeader: string };
    let employee: { id: string; cookieHeader: string };
    let instructorA: { id: string; cookieHeader: string };
    let admin: { id: string; cookieHeader: string };
    let superadmin: { id: string; cookieHeader: string };

    let assignedCourseId: string;
    let unassignedCourseId: string;
    let unassignedBatchId: string;
    let batchAId: string;
    let moduleId: string;
    let lessonId: string;
    let enrollmentAId: string;

    beforeAll(async () => {
        learnerA = await seedApiUser('learner');
        learnerB = await seedApiUser('learner');
        employee = await seedApiUser('employee');
        instructorA = await seedApiUser('instructor');
        admin = await seedApiUser('admin');
        superadmin = await seedApiUser('superadmin');

        const adminDoc = await createAdmin();
        const assignedCourse = await createCourse(adminDoc._id, {
            title: `Assigned ${Date.now()}`,
            slug: `assigned-${Date.now()}`,
            instructorId: instructorA.id,
        });
        const unassignedCourse = await createCourse(adminDoc._id, {
            title: `Unassigned ${Date.now()}`,
            slug: `unassigned-${Date.now()}`,
        });
        const unassignedBatch = await createBatch(unassignedCourse._id);
        assignedCourseId = assignedCourse._id.toString();
        unassignedCourseId = unassignedCourse._id.toString();
        unassignedBatchId = unassignedBatch._id.toString();

        const batchA = await createBatch(assignedCourse._id);
        batchAId = batchA._id.toString();
        const mod = await createModule(assignedCourse._id, batchA._id, 1);
        moduleId = mod._id.toString();
        const lesson = await LessonModel.create({
            moduleId,
            title: 'RBAC Lesson',
            type: 'video',
            orderIndex: 1,
            videoSource: 'youtube',
            videoId: 'rbac-1',
        });
        lessonId = lesson._id.toString();

        const enrollmentA = await createActiveEnrollment((await UserModel.findById(learnerA.id))!._id, batchA._id);
        enrollmentAId = enrollmentA._id.toString();
    });

    describe('Audit logs — superadmin only', () => {
        it('denies unauthenticated access (401)', async () => {
            const res = await request(app).get('/api/v1/audit-logs');
            expect(res.status).toBe(401);
        });

        it.each([
            ['learner', () => learnerA],
            ['employee', () => employee],
            ['instructor', () => instructorA],
            ['admin', () => admin],
        ])('denies %s access (403)', async (_role, actor) => {
            const res = await agentFor(actor().cookieHeader).get('/api/v1/audit-logs');
            expect(res.status).toBe(403);
        });

        it('allows superadmin access (200)', async () => {
            const res = await agentFor(superadmin.cookieHeader).get('/api/v1/audit-logs');
            expect(res.status).toBe(200);
            expect(res.body?.data?.meta).toBeDefined();
        });
    });

    describe('User management boundaries', () => {
        it('denies plain admin user deletion (403) — superadmin-only per spec', async () => {
            const res = await agentFor(admin.cookieHeader).delete(`/api/v1/admin/users/${learnerA.id}`);
            expect(res.status).toBe(403);
        });

        it('allows superadmin user deletion (200)', async () => {
            const disposable = await seedApiUser('learner');
            const res = await agentFor(superadmin.cookieHeader).delete(`/api/v1/admin/users/${disposable.id}`);
            expect([200, 204]).toContain(res.status);
        });

        it('denies learner admin status-change API (403)', async () => {
            const res = await agentFor(learnerA.cookieHeader)
                .patch(`/api/v1/admin/users/${learnerB.id}/status`)
                .send({ status: 'suspended' });
            expect(res.status).toBe(403);
        });

        it('denies employee admin user listing (403)', async () => {
            const res = await agentFor(employee.cookieHeader).get('/api/v1/admin/users?page=1&limit=5');
            expect(res.status).toBe(403);
        });

        it('denies role escalation attempt via self-update (403)', async () => {
            const res = await agentFor(learnerA.cookieHeader)
                .put(`/api/v1/admin/users/${learnerA.id}`)
                .send({ role: 'superadmin' });
            expect([401, 403]).toContain(res.status);
        });
    });

    describe('Instructor scoping (/instructor/*)', () => {
        it('allows authoring a module in an ASSIGNED course', async () => {
            const res = await agentFor(instructorA.cookieHeader)
                .post(`/api/v1/instructor/courses/${assignedCourseId}/modules?batchId=${batchAId}`)
                .send({
                    title: 'Scoped Module',
                    description: 'Created by assigned instructor',
                    orderIndex: 9,
                    estimatedDuration: '1 hour',
                });
            expect([200, 201]).toContain(res.status);
        });

        it('denies authoring in an UNASSIGNED course (403)', async () => {
            const res = await agentFor(instructorA.cookieHeader)
                .post(`/api/v1/instructor/courses/${unassignedCourseId}/modules?batchId=${unassignedBatchId}`)
                .send({
                    title: 'Rogue Module',
                    description: 'Should be rejected',
                    orderIndex: 9,
                    estimatedDuration: '1 hour',
                });
            expect(res.status).toBe(403);
        });

        it('denies employee instructor APIs (403)', async () => {
            const res = await agentFor(employee.cookieHeader)
                .post(`/api/v1/instructor/courses/${assignedCourseId}/modules?batchId=${batchAId}`)
                .send({ title: 'X', description: 'X', orderIndex: 1, estimatedDuration: '1h' });
            expect(res.status).toBe(403);
        });

        it('denies learner instructor APIs (403)', async () => {
            const res = await agentFor(learnerA.cookieHeader).get('/api/v1/instructor/courses');
            expect(res.status).toBe(403);
        });
    });

    describe('Content enrollment gate & IDOR', () => {
        it('denies unenrolled learner batch content (403)', async () => {
            const res = await agentFor(learnerB.cookieHeader).get(`/api/v1/content/batches/${batchAId}/modules`);
            expect(res.status).toBe(403);
        });

        it('allows enrolled learner batch content (200)', async () => {
            const res = await agentFor(learnerA.cookieHeader).get(`/api/v1/content/batches/${batchAId}/modules`);
            expect(res.status).toBe(200);
        });

        it('blocks lesson completion by a learner WITHOUT enrollment in that course (404)', async () => {
            const res = await agentFor(learnerB.cookieHeader)
                .post(`/api/v1/course-enrollment/${assignedCourseId}/complete-lesson`)
                .send({ moduleId, lessonId });
            expect(res.status).toBe(404);
        });

        it('does not leak another learner’s certificate (scoped 404)', async () => {
            const res = await agentFor(learnerB.cookieHeader).get(`/api/v1/certificates/enrollment/${enrollmentAId}`);
            expect([403, 404]).toContain(res.status);
        });
    });

    describe('Account status enforcement', () => {
        it('rejects API access for suspended accounts (403)', async () => {
            const suspended = await seedApiUser('learner', { status: 'suspended' });
            const res = await agentFor(suspended.cookieHeader).get('/api/v1/course-enrollment/nonexistent/progress');
            expect(res.status).toBe(403);
            expect(JSON.stringify(res.body)).toMatch(/suspend/i);
        });
    });
});
