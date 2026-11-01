import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser } from '../helpers/factories.js';
import { BootcampCatalogService } from '../../modules/Bootcamp/bootcampCatalog.service.js';
import { BootcampCatalogModel } from '../../modules/Bootcamp/bootcampCatalog.model.js';
import { BootcampPurchaseModel } from '../../modules/Bootcamp/bootcampPurchase.model.js';
import {
    BootcampStatus,
    RecordedStatus,
    BootcampPurchaseStatus,
} from '../../modules/Bootcamp/bootcampCatalog.interface.js';
import { AuditLogModel } from '../../models/auditLog.model.js';

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

let actor: { id: string; role?: string };

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
    const adminUser = await createUser({ email: `adm-${uniq()}@example.com`, role: 'admin' });
    actor = { id: adminUser._id.toString(), role: 'admin' };
});

const catalogPayload = (overrides: Record<string, unknown> = {}) => ({
    title: `Design Bootcamp ${uniq()}`,
    season: 'Season 7',
    status: BootcampStatus.Draft,
    ...overrides,
});

const publishedCatalog = (overrides: Record<string, unknown> = {}) =>
    BootcampCatalogModel.create({
        ...catalogPayload(),
        slug: `published-${uniq()}`,
        status: BootcampStatus.Completed,
        recordedStatus: RecordedStatus.Published,
        recordedPrice: 1500,
        ...overrides,
    });

const videoPayload = (overrides: Record<string, unknown> = {}) => ({
    title: `Intro Video ${uniq()}`,
    videoSource: 'youtube',
    videoId: 'dQw4w9WgXcQ',
    duration: 120,
    ...overrides,
});

describe('BootcampCatalogService.createBootcamp / updateBootcamp / setRecordedPrice', () => {
    it('creates with an auto-generated slug and audits', async () => {
        const created: any = await BootcampCatalogService.createBootcamp(
            catalogPayload() as any,
            actor
        );
        expect(created.slug).toBeTruthy();
        expect(created.slug).toContain('design-bootcamp');
        const audit = await AuditLogModel.findOne({ action: 'bootcamp.create' }).lean();
        expect(audit).toBeDefined();
    });

    it('rejects missing title/season and duplicate slugs', async () => {
        await expect(
            BootcampCatalogService.createBootcamp({ title: 'No Season' } as any, actor)
        ).rejects.toThrow(/Title and season are required/i);

        const first: any = await BootcampCatalogService.createBootcamp(catalogPayload() as any, actor);
        await expect(
            BootcampCatalogService.createBootcamp(
                { title: first.title, season: first.season, slug: first.slug } as any,
                actor
            )
        ).rejects.toThrow(/slug already exists/i);
    });

    it('updateBootcamp edits fields and detects slug clashes', async () => {
        const a: any = await BootcampCatalogService.createBootcamp(catalogPayload() as any, actor);
        const b: any = await BootcampCatalogService.createBootcamp(catalogPayload() as any, actor);

        const updated: any = await BootcampCatalogService.updateBootcamp(
            a._id.toString(), { tagline: 'New tagline' } as any, actor
        );
        expect(updated.tagline).toBe('New tagline');

        await expect(
            BootcampCatalogService.updateBootcamp(a._id.toString(), { slug: b.slug } as any, actor)
        ).rejects.toThrow(/slug already exists/i);

        await expect(
            BootcampCatalogService.updateBootcamp(
                new mongoose.Types.ObjectId().toString(), { tagline: 'x' } as any, actor
            )
        ).rejects.toThrow(/Bootcamp not found/i);
    });

    it('setRecordedPrice validates and persists', async () => {
        const created: any = await BootcampCatalogService.createBootcamp(catalogPayload() as any, actor);

        await expect(
            BootcampCatalogService.setRecordedPrice(created._id.toString(), -5, actor)
        ).rejects.toThrow(/non-negative/i);

        const updated: any = await BootcampCatalogService.setRecordedPrice(
            created._id.toString(), 2500, actor
        );
        expect(updated.recordedPrice).toBe(2500);

        await expect(
            BootcampCatalogService.setRecordedPrice(
                new mongoose.Types.ObjectId().toString(), 100, actor
            )
        ).rejects.toThrow(/Bootcamp not found/i);
    });
});

describe('BootcampCatalogService reads', () => {
    it('getCurrentBootcamp returns the earliest upcoming/live bootcamp', async () => {
        await BootcampCatalogModel.create({
            ...catalogPayload(),
            slug: `later-${uniq()}`,
            status: BootcampStatus.Upcoming,
            startDate: new Date('2030-06-01'),
        });
        const sooner: any = await BootcampCatalogModel.create({
            ...catalogPayload(),
            slug: `sooner-${uniq()}`,
            status: BootcampStatus.Live,
            startDate: new Date('2030-01-01'),
        });

        const current: any = await BootcampCatalogService.getCurrentBootcamp();
        expect(current._id.toString()).toBe(sooner._id.toString());
    });

    it('getCurrentBootcamp returns null when nothing is open', async () => {
        expect(await BootcampCatalogService.getCurrentBootcamp()).toBeNull();
    });

    it('getPastBootcamps returns only published recordings as cards', async () => {
        await publishedCatalog({ title: `Past One ${uniq()}` });
        await BootcampCatalogModel.create({
            ...catalogPayload(),
            slug: `unpub-${uniq()}`,
            status: BootcampStatus.Completed,
            recordedStatus: RecordedStatus.Draft,
        });

        const past: any[] = await BootcampCatalogService.getPastBootcamps();
        expect(past).toHaveLength(1);
        expect(past[0].lessonsCount).toBeDefined();
        expect(past[0].videos).toBeUndefined();
    });

    it('getBootcampBySlug hides videos and flags purchase state', async () => {
        const bootcamp: any = await publishedCatalog();
        const user = await createUser({ email: `buyer-${uniq()}@example.com` });

        const anon: any = await BootcampCatalogService.getBootcampBySlug(bootcamp.slug);
        expect(anon.videos).toBeUndefined();
        expect(anon.hasPurchased).toBe(false);

        await BootcampPurchaseModel.create({
            user: user._id,
            bootcamp: bootcamp._id,
            amount: bootcamp.recordedPrice,
            method: 'SSLCommerz',
            transactionId: `BC-${uniq()}`,
            status: BootcampPurchaseStatus.Paid,
        });

        const owner: any = await BootcampCatalogService.getBootcampBySlug(
            bootcamp.slug, user._id.toString()
        );
        expect(owner.hasPurchased).toBe(true);
    });

    it('getBootcampBySlug 404s for draft / archived / unpublished recordings', async () => {
        const draft: any = await BootcampCatalogModel.create({
            ...catalogPayload(),
            slug: `draft-${uniq()}`,
            status: BootcampStatus.Draft,
            recordedStatus: RecordedStatus.Published,
        });
        await expect(BootcampCatalogService.getBootcampBySlug(draft.slug)).rejects.toThrow(
            /not found/i
        );

        const unpub: any = await BootcampCatalogModel.create({
            ...catalogPayload(),
            slug: `unpub2-${uniq()}`,
            status: BootcampStatus.Completed,
            recordedStatus: RecordedStatus.Draft,
        });
        await expect(BootcampCatalogService.getBootcampBySlug(unpub.slug)).rejects.toThrow(
            /not found/i
        );

        await expect(BootcampCatalogService.getBootcampBySlug('no-such-slug')).rejects.toThrow(
            /not found/i
        );
    });

    it('listBootcampsAdmin searches, filters and paginates', async () => {
        await BootcampCatalogService.createBootcamp(
            { ...catalogPayload(), title: `Alpha Camp ${uniq()}`, status: BootcampStatus.Live } as any,
            actor
        );
        await BootcampCatalogService.createBootcamp(
            { ...catalogPayload(), title: `Beta Camp ${uniq()}`, status: BootcampStatus.Draft } as any,
            actor
        );

        const live: any = await BootcampCatalogService.listBootcampsAdmin({ status: 'live' });
        expect(live.meta.total).toBe(1);

        const searched: any = await BootcampCatalogService.listBootcampsAdmin({ search: 'alpha' });
        expect(searched.meta.total).toBe(1);

        const paged: any = await BootcampCatalogService.listBootcampsAdmin({ page: 1, limit: 1 });
        expect(paged.data).toHaveLength(1);
        expect(paged.meta.total).toBe(2);
    });
});

describe('BootcampCatalogService videos', () => {
    it('addBootcampVideo appends with orderIndex and syncs stats', async () => {
        const created: any = await BootcampCatalogService.createBootcamp(catalogPayload() as any, actor);

        const withVideo: any = await BootcampCatalogService.addBootcampVideo(
            created._id.toString(), videoPayload() as any, actor
        );
        expect(withVideo.videos).toHaveLength(1);
        expect(withVideo.videos[0].orderIndex).toBe(0);
        expect(withVideo.lessonsCount).toBe(1);
        expect(withVideo.durationMinutes).toBe(2); // 120s -> 2 min
    });

    it('addBootcampVideo throws for unknown bootcamp', async () => {
        await expect(
            BootcampCatalogService.addBootcampVideo(
                new mongoose.Types.ObjectId().toString(), videoPayload() as any, actor
            )
        ).rejects.toThrow(/Bootcamp not found/i);
    });

    it('updateBootcampVideo normalizes pasted youtube URLs to ids', async () => {
        const created: any = await BootcampCatalogService.createBootcamp(catalogPayload() as any, actor);
        const withVideo: any = await BootcampCatalogService.addBootcampVideo(
            created._id.toString(), videoPayload() as any, actor
        );
        const videoId = withVideo.videos[0]._id.toString();

        const updated: any = await BootcampCatalogService.updateBootcampVideo(
            created._id.toString(),
            videoId,
            { videoId: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } as any,
            actor
        );
        const video = updated.videos.id(videoId);
        expect(video.videoId).toBe('dQw4w9WgXcQ');
    });

    it('updateBootcampVideo throws for unknown video', async () => {
        const created: any = await BootcampCatalogService.createBootcamp(catalogPayload() as any, actor);
        await expect(
            BootcampCatalogService.updateBootcampVideo(
                created._id.toString(),
                new mongoose.Types.ObjectId().toString(),
                { title: 'x' } as any,
                actor
            )
        ).rejects.toThrow(/Video not found/i);
    });

    it('deleteBootcampVideo removes and resyncs stats', async () => {
        const created: any = await BootcampCatalogService.createBootcamp(catalogPayload() as any, actor);
        const withVideo: any = await BootcampCatalogService.addBootcampVideo(
            created._id.toString(), videoPayload() as any, actor
        );
        const videoId = withVideo.videos[0]._id.toString();

        const after: any = await BootcampCatalogService.deleteBootcampVideo(
            created._id.toString(), videoId, actor
        );
        expect(after.videos).toHaveLength(0);
        expect(after.lessonsCount).toBe(0);
    });

    it('listBootcampVideos throws for unknown bootcamp', async () => {
        await expect(
            BootcampCatalogService.listBootcampVideos(new mongoose.Types.ObjectId().toString())
        ).rejects.toThrow(/Bootcamp not found/i);
    });

    it('publishRecording requires a published video, then publishes', async () => {
        const created: any = await BootcampCatalogService.createBootcamp(catalogPayload() as any, actor);

        await expect(
            BootcampCatalogService.publishRecording(created._id.toString(), actor)
        ).rejects.toThrow(/at least one published video/i);

        await BootcampCatalogService.addBootcampVideo(
            created._id.toString(), videoPayload() as any, actor
        );
        const published: any = await BootcampCatalogService.publishRecording(
            created._id.toString(), actor, { recordedPrice: 999 }
        );
        expect(published.recordedStatus).toBe(RecordedStatus.Published);
        expect(published.status).toBe(BootcampStatus.Completed);
        expect(published.recordedPrice).toBe(999);
    });
});

describe('BootcampCatalogService purchase gating (no gateway network)', () => {
    it('getMyBootcampVideos forbids non-buyers and serves published-only to buyers', async () => {
        const bootcamp: any = await publishedCatalog();
        await BootcampCatalogService.addBootcampVideo(
            bootcamp._id.toString(), videoPayload({ isPublished: true }) as any, actor
        );
        await BootcampCatalogService.addBootcampVideo(
            bootcamp._id.toString(), videoPayload({ isPublished: false }) as any, actor
        );

        const buyer = await createUser({ email: `buyer-${uniq()}@example.com` });
        const stranger = await createUser({ email: `stranger-${uniq()}@example.com` });

        await expect(
            BootcampCatalogService.getMyBootcampVideos(bootcamp.slug, stranger._id.toString())
        ).rejects.toThrow(/not purchased/i);

        await BootcampPurchaseModel.create({
            user: buyer._id,
            bootcamp: bootcamp._id,
            amount: 1500,
            method: 'SSLCommerz',
            transactionId: `BC-${uniq()}`,
            status: BootcampPurchaseStatus.Paid,
        });

        const mine: any = await BootcampCatalogService.getMyBootcampVideos(
            bootcamp.slug, buyer._id.toString()
        );
        expect(mine.videos).toHaveLength(1);
        expect(mine.videos[0].isPublished).toBe(true);
    });

    it('getMyBootcampPurchases lists newest first', async () => {
        const bootcamp: any = await publishedCatalog();
        const buyer = await createUser({ email: `buyer-${uniq()}@example.com` });
        await BootcampPurchaseModel.create({
            user: buyer._id,
            bootcamp: bootcamp._id,
            amount: 1500,
            method: 'SSLCommerz',
            transactionId: `BC-${uniq()}`,
            status: BootcampPurchaseStatus.Paid,
        });

        const list: any[] = await BootcampCatalogService.getMyBootcampPurchases(buyer._id.toString());
        expect(list).toHaveLength(1);
        expect(list[0].transactionId).toBeTruthy();
    });

    it('initiateBootcampSSLCommerz rejects buyers who already own the recording', async () => {
        const bootcamp: any = await publishedCatalog();
        const buyer = await createUser({ email: `buyer-${uniq()}@example.com` });
        await BootcampPurchaseModel.create({
            user: buyer._id,
            bootcamp: bootcamp._id,
            amount: 1500,
            method: 'SSLCommerz',
            transactionId: `BC-${uniq()}`,
            status: BootcampPurchaseStatus.Paid,
        });

        await expect(
            BootcampCatalogService.initiateBootcampSSLCommerz(bootcamp.slug, buyer._id.toString())
        ).rejects.toThrow(/already own/i);
    });

    it('initiateBootcampSSLCommerz 404s for unpublished recordings', async () => {
        const draft: any = await BootcampCatalogModel.create({
            ...catalogPayload(),
            slug: `draftpay-${uniq()}`,
            status: BootcampStatus.Draft,
            recordedStatus: RecordedStatus.Draft,
        });
        const buyer = await createUser({ email: `buyer-${uniq()}@example.com` });
        await expect(
            BootcampCatalogService.initiateBootcampSSLCommerz(draft.slug, buyer._id.toString())
        ).rejects.toThrow(/not found or not published/i);
    });

    it('checkBootcampPaymentStatus returns status + slug, scoped to user', async () => {
        const bootcamp: any = await publishedCatalog();
        const buyer = await createUser({ email: `buyer-${uniq()}@example.com` });
        const other = await createUser({ email: `other-${uniq()}@example.com` });
        const txn = `BC-${uniq()}`;
        await BootcampPurchaseModel.create({
            user: buyer._id,
            bootcamp: bootcamp._id,
            amount: 1500,
            method: 'SSLCommerz',
            transactionId: txn,
            status: BootcampPurchaseStatus.Pending,
        });

        const status: any = await BootcampCatalogService.checkBootcampPaymentStatus(
            txn, buyer._id.toString()
        );
        expect(status.status).toBe(BootcampPurchaseStatus.Pending);
        expect(status.bootcampSlug).toBe(bootcamp.slug);

        await expect(
            BootcampCatalogService.checkBootcampPaymentStatus(txn, other._id.toString())
        ).rejects.toThrow(/not found/i);
    });

    it('finalizeBootcampSSLCommerz marks failed/cancelled and requires valId otherwise', async () => {
        const bootcamp: any = await publishedCatalog();
        const buyer = await createUser({ email: `buyer-${uniq()}@example.com` });
        const txn = `BC-${uniq()}`;
        await BootcampPurchaseModel.create({
            user: buyer._id,
            bootcamp: bootcamp._id,
            amount: 1500,
            method: 'SSLCommerz',
            transactionId: txn,
            status: BootcampPurchaseStatus.Pending,
        });

        await BootcampCatalogService.finalizeBootcampSSLCommerz(txn, 'failed');
        const failed: any = await BootcampPurchaseModel.findOne({ transactionId: txn }).lean();
        expect(failed.status).toBe(BootcampPurchaseStatus.Rejected);

        await expect(
            BootcampCatalogService.finalizeBootcampSSLCommerz(txn, 'success')
        ).rejects.toThrow(/Validation ID missing/i);

        await expect(
            BootcampCatalogService.finalizeBootcampSSLCommerz('BC-NOPE', 'failed')
        ).rejects.toThrow(/purchase not found/i);
    });

    it('getBootcampCallbackKey is a stable 32-char hex per transaction', () => {
        const k1 = BootcampCatalogService.getBootcampCallbackKey('TXN-1');
        const k2 = BootcampCatalogService.getBootcampCallbackKey('TXN-1');
        const k3 = BootcampCatalogService.getBootcampCallbackKey('TXN-2');
        expect(k1).toBe(k2);
        expect(k1).toHaveLength(32);
        expect(k1).toMatch(/^[0-9a-f]+$/);
        expect(k3).not.toBe(k1);
    });
});

describe('BootcampCatalogService.listBootcampPurchasesAdmin / getBootcampPurchaseStats', () => {
    const createPurchase = async (
        bootcampId: mongoose.Types.ObjectId,
        userId: mongoose.Types.ObjectId,
        overrides: Record<string, unknown> = {}
    ) =>
        BootcampPurchaseModel.create({
            user: userId,
            bootcamp: bootcampId,
            amount: 1500,
            method: 'SSLCommerz',
            transactionId: `BC-${uniq()}`,
            status: BootcampPurchaseStatus.Paid,
            ...overrides,
        });

    it('lists purchases with buyer + bootcamp populated', async () => {
        const bootcamp: any = await publishedCatalog();
        const paidBuyer = await createUser({
            email: `paid-${uniq()}@example.com`,
            name: 'Paid Buyer',
            phone: '01700000000',
        });
        const pendingBuyer = await createUser({
            email: `pending-${uniq()}@example.com`,
            name: 'Pending Buyer',
        });

        await createPurchase(bootcamp._id, paidBuyer._id);
        await createPurchase(bootcamp._id, pendingBuyer._id, {
            status: BootcampPurchaseStatus.Pending,
        });

        const result: any = await BootcampCatalogService.listBootcampPurchasesAdmin({
            page: 1,
            limit: 10,
        });

        expect(result.meta.total).toBe(2);
        expect(result.data).toHaveLength(2);

        const paid = result.data.find((p: any) => p.status === BootcampPurchaseStatus.Paid);
        expect(paid.user.name).toBe('Paid Buyer');
        expect(paid.user.email).toContain('paid-');
        expect(paid.bootcamp.slug).toBe(bootcamp.slug);
    });

    it('paginates the admin purchase list', async () => {
        const bootcamp: any = await publishedCatalog();
        const buyer = await createUser({ email: `paged-${uniq()}@example.com` });
        await Promise.all(
            Array.from({ length: 5 }, () => createPurchase(bootcamp._id, buyer._id))
        );

        const firstPage: any = await BootcampCatalogService.listBootcampPurchasesAdmin({
            page: 1,
            limit: 2,
        });
        expect(firstPage.data).toHaveLength(2);
        expect(firstPage.meta.total).toBe(5);
        expect(firstPage.meta.totalPages).toBe(3);

        const lastPage: any = await BootcampCatalogService.listBootcampPurchasesAdmin({
            page: 3,
            limit: 2,
        });
        expect(lastPage.data).toHaveLength(1);
    });

    it('filters by status, bootcamp, buyer search, transaction id and date range', async () => {
        const bootcampA: any = await publishedCatalog();
        const bootcampB: any = await publishedCatalog();
        const buyer = await createUser({
            email: `searchable-${uniq()}@example.com`,
            name: 'Searchable Buyer',
        });
        const other = await createUser({ email: `other-${uniq()}@example.com`, name: 'Other Buyer' });

        const paidTxn = `BC-PAID-${uniq()}`;
        await createPurchase(bootcampA._id, buyer._id, { transactionId: paidTxn });
        await createPurchase(bootcampB._id, other._id, {
            transactionId: `BC-REJECTED-${uniq()}`,
            status: BootcampPurchaseStatus.Rejected,
        });

        const paidOnly: any = await BootcampCatalogService.listBootcampPurchasesAdmin({
            status: BootcampPurchaseStatus.Paid,
        });
        expect(paidOnly.meta.total).toBe(1);
        expect(paidOnly.data[0].transactionId).toBe(paidTxn);

        const scopedToB: any = await BootcampCatalogService.listBootcampPurchasesAdmin({
            bootcampId: bootcampB._id.toString(),
        });
        expect(scopedToB.meta.total).toBe(1);
        expect(scopedToB.data[0].bootcamp._id.toString()).toBe(bootcampB._id.toString());

        const byBuyerName: any = await BootcampCatalogService.listBootcampPurchasesAdmin({
            search: 'searchable buyer',
        });
        expect(byBuyerName.meta.total).toBe(1);

        const byTransactionId: any = await BootcampCatalogService.listBootcampPurchasesAdmin({
            search: paidTxn,
        });
        expect(byTransactionId.meta.total).toBe(1);

        const outsideRange: any = await BootcampCatalogService.listBootcampPurchasesAdmin({
            from: new Date('2000-01-01'),
            to: new Date('2000-12-31'),
        });
        expect(outsideRange.meta.total).toBe(0);
    });

    it('aggregates counts, revenue and today, scoped to a bootcamp', async () => {
        const bootcampA: any = await publishedCatalog();
        const bootcampB: any = await publishedCatalog();
        const buyer = await createUser({ email: `stats-${uniq()}@example.com` });

        await createPurchase(bootcampA._id, buyer._id, { amount: 1000 });
        await createPurchase(bootcampA._id, buyer._id, { amount: 500 });
        await createPurchase(bootcampB._id, buyer._id, {
            amount: 700,
            status: BootcampPurchaseStatus.Pending,
        });

        const stats: any = await BootcampCatalogService.getBootcampPurchaseStats();
        expect(stats.total).toBe(3);
        expect(stats.paid).toBe(2);
        expect(stats.pending).toBe(1);
        expect(stats.rejected).toBe(0);
        expect(stats.revenue).toBe(1500);
        expect(stats.today).toBe(3);

        const scoped: any = await BootcampCatalogService.getBootcampPurchaseStats({
            bootcampId: bootcampB._id.toString(),
        });
        expect(scoped.total).toBe(1);
        expect(scoped.paid).toBe(0);
        expect(scoped.revenue).toBe(0);
    });
});
