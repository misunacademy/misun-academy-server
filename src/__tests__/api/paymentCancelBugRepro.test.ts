/**
 * Reproduction tests for the cancel/fail 404 bug.
 *
 * Bug: POST /api/v1/payments/status?t=<tran_id>&status=cancel&k=<key>
 * returns 404 "Payment data not found!" even though the payment was just
 * initiated.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import type { Express } from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';

import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch } from '../helpers/factories.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { PaymentModel } from '../../modules/Payment/payment.model.js';
import { PaymentService } from '../../modules/Payment/payment.service.js';
import { recordGatewayPaymentAttempt } from '../../modules/Payment/payment.service.js';
import { EnrollmentService } from '../../modules/Enrollment/enrollment.service.js';
import { EnrollmentStatus, Status } from '../../types/common.js';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/test-placeholder';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'test-secret-test-secret-test-secret';
process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL || 'http://localhost:5000/api/v1/auth';
process.env.SSL_STORE_ID = process.env.SSL_STORE_ID || 'test-store';
process.env.SSL_STORE_PASSWORD = process.env.SSL_STORE_PASSWORD || 'test-store-pass';
process.env.SSL_IS_LIVE = process.env.SSL_IS_LIVE || 'false';
process.env.SSL_VALIDATION_API =
    process.env.SSL_VALIDATION_API || 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php';
process.env.SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';
process.env.MA_FRONTEND_URL = process.env.MA_FRONTEND_URL || 'http://localhost:3000';

let app: Express;

const statusCallbackKey = (transactionId: string): string =>
    crypto
        .createHmac('sha256', process.env.SSL_STORE_PASSWORD!)
        .update(transactionId)
        .digest('hex')
        .slice(0, 32);

const postStatusRedirect = (
    tranId: string,
    overrides: Record<string, string | undefined> = {}
) =>
    request(app)
        .post('/api/v1/payments/status')
        .send({ tran_id: tranId, k: statusCallbackKey(tranId), ...overrides });

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

beforeEach(async () => {
    await clearTestDB();
});

const seedEnrollmentAndPayment = async () => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id, {
        title: `Cancel Test Course ${Date.now()}`,
        slug: `cancel-test-course-${Date.now()}`,
    });
    const batch = await createBatch(course._id, {
        price: 5000,
        currency: 'BDT',
    });

    const enrollment = await EnrollmentService.initiateEnrollment(
        user._id.toString(),
        batch._id.toString()
    );

    const paymentResult = await PaymentService.initiateSSLCommerzPayment(
        enrollment.enrollment._id,
        user._id.toString()
    );

    return { user, batch, enrollment: enrollment.enrollment, paymentResult };
};

describe('Bug reproduction: cancel/fail callback 404', () => {
    it('cancel callback on freshly-initiated payment redirects instead of 404', async () => {
        const { enrollment, paymentResult } = await seedEnrollmentAndPayment();

        // Log the tran_id at init vs the DB row
        const dbPayment = await PaymentModel.findOne({
            enrollmentRef: enrollment._id,
        }).lean();
        console.log('INIT tran_id:', paymentResult.transactionId);
        console.log('DB tran_id:', dbPayment?.transactionId);
        console.log('DB status:', dbPayment?.status);
        console.log('DB enrollmentRef:', dbPayment?.enrollmentRef?.toString());
        console.log('Enrollment _id:', enrollment._id.toString());

        // The tran_id sent to SSLCommerz must match the DB row
        expect(dbPayment?.transactionId).toBe(paymentResult.transactionId);
        expect(dbPayment?.status).toBe(Status.Pending);

        const res = await postStatusRedirect(paymentResult.transactionId, {
            status: 'cancel',
        });
        console.log('Cancel response status:', res.status);
        console.log('Cancel response location:', res.headers.location);

        // Must redirect, never return JSON 404
        expect([301, 302]).toContain(res.status);
        expect(res.headers.location).toContain('status=cancelled');

        // Payment must now be Cancel
        const after = await PaymentModel.findOne({
            transactionId: paymentResult.transactionId,
        }).lean();
        expect(after?.status).toBe(Status.Cancel);
    });

    it('cancel twice is idempotent — second cancel is a no-op', async () => {
        const { paymentResult } = await seedEnrollmentAndPayment();

        // First cancel
        const res1 = await postStatusRedirect(paymentResult.transactionId, {
            status: 'cancel',
        });
        expect([301, 302]).toContain(res1.status);

        // Second cancel (same tran_id)
        const res2 = await postStatusRedirect(paymentResult.transactionId, {
            status: 'cancel',
        });
        expect([301, 302]).toContain(res2.status);

        const after = await PaymentModel.findOne({
            transactionId: paymentResult.transactionId,
        }).lean();
        expect(after?.status).toBe(Status.Cancel);
    });

    it('cancel after retry — old attempt Cancel, new attempt Cancel', async () => {
        const { enrollment, paymentResult: firstResult, user } = await seedEnrollmentAndPayment();

        // Cancel the first attempt
        await postStatusRedirect(firstResult.transactionId, { status: 'cancel' });

        // Verify first attempt is Cancel
        const firstAfter = await PaymentModel.findOne({
            transactionId: firstResult.transactionId,
        }).lean();
        expect(firstAfter?.status).toBe(Status.Cancel);

        // Retry: initiate a new payment for the same enrollment (same user)
        const secondResult = await PaymentService.initiateSSLCommerzPayment(
            enrollment._id,
            user._id.toString()
        );
        expect(secondResult.transactionId).not.toBe(firstResult.transactionId);

        // Verify old transactionId is in supersededTranIds
        const retryPayment = await PaymentModel.findOne({
            transactionId: secondResult.transactionId,
        }).lean();
        expect(retryPayment?.gatewayResponse?.supersededTranIds).toContain(
            firstResult.transactionId
        );

        // Cancel the new attempt
        await postStatusRedirect(secondResult.transactionId, { status: 'cancel' });

        // The current row should have the new transactionId and be Cancel.
        // The old transactionId lives in supersededTranIds.
        const current = await PaymentModel.findOne({
            enrollmentRef: enrollment._id,
        }).lean();
        expect(current?.transactionId).toBe(secondResult.transactionId);
        expect(current?.status).toBe(Status.Cancel);
        expect(current?.gatewayResponse?.supersededTranIds).toContain(
            firstResult.transactionId
        );

        // Looking up the old tran_id via supersededTranIds still resolves.
        const viaSuperseded = await PaymentModel.findOne({
            $or: [
                { transactionId: firstResult.transactionId },
                { 'gatewayResponse.supersededTranIds': firstResult.transactionId },
            ],
        }).lean();
        expect(viaSuperseded?.status).toBe(Status.Cancel);
    });

    it('cancel callback with unknown tran_id redirects to not_found (no JSON)', async () => {
        const unknownTran = `TXN_UNKNOWN_${Date.now()}`;
        const res = await postStatusRedirect(unknownTran, { status: 'cancel' });
        console.log('Unknown tran response status:', res.status);
        console.log('Unknown tran response body:', res.text);
        console.log('Unknown tran response location:', res.headers.location);

        // Must redirect to not_found, never return raw JSON 404
        expect([301, 302]).toContain(res.status);
        expect(res.headers.location).toContain('status=not_found');
    });

    it('cancel after Success stays Success (never overwrites)', async () => {
        const { enrollment } = await seedEnrollmentAndPayment();

        // First, mark the payment as Success
        await PaymentModel.findOneAndUpdate(
            { enrollmentRef: enrollment._id },
            { $set: { status: Status.Success, verifiedAt: new Date() } }
        );

        const payment = await PaymentModel.findOne({ enrollmentRef: enrollment._id }).lean();
        const res = await postStatusRedirect(payment!.transactionId, {
            status: 'cancel',
        });
        expect([301, 302]).toContain(res.status);

        // Must still be Success
        const after = await PaymentModel.findOne({
            transactionId: payment!.transactionId,
        }).lean();
        expect(after?.status).toBe(Status.Success);
    });
});

describe('Service-level: recordGatewayPaymentAttempt persistence', () => {
    it('persists Payment row with the same transactionId passed in', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id, { price: 5000 });
        const enrollment = await EnrollmentModel.create({
            userId: user._id,
            batchId: batch._id,
            status: EnrollmentStatus.PaymentPending,
        });

        const tranId = `TXN_PERSIST_${Date.now()}`;
        const result = await recordGatewayPaymentAttempt({
                userId: user._id.toString(),
                batch: batch as any,
                enrollmentId: '',
                enrollmentRef: enrollment._id,
                transactionId: tranId,
            }
        );
        expect(result).toBeTruthy();

        console.log('Persisted tran_id:', result!.transactionId);
        console.log('Persisted status:', result!.status);

        expect(result!.transactionId).toBe(tranId);
        expect(result!.status).toBe(Status.Pending);

        const dbRow = await PaymentModel.findOne({ transactionId: tranId }).lean();
        expect(dbRow).toBeTruthy();
        expect(dbRow?.transactionId).toBe(tranId);
        expect(dbRow?.enrollmentRef?.toString()).toBe(enrollment._id.toString());
    });

    it('retry with new transactionId supersedes old one', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id, { price: 5000 });
        const enrollment = await EnrollmentModel.create({
            userId: user._id,
            batchId: batch._id,
            status: EnrollmentStatus.PaymentPending,
        });

        // First attempt
        await recordGatewayPaymentAttempt({
            userId: user._id.toString(),
            batch: batch as any,
            enrollmentId: '',
            enrollmentRef: enrollment._id,
            transactionId: `TXN_RETRY_1_${Date.now()}`,
        });

        // Cancel first attempt
        const firstPayment = await PaymentModel.findOne({
            enrollmentRef: enrollment._id,
        }).lean();
        await PaymentService.handleCancelPayment(firstPayment!.transactionId);

        // Second attempt (retry)
        await recordGatewayPaymentAttempt({
            userId: user._id.toString(),
            batch: batch as any,
            enrollmentId: '',
            enrollmentRef: enrollment._id,
            transactionId: `TXN_RETRY_2_${Date.now()}`,
        });

        // Should now have one Pending row with the new transactionId
        const pending = await PaymentModel.findOne({
            enrollmentRef: enrollment._id,
            status: Status.Pending,
        }).lean();
        expect(pending).toBeTruthy();

        // Old transactionId should be in supersededTranIds
        expect(pending?.gatewayResponse?.supersededTranIds).toContain(
            firstPayment!.transactionId
        );
    });
});

describe('Regression: tran_id persistence and cancel after initiate', () => {
    it('(a) after initiate, Payment row exists with exact tran_id sent to gateway', async () => {
        const { enrollment, paymentResult } = await seedEnrollmentAndPayment();

        const dbRow = (await PaymentModel.findOne({
            transactionId: paymentResult.transactionId,
        }).lean())!;

        expect(dbRow.transactionId).toBe(paymentResult.transactionId);
        expect(dbRow.status).toBe(Status.Pending);
        expect(dbRow.enrollmentRef?.toString()).toBe(enrollment._id.toString());
        expect(dbRow.enrollmentId).toBeUndefined();
    });

    it('(b) cancel callback right after initiate -> status Cancel and redirect status=cancelled', async () => {
        const { enrollment: _enrollment, paymentResult } = await seedEnrollmentAndPayment();

        const res = await postStatusRedirect(paymentResult.transactionId, {
            status: 'cancel',
        });
        expect([301, 302]).toContain(res.status);
        expect(res.headers.location).toContain('status=cancelled');

        const after = await PaymentModel.findOne({
            transactionId: paymentResult.transactionId,
        }).lean();
        expect(after?.status).toBe(Status.Cancel);
    });

    it('(c) two users with no-enrollmentId payments both succeed (partial index allows)', async () => {
        // Drop all non-_id indexes so syncIndexes can rebuild from current schema
        // (avoids conflicts with stale non-unique enrollmentRef_1 from older schema).
        const db = mongoose.connection.db!;
        const indexes = await db.collection('payments').indexes();
        for (const idx of indexes) {
            if (idx.name !== '_id_') {
                try {
                    await db.collection('payments').dropIndex(idx.name!);
                } catch {
                    // ignore
                }
            }
        }
        await PaymentModel.syncIndexes();

        const userA = await createUser();
        const userB = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id, {
            title: `NoID Course ${Date.now()}`,
            slug: `noid-course-${Date.now()}`,
        });
        const batch = await createBatch(course._id, { price: 5000 });

        const enrollmentA = await EnrollmentModel.create({
            userId: userA._id,
            batchId: batch._id,
            status: EnrollmentStatus.PaymentPending,
        });
        const enrollmentB = await EnrollmentModel.create({
            userId: userB._id,
            batchId: batch._id,
            status: EnrollmentStatus.PaymentPending,
        });

        // Both payments have no enrollmentId — partial unique index should allow both.
        const paymentA = await recordGatewayPaymentAttempt({
            userId: userA._id.toString(),
            batch: batch as any,
            enrollmentId: '',
            enrollmentRef: enrollmentA._id,
            transactionId: `TXN_NOID_A_${Date.now()}`,
        });
        const paymentB = await recordGatewayPaymentAttempt({
            userId: userB._id.toString(),
            batch: batch as any,
            enrollmentId: '',
            enrollmentRef: enrollmentB._id,
            transactionId: `TXN_NOID_B_${Date.now()}`,
        });

        expect(paymentA.enrollmentId).toBeUndefined();
        expect(paymentB.enrollmentId).toBeUndefined();
        expect(paymentA.transactionId).not.toBe(paymentB.transactionId);

        // Both rows should exist
        const rows = await PaymentModel.find({
            enrollmentRef: { $in: [enrollmentA._id, enrollmentB._id] },
        }).lean();
        expect(rows.length).toBe(2);
    });

    it('(d) recordGatewayPaymentAttempt returns saved row before gateway is called', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id, { price: 5000 });
        const enrollment = await EnrollmentModel.create({
            userId: user._id,
            batchId: batch._id,
            status: EnrollmentStatus.PaymentPending,
        });

        const tranId = `TXN_SAVED_${Date.now()}`;
        const saved = await recordGatewayPaymentAttempt({
            userId: user._id.toString(),
            batch: batch as any,
            enrollmentId: '',
            enrollmentRef: enrollment._id,
            transactionId: tranId,
        });

        // Row exists with exact tran_id before any gateway call
        expect(saved.transactionId).toBe(tranId);
        expect(saved.status).toBe(Status.Pending);
        expect(saved.enrollmentRef?.toString()).toBe(enrollment._id.toString());
        expect(saved.enrollmentId).toBeUndefined();

        // Verify the row is actually in the DB (not just returned)
        const dbRow = (await PaymentModel.findOne({ transactionId: tranId }).lean())!;
        expect(dbRow.transactionId).toBe(tranId);
    });
});

describe('Regression: manual payment settlement and user isolation', () => {
    it('(e) manual approve and admin re-verify activate enrollment and assign ID', async () => {
        const user = await createUser();
        const admin = await createAdmin();
        const course = await createCourse(admin._id, {
            title: `Manual Course ${Date.now()}`,
            slug: `manual-course-${Date.now()}`,
        });
        const batch = await createBatch(course._id, { price: 5000 });

        const enrollment = await EnrollmentModel.create({
            userId: user._id,
            batchId: batch._id,
            status: EnrollmentStatus.PaymentPending,
        });

        const tranId = `TXN_MANUAL_${Date.now()}`;
        const _payment = await PaymentModel.create({
            userId: user._id,
            batchId: batch._id,
            enrollmentRef: enrollment._id,
            transactionId: tranId,
            amount: 5000,
            currency: 'BDT',
            status: Status.Review,
            method: 'PhonePay',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        });

        // Approve via verifyManualPayment
        const approved = await PaymentService.verifyManualPayment(
            tranId,
            true,
            admin._id.toString()
        );

        expect(approved.status).toBe(Status.Success);
        expect(approved.enrollmentId).toMatch(/^MA-\d+/);
        expect(approved.verifiedAt).toBeTruthy();

        // Enrollment is Active
        const after = await EnrollmentModel.findById(enrollment._id).lean();
        expect(after?.status).toBe(EnrollmentStatus.Active);
        expect(after?.enrollmentId).toBe(approved.enrollmentId);
    });

    it('(f) manual payment for user B never touches user A payment', async () => {
        const admin = await createAdmin();
        const course = await createCourse(admin._id);
        const batch = await createBatch(course._id, { price: 5000 });

        const userA = await createUser();
        const userB = await createUser();

        const enrollmentA = await EnrollmentModel.create({
            userId: userA._id,
            batchId: batch._id,
            status: EnrollmentStatus.PaymentPending,
        });
        const enrollmentB = await EnrollmentModel.create({
            userId: userB._id,
            batchId: batch._id,
            status: EnrollmentStatus.PaymentPending,
        });

        const paymentA = await PaymentModel.create({
            userId: userA._id,
            batchId: batch._id,
            enrollmentRef: enrollmentA._id,
            transactionId: `TXN_ISO_A_${Date.now()}`,
            amount: 5000,
            currency: 'BDT',
            status: Status.Review,
            method: 'PhonePay',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        });

        const tranIdB = `TXN_ISO_B_${Date.now()}`;
        await PaymentModel.create({
            userId: userB._id,
            batchId: batch._id,
            enrollmentRef: enrollmentB._id,
            transactionId: tranIdB,
            amount: 5000,
            currency: 'BDT',
            status: Status.Review,
            method: 'PhonePay',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        });

        // Approve only user B's payment
        await PaymentService.verifyManualPayment(tranIdB, true, admin._id.toString());

        // User A's payment must be untouched
        const untouched = (await PaymentModel.findById(paymentA._id).lean())!;
        expect(untouched.status).toBe(Status.Review);
        expect(untouched.enrollmentId).toBeUndefined();

        // User B's enrollment is Active
        const enrollmentBAfter = await EnrollmentModel.findById(enrollmentB._id).lean();
        expect(enrollmentBAfter?.status).toBe(EnrollmentStatus.Active);
    });
});
