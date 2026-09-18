import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
    createUser,
    createAdmin,
    createCourse,
    createBatch,
    createEnrollment,
} from '../helpers/factories.js';
import { NotificationModel } from '../../modules/Notification/notification.model.js';
import { NotificationService } from '../../modules/Notification/notification.service.js';
import { EnrollmentStatus } from '../../types/common.js';

const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

const notifPayload = (overrides: Record<string, unknown> = {}) => ({
    type: 'quiz_published' as const,
    title: 'New Quiz',
    message: 'A quiz was published',
    link: '/my-classes',
    ...overrides,
});

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

describe('NotificationService.createNotification', () => {
    it('creates an unread notification for the user', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        const notif = await NotificationService.createNotification({
            userId: user._id.toString(),
            ...notifPayload(),
        });
        expect(notif.read).toBe(false);
        expect(notif.title).toBe('New Quiz');
        expect(await NotificationService.getUnreadCount(user._id.toString())).toBe(1);
    });
});

describe('NotificationService.createNotificationForAdmins', () => {
    it('notifies active admins/superadmins only', async () => {
        const admin = await createUser({ email: `admin-${uid()}@example.com`, role: 'admin' });
        const superadmin = await createUser({ email: `super-${uid()}@example.com`, role: 'superadmin' });
        const suspended = await createUser({ email: `susp-${uid()}@example.com`, role: 'admin', status: 'suspended' });
        const learner = await createUser({ email: `learner-${uid()}@example.com`, role: 'learner' });

        const result = await NotificationService.createNotificationForAdmins(notifPayload({ type: 'user_registered' }));
        expect(result).toHaveLength(2);

        const recipients = result.map((n: any) => n.userId.toString()).sort();
        expect(recipients).toEqual([admin._id.toString(), superadmin._id.toString()].sort());
        expect(await NotificationModel.countDocuments({ userId: suspended._id })).toBe(0);
        expect(await NotificationModel.countDocuments({ userId: learner._id })).toBe(0);
    });

    it('returns an empty array when no admins exist', async () => {
        await createUser({ email: `learner-${uid()}@example.com` });
        const result = await NotificationService.createNotificationForAdmins(notifPayload());
        expect(result).toEqual([]);
    });
});

describe('NotificationService.createBatchNotification', () => {
    const seedBatch = async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const course = await createCourse(admin._id, { title: `Course ${uid()}`, slug: `course-${uid()}` });
        return createBatch(course._id);
    };

    it('notifies active enrollments only', async () => {
        const batch = await seedBatch();
        const active = await createUser({ email: `active-${uid()}@example.com` });
        const pending = await createUser({ email: `pending-${uid()}@example.com` });
        await createEnrollment(active._id, batch._id, { status: EnrollmentStatus.Active });
        await createEnrollment(pending._id, batch._id, { status: EnrollmentStatus.Pending });

        const result = await NotificationService.createBatchNotification(
            batch._id.toString(),
            notifPayload({ type: 'lesson_published' })
        );
        expect(result).toHaveLength(1);
        expect((result[0] as any).userId.toString()).toBe(active._id.toString());
    });

    it('supports excludeUserId and returns [] when nobody is enrolled', async () => {
        const batch = await seedBatch();
        const [u1, u2] = await Promise.all([
            createUser({ email: `a-${uid()}@example.com` }),
            createUser({ email: `b-${uid()}@example.com` }),
        ]);
        await createEnrollment(u1._id, batch._id, { status: EnrollmentStatus.Active });
        await createEnrollment(u2._id, batch._id, { status: EnrollmentStatus.Active });

        const result = await NotificationService.createBatchNotification(
            batch._id.toString(),
            notifPayload(),
            u1._id.toString()
        );
        expect(result).toHaveLength(1);
        expect((result[0] as any).userId.toString()).toBe(u2._id.toString());

        const emptyBatch = await seedBatch();
        expect(
            await NotificationService.createBatchNotification(emptyBatch._id.toString(), notifPayload())
        ).toEqual([]);
    });
});

describe('NotificationService reads and mutations', () => {
    it('getUserNotifications paginates newest-first and filters by read', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        const first = await NotificationService.createNotification({ userId: user._id.toString(), ...notifPayload({ title: 'First' }) });
        await NotificationService.createNotification({ userId: user._id.toString(), ...notifPayload({ title: 'Second' }) });
        await NotificationService.markAsRead(user._id.toString(), first._id.toString());

        const page1 = await NotificationService.getUserNotifications(user._id.toString(), { page: 1, limit: 1 });
        expect(page1.data).toHaveLength(1);
        expect(page1.data[0].title).toBe('Second');
        expect(page1.meta).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });

        const unreadOnly = await NotificationService.getUserNotifications(user._id.toString(), { read: false });
        expect(unreadOnly.meta.total).toBe(1);

        const readOnly = await NotificationService.getUserNotifications(user._id.toString(), { read: true });
        expect(readOnly.meta.total).toBe(1);
    });

    it('excludes soft-deleted notifications from lists and unread counts', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        const notif = await NotificationService.createNotification({ userId: user._id.toString(), ...notifPayload() });
        await NotificationService.deleteNotification(user._id.toString(), notif._id.toString());

        const list = await NotificationService.getUserNotifications(user._id.toString(), {});
        expect(list.meta.total).toBe(0);
        expect(await NotificationService.getUnreadCount(user._id.toString())).toBe(0);
    });

    it('markAsRead only touches the owner notification', async () => {
        const [owner, stranger] = await Promise.all([
            createUser({ email: `owner-${uid()}@example.com` }),
            createUser({ email: `stranger-${uid()}@example.com` }),
        ]);
        const notif = await NotificationService.createNotification({ userId: owner._id.toString(), ...notifPayload() });

        const marked = await NotificationService.markAsRead(owner._id.toString(), notif._id.toString());
        expect(marked?.read).toBe(true);

        expect(await NotificationService.markAsRead(stranger._id.toString(), notif._id.toString())).toBeNull();
    });

    it('markAllAsRead clears the unread count', async () => {
        const user = await createUser({ email: `u-${uid()}@example.com` });
        await NotificationService.createNotification({ userId: user._id.toString(), ...notifPayload() });
        await NotificationService.createNotification({ userId: user._id.toString(), ...notifPayload() });

        const result: any = await NotificationService.markAllAsRead(user._id.toString());
        expect(result.modifiedCount).toBe(2);
        expect(await NotificationService.getUnreadCount(user._id.toString())).toBe(0);
    });

    it('deleteAllNotifications soft-deletes everything for the user only', async () => {
        const [u1, u2] = await Promise.all([
            createUser({ email: `a-${uid()}@example.com` }),
            createUser({ email: `b-${uid()}@example.com` }),
        ]);
        await NotificationService.createNotification({ userId: u1._id.toString(), ...notifPayload() });
        await NotificationService.createNotification({ userId: u2._id.toString(), ...notifPayload() });

        await NotificationService.deleteAllNotifications(u1._id.toString());
        expect((await NotificationService.getUserNotifications(u1._id.toString(), {})).meta.total).toBe(0);
        expect((await NotificationService.getUserNotifications(u2._id.toString(), {})).meta.total).toBe(1);
    });
});
