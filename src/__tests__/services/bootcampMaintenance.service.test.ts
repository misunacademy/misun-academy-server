import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser } from '../helpers/factories.js';
import { BootcampCatalogModel } from '../../modules/Bootcamp/bootcampCatalog.model.js';
import { BootcampPurchaseModel } from '../../modules/Bootcamp/bootcampPurchase.model.js';
import {
    BootcampStatus,
    RecordedStatus,
    BootcampPurchaseStatus,
} from '../../modules/Bootcamp/bootcampCatalog.interface.js';
import {
    BootcampPaymentAttemptModel,
    BootcampPaymentAttemptStatus,
} from '../../modules/Bootcamp/bootcampPaymentAttempt.model.js';
import { expireAbandonedBootcampPurchases } from '../../modules/Bootcamp/bootcampMaintenance.service.js';

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

describe('expireAbandonedBootcampPurchases', () => {
    beforeAll(async () => connectTestDB());
    afterAll(async () => disconnectTestDB());
    beforeEach(async () => clearTestDB());

    it('rejects stale pending purchases and closes their pending attempt', async () => {
        const user = await createUser({ email: `bootcamp-expiry-${uniq()}@example.com` });
        const bootcamp: any = await BootcampCatalogModel.create({
            title: `Expiry Bootcamp ${uniq()}`,
            season: 'Season 1',
            slug: `expiry-${uniq()}`,
            status: BootcampStatus.Completed,
            recordedStatus: RecordedStatus.Published,
            recordedPrice: 1000,
            liveFee: 0,
        });
        const purchase: any = await BootcampPurchaseModel.create({
            user: user._id,
            bootcamp: bootcamp._id,
            amount: 1000,
            method: 'SSLCommerz',
            transactionId: `BC-${uniq()}`,
            status: BootcampPurchaseStatus.Pending,
            createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        });
        await BootcampPaymentAttemptModel.create({
            purchase: purchase._id,
            user: user._id,
            bootcamp: bootcamp._id,
            amount: 1000,
            transactionId: purchase.transactionId,
            status: BootcampPaymentAttemptStatus.Pending,
        });

        const result = await expireAbandonedBootcampPurchases({ olderThanMinutes: 60 });
        expect(result.expired).toBe(1);

        const updated: any = await BootcampPurchaseModel.findById(purchase._id).lean();
        const attempt: any = await BootcampPaymentAttemptModel.findOne({
            transactionId: purchase.transactionId,
        }).lean();
        expect(updated.status).toBe(BootcampPurchaseStatus.Rejected);
        expect(updated.gatewayResponse.status).toBe('expired');
        expect(attempt.status).toBe(BootcampPaymentAttemptStatus.Failed);
    });

    it('does not expire a fresh pending purchase', async () => {
        const user = await createUser({ email: `bootcamp-fresh-${uniq()}@example.com` });
        const bootcamp = await BootcampCatalogModel.create({
            title: `Fresh Bootcamp ${uniq()}`,
            season: 'Season 1',
            slug: `fresh-${uniq()}`,
            status: BootcampStatus.Completed,
            recordedStatus: RecordedStatus.Published,
            recordedPrice: 1000,
            liveFee: 0,
        });
        await BootcampPurchaseModel.create({
            user: user._id,
            bootcamp: bootcamp._id,
            amount: 1000,
            method: 'SSLCommerz',
            transactionId: `BC-${uniq()}`,
            status: BootcampPurchaseStatus.Pending,
        });

        const result = await expireAbandonedBootcampPurchases({ olderThanMinutes: 60 });
        expect(result.expired).toBe(0);
        expect(await BootcampPurchaseModel.countDocuments({
            status: BootcampPurchaseStatus.Pending,
        })).toBe(1);
    });
});
