import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser } from '../helpers/factories.js';
import { BootcampService } from '../../modules/Bootcamp/bootcamp.service.js';
import { BootcampRegistrationModel } from '../../modules/Bootcamp/bootcamp.model.js';
import { BootcampCatalogModel } from '../../modules/Bootcamp/bootcampCatalog.model.js';
import { BootcampRegistrationStatus } from '../../modules/Bootcamp/bootcamp.interface.js';
import { AuditLogModel } from '../../models/auditLog.model.js';

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

const openCatalog = (overrides: Record<string, unknown> = {}) =>
    BootcampCatalogModel.create({
        title: `Bootcamp ${uniq()}`,
        season: 'Season 7',
        slug: `bootcamp-${uniq()}`,
        status: 'upcoming',
        registrationOpen: true,
        startDate: new Date('2030-01-01'),
        ...overrides,
    });

const regPayload = (overrides: Record<string, unknown> = {}) => ({
    name: 'Test Student',
    whatsapp: `017${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    address: 'Khulna, Bangladesh',
    email: `student-${uniq()}@example.com`,
    paymentLast4: '1234',
    ...overrides,
});

describe('BootcampService.registerBootcampRegistration', () => {
    it('rejects when registration is closed (no open catalog)', async () => {
        await expect(
            BootcampService.registerBootcampRegistration(regPayload())
        ).rejects.toThrow(/registration is currently closed/i);
    });

    it('rejects missing required fields', async () => {
        await openCatalog();
        await expect(
            BootcampService.registerBootcampRegistration({ name: 'Only Name' })
        ).rejects.toThrow(/Missing required registration fields/i);
    });

    it('creates a pending registration and normalizes email', async () => {
        await openCatalog();
        const created: any = await BootcampService.registerBootcampRegistration(
            regPayload({ email: `  UPPER-${uniq()}@EXAMPLE.com  ` })
        );
        expect(created.status).toBe(BootcampRegistrationStatus.Pending);
        expect(created.email).toBe(created.email.toLowerCase().trim());
    });

    it('strips unexpected fields (e.g. status) from the payload', async () => {
        await openCatalog();
        const created: any = await BootcampService.registerBootcampRegistration({
            ...regPayload(),
            status: BootcampRegistrationStatus.Verified,
            adminNote: 'self-approved',
        });
        expect(created.status).toBe(BootcampRegistrationStatus.Pending);
        expect(created.adminNote).toBeUndefined();
    });

    it('rejects duplicate email and duplicate whatsapp', async () => {
        await openCatalog();
        const first = regPayload();
        await BootcampService.registerBootcampRegistration({ ...first });

        await expect(
            BootcampService.registerBootcampRegistration({ ...regPayload(), email: first.email })
        ).rejects.toThrow(/already registered/i);

        await expect(
            BootcampService.registerBootcampRegistration({ ...regPayload(), whatsapp: first.whatsapp })
        ).rejects.toThrow(/already registered/i);
    });

    it('allows re-registration after a rejection', async () => {
        await openCatalog();
        const payload = regPayload();
        const created: any = await BootcampService.registerBootcampRegistration({ ...payload });
        await BootcampRegistrationModel.findByIdAndUpdate(created._id, {
            status: BootcampRegistrationStatus.Rejected,
        });

        const retry: any = await BootcampService.registerBootcampRegistration({ ...payload });
        expect(retry.status).toBe(BootcampRegistrationStatus.Pending);
    });
});

describe('BootcampService.getAllBootcampRegistrations / stats', () => {
    it('paginates with meta and filters by status', async () => {
        await openCatalog();
        const a: any = await BootcampService.registerBootcampRegistration(regPayload({ name: 'Alpha One' }));
        await BootcampService.registerBootcampRegistration(regPayload({ name: 'Beta Two' }));
        await BootcampRegistrationModel.findByIdAndUpdate(a._id, {
            status: BootcampRegistrationStatus.Verified,
        });

        const page: any = await BootcampService.getAllBootcampRegistrations({ page: 1, limit: 1 });
        expect(page.data).toHaveLength(1);
        expect(page.meta.total).toBe(2);
        expect(page.meta.totalPages).toBe(2);

        const verified: any = await BootcampService.getAllBootcampRegistrations({
            status: BootcampRegistrationStatus.Verified,
        });
        expect(verified.meta.total).toBe(1);

        const searched: any = await BootcampService.getAllBootcampRegistrations({ search: 'alpha' });
        expect(searched.meta.total).toBe(1);
        expect(searched.data[0].name).toBe('Alpha One');
    });

    it('getBootcampRegistrationStats breaks down counts', async () => {
        await openCatalog();
        const a: any = await BootcampService.registerBootcampRegistration(regPayload());
        await BootcampService.registerBootcampRegistration(regPayload());
        await BootcampRegistrationModel.findByIdAndUpdate(a._id, {
            status: BootcampRegistrationStatus.Verified,
        });

        const stats = await BootcampService.getBootcampRegistrationStats();
        expect(stats.total).toBe(2);
        expect(stats.verified).toBe(1);
        expect(stats.pending).toBe(1);
        expect(stats.rejected).toBe(0);
        expect(stats.today).toBe(2);
    });
});

describe('BootcampService.updateBootcampRegistration / deleteBootcampRegistration', () => {
    it('verifies a registration, stamps reviewer and audits', async () => {
        await openCatalog();
        const adminUser = await createUser({ email: `adm-${uniq()}@example.com`, role: 'admin' });
        const created: any = await BootcampService.registerBootcampRegistration(regPayload());

        const updated: any = await BootcampService.updateBootcampRegistration(
            created._id.toString(),
            { status: BootcampRegistrationStatus.Verified, adminNote: 'Payment OK' },
            { id: adminUser._id.toString(), role: 'admin' }
        );

        expect(updated.status).toBe(BootcampRegistrationStatus.Verified);
        expect(updated.adminNote).toBe('Payment OK');
        expect(updated.reviewedBy.toString()).toBe(adminUser._id.toString());
        expect(updated.reviewedAt).toBeDefined();

        const audit = await AuditLogModel.findOne({ action: 'bootcamp_registration_update' }).lean();
        expect(audit).toBeDefined();
    });

    it('moving back to pending clears reviewer fields', async () => {
        await openCatalog();
        const adminUser = await createUser({ email: `adm-${uniq()}@example.com`, role: 'admin' });
        const created: any = await BootcampService.registerBootcampRegistration(regPayload());
        const actor = { id: adminUser._id.toString(), role: 'admin' };

        await BootcampService.updateBootcampRegistration(
            created._id.toString(),
            { status: BootcampRegistrationStatus.Verified },
            actor
        );
        const back: any = await BootcampService.updateBootcampRegistration(
            created._id.toString(),
            { status: BootcampRegistrationStatus.Pending },
            actor
        );
        expect(back.status).toBe(BootcampRegistrationStatus.Pending);
        expect(back.reviewedBy).toBeUndefined();
        expect(back.reviewedAt).toBeUndefined();
    });

    it('throws NOT_FOUND for unknown registration', async () => {
        const adminUser = await createUser({ email: `adm-${uniq()}@example.com`, role: 'admin' });
        await expect(
            BootcampService.updateBootcampRegistration(
                new mongoose.Types.ObjectId().toString(),
                { status: BootcampRegistrationStatus.Verified },
                { id: adminUser._id.toString() }
            )
        ).rejects.toThrow(/not found/i);
    });

    it('deleteBootcampRegistration removes and audits', async () => {
        await openCatalog();
        const adminUser = await createUser({ email: `adm-${uniq()}@example.com`, role: 'admin' });
        const created: any = await BootcampService.registerBootcampRegistration(regPayload());

        await BootcampService.deleteBootcampRegistration(created._id.toString(), {
            id: adminUser._id.toString(),
            role: 'admin',
        });

        expect(await BootcampRegistrationModel.countDocuments({ _id: created._id })).toBe(0);
        const audit = await AuditLogModel.findOne({ action: 'bootcamp_registration_delete' }).lean();
        expect(audit).toBeDefined();
    });

    it('deleteBootcampRegistration throws NOT_FOUND for unknown id', async () => {
        const adminUser = await createUser({ email: `adm-${uniq()}@example.com`, role: 'admin' });
        await expect(
            BootcampService.deleteBootcampRegistration(new mongoose.Types.ObjectId().toString(), {
                id: adminUser._id.toString(),
            })
        ).rejects.toThrow(/not found/i);
    });
});
