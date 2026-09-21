import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin } from '../helpers/factories.js';
import { AnnouncementModel } from '../../modules/Announcement/announcement.model.js';
import { NotificationModel } from '../../modules/Notification/notification.model.js';
import { AnnouncementService } from '../../modules/Announcement/announcement.service.js';
import { AnnouncementAudience, AnnouncementStatus } from '../../modules/Announcement/announcement.interface.js';

const uid = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

const actorOf = (admin: any) => ({ id: admin._id.toString(), role: 'admin' });

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

describe('AnnouncementService.createAnnouncement', () => {
    it('creates a draft announcement with defaults', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const a: any = await AnnouncementService.createAnnouncement(
            { title: `Hello ${uid()}`, message: 'Welcome aboard' },
            actorOf(admin)
        );
        expect(a.status).toBe(AnnouncementStatus.Draft);
        expect(a.audience).toBe(AnnouncementAudience.All);
        expect(a.isDismissible).toBe(true);
        expect(a.createdBy.toString()).toBe(admin._id.toString());
    });

    it('normalizes empty link and invalid dates', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const a: any = await AnnouncementService.createAnnouncement(
            { title: `T ${uid()}`, message: 'M', link: '', publishAt: 'not-a-date' },
            actorOf(admin)
        );
        expect(a.link).toBeUndefined();
        expect(a.publishAt).toBeUndefined();
    });
});

describe('AnnouncementService list/get/update/delete', () => {
    it('lists with status, audience, search filters and pagination meta', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const actor = actorOf(admin);
        await AnnouncementService.createAnnouncement({ title: `Alpha launch ${uid()}`, message: 'first' }, actor);
        await AnnouncementService.createAnnouncement(
            { title: `Beta notes ${uid()}`, message: 'second', status: AnnouncementStatus.Published, audience: AnnouncementAudience.Learner },
            actor
        );
        await AnnouncementService.createAnnouncement(
            { title: `Gamma ${uid()}`, message: 'third', audience: AnnouncementAudience.Instructor },
            actor
        );

        const all = await AnnouncementService.listAnnouncements({});
        expect(all.meta.total).toBe(3);
        expect(all.meta.totalPages).toBe(1);

        const published = await AnnouncementService.listAnnouncements({ status: AnnouncementStatus.Published });
        expect(published.meta.total).toBe(1);

        const learners = await AnnouncementService.listAnnouncements({ audience: AnnouncementAudience.Learner });
        expect(learners.meta.total).toBe(1);

        const search = await AnnouncementService.listAnnouncements({ search: 'alpha launch' });
        expect(search.meta.total).toBe(1);

        const page2 = await AnnouncementService.listAnnouncements({ page: 2, limit: 2 });
        expect(page2.data).toHaveLength(1);
        expect(page2.meta).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
    });

    it('getAnnouncementById returns null for unknown id', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const created: any = await AnnouncementService.createAnnouncement(
            { title: `T ${uid()}`, message: 'M' },
            actorOf(admin)
        );
        const found = await AnnouncementService.getAnnouncementById(created._id.toString());
        expect((found as any)?.title).toBe(created.title);
        expect(await AnnouncementService.getAnnouncementById(admin._id.toString())).toBeNull();
    });

    it('updateAnnouncement edits fields and returns null for unknown id', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const actor = actorOf(admin);
        const created: any = await AnnouncementService.createAnnouncement(
            { title: `T ${uid()}`, message: 'M' },
            actor
        );
        const updated: any = await AnnouncementService.updateAnnouncement(
            created._id.toString(),
            { title: 'Renamed', status: AnnouncementStatus.Published },
            actor
        );
        expect(updated.title).toBe('Renamed');
        expect(updated.status).toBe(AnnouncementStatus.Published);

        expect(await AnnouncementService.updateAnnouncement(admin._id.toString(), { title: 'x' }, actor)).toBeNull();
    });

    it('deleteAnnouncement removes the doc and returns null for unknown id', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const actor = actorOf(admin);
        const created: any = await AnnouncementService.createAnnouncement(
            { title: `T ${uid()}`, message: 'M' },
            actor
        );
        const deleted: any = await AnnouncementService.deleteAnnouncement(created._id.toString(), actor);
        expect(deleted._id.toString()).toBe(created._id.toString());
        expect(await AnnouncementModel.findById(created._id).lean()).toBeNull();
        expect(await AnnouncementService.deleteAnnouncement(created._id.toString(), actor)).toBeNull();
    });
});

describe('AnnouncementService.publishAnnouncement', () => {
    it('returns null for unknown id', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        expect(await AnnouncementService.publishAnnouncement(admin._id.toString(), actorOf(admin))).toBeNull();
    });

    it('publishes and notifies all active users for audience all', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const [u1, u2] = await Promise.all([
            createUser({ email: `a-${uid()}@example.com` }),
            createUser({ email: `b-${uid()}@example.com` }),
        ]);
        const created: any = await AnnouncementService.createAnnouncement(
            { title: `Big news ${uid()}`, message: 'Read me' },
            actorOf(admin)
        );
        const published: any = await AnnouncementService.publishAnnouncement(created._id.toString(), actorOf(admin));

        expect(published.status).toBe(AnnouncementStatus.Published);
        expect(published.publishAt).toBeDefined();

        const notifs = await NotificationModel.find({ type: 'new_announcement' }).lean();
        const recipients = notifs.map((n) => n.userId.toString());
        expect(recipients).toContain(u1._id.toString());
        expect(recipients).toContain(u2._id.toString());
        expect(notifs[0].title).toContain('Big news');
    });

    it('scopes notifications to the announcement audience role', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const learner = await createUser({ email: `learner-${uid()}@example.com`, role: 'learner' });
        const instructor = await createUser({ email: `instr-${uid()}@example.com`, role: 'instructor' });
        const created: any = await AnnouncementService.createAnnouncement(
            { title: `Learners only ${uid()}`, message: 'Hi learners', audience: AnnouncementAudience.Learner },
            actorOf(admin)
        );
        await AnnouncementService.publishAnnouncement(created._id.toString(), actorOf(admin));

        expect(await NotificationModel.countDocuments({ userId: learner._id })).toBe(1);
        expect(await NotificationModel.countDocuments({ userId: instructor._id })).toBe(0);
    });
});

describe('AnnouncementService.unpublishAnnouncement', () => {
    it('returns null for unknown id', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        expect(await AnnouncementService.unpublishAnnouncement(admin._id.toString(), actorOf(admin))).toBeNull();
    });

    it('moves a published announcement to unpublished and hides it from live', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const actor = actorOf(admin);
        const created: any = await AnnouncementService.createAnnouncement(
            { title: `Take down ${uid()}`, message: 'bye' },
            actor
        );
        await AnnouncementService.publishAnnouncement(created._id.toString(), actor);

        const unpublished: any = await AnnouncementService.unpublishAnnouncement(created._id.toString(), actor);
        expect(unpublished.status).toBe(AnnouncementStatus.Unpublished);

        const live = await AnnouncementService.getLiveAnnouncements('all', 10);
        expect(live.map((a: any) => a._id.toString())).not.toContain(created._id.toString());

        const stats = await AnnouncementService.getAnnouncementStats();
        expect(stats.unpublished).toBe(1);
        expect(stats.published).toBe(0);
    });

    it('rejects unpublishing a draft', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const created: any = await AnnouncementService.createAnnouncement(
            { title: `Draft ${uid()}`, message: 'm' },
            actorOf(admin)
        );
        await expect(
            AnnouncementService.unpublishAnnouncement(created._id.toString(), actorOf(admin))
        ).rejects.toThrow(/only published or scheduled/i);
    });
});

describe('AnnouncementService.getLiveAnnouncements / getAnnouncementStats / isLiveNow', () => {
    it('shows only live published announcements for the requested audience', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const actor = actorOf(admin);
        const tag = uid();
        await AnnouncementService.createAnnouncement({ title: `Live all ${tag}`, message: 'm', status: AnnouncementStatus.Published }, actor);
        await AnnouncementService.createAnnouncement(
            { title: `Live learner ${tag}`, message: 'm', status: AnnouncementStatus.Published, audience: AnnouncementAudience.Learner },
            actor
        );
        await AnnouncementService.createAnnouncement({ title: `Draft ${tag}`, message: 'm' }, actor);
        await AnnouncementService.createAnnouncement(
            { title: `Future ${tag}`, message: 'm', status: AnnouncementStatus.Published, publishAt: new Date(Date.now() + 86_400_000).toISOString() },
            actor
        );
        await AnnouncementService.createAnnouncement(
            { title: `Expired ${tag}`, message: 'm', status: AnnouncementStatus.Published, expireAt: new Date(Date.now() - 1000).toISOString() },
            actor
        );

        const forLearner = await AnnouncementService.getLiveAnnouncements('learner');
        const titles = forLearner.map((a) => a.title);
        expect(titles).toContain(`Live all ${tag}`);
        expect(titles).toContain(`Live learner ${tag}`);
        expect(titles).not.toContain(`Draft ${tag}`);
        expect(titles).not.toContain(`Future ${tag}`);
        expect(titles).not.toContain(`Expired ${tag}`);

        const forAll = await AnnouncementService.getLiveAnnouncements('all');
        expect(forAll.map((a) => a.title)).toEqual([`Live all ${tag}`]);
    });

    it('getAnnouncementStats counts by status', async () => {
        const admin = await createAdmin({ email: `admin-${uid()}@example.com` });
        const actor = actorOf(admin);
        await AnnouncementService.createAnnouncement({ title: `A ${uid()}`, message: 'm' }, actor);
        await AnnouncementService.createAnnouncement({ title: `B ${uid()}`, message: 'm', status: AnnouncementStatus.Published }, actor);

        const stats = await AnnouncementService.getAnnouncementStats();
        expect(stats.total).toBe(2);
        expect(stats.draft).toBe(1);
        expect(stats.published).toBe(1);
    });

    it('isLiveNow reflects status and date windows', () => {
        expect(AnnouncementService.isLiveNow({ status: 'draft' })).toBe(false);
        expect(AnnouncementService.isLiveNow({ status: 'published' })).toBe(true);
        expect(
            AnnouncementService.isLiveNow({ status: 'published', publishAt: new Date(Date.now() + 60_000) })
        ).toBe(false);
        expect(
            AnnouncementService.isLiveNow({ status: 'published', expireAt: new Date(Date.now() - 60_000) })
        ).toBe(false);
        expect(
            AnnouncementService.isLiveNow({
                status: 'published',
                publishAt: new Date(Date.now() - 60_000),
                expireAt: new Date(Date.now() + 60_000),
            })
        ).toBe(true);
    });
});
