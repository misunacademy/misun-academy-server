import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch, createPayment } from '../helpers/factories.js';
import { PaymentService, recordGatewayPaymentAttempt, failEnrollment } from '../../modules/Payment/payment.service.js';
import { PaymentModel } from '../../modules/Payment/payment.model.js';
import { PaymentAttemptModel } from '../../modules/Payment/paymentAttempt.model.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { EnrollmentStatusHistoryModel } from '../../modules/Enrollment/enrollmentStatusHistory.model.js';
import { EnrollmentService } from '../../modules/Enrollment/enrollment.service.js';
import { Status } from '../../types/common.js';
import { EnrollmentStatus, BatchStatus } from '../../types/common.js';

let adminId: mongoose.Types.ObjectId;

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
    const admin = await createAdmin();
    adminId = admin._id;
});

describe('PaymentService.getMyPayments', () => {
    it('returns payments for a user with course info', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

        await createPayment(user._id, batch._id, {
            status: Status.Success,
        });

        const payments = await PaymentService.getMyPayments(user._id.toString());

        expect(payments).toHaveLength(1);
        expect(payments[0].status).toBe(Status.Success);
        expect(payments[0].course).toBeDefined();
        expect(payments[0].course.title).toBe(course.title);
    });

    it('returns empty array when user has no payments', async () => {
        const payments = await PaymentService.getMyPayments(
            new mongoose.Types.ObjectId().toString()
        );

        expect(payments).toEqual([]);
    });

    it('returns payments ordered by most recent first', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

        await createPayment(user._id, batch._id, {
            status: Status.Success,
            createdAt: new Date('2024-01-01'),
        } as any);

        await createPayment(user._id, batch._id, {
            status: Status.Pending,
            createdAt: new Date('2024-06-01'),
        } as any);

        const payments = await PaymentService.getMyPayments(user._id.toString());

        expect(payments).toHaveLength(2);
        expect(payments[0].status).toBe(Status.Pending);
        expect(payments[1].status).toBe(Status.Success);
    });

    it('hides failed and canceled gateway attempts from the learner', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

        await createPayment(user._id, batch._id, {
            status: Status.Success,
            transactionId: 'TXN-HIDDEN-1',
            enrollmentId: 'MY-HIDDEN-1',
        });
        await createPayment(user._id, batch._id, {
            status: Status.Failed,
            transactionId: 'TXN-HIDDEN-FAILED',
            enrollmentId: 'MY-HIDDEN-2',
        });
        await createPayment(user._id, batch._id, {
            status: Status.Cancel,
            transactionId: 'TXN-HIDDEN-CANCEL',
            enrollmentId: 'MY-HIDDEN-3',
        });

        const payments = await PaymentService.getMyPayments(user._id.toString());

        expect(payments).toHaveLength(1);
        expect(payments[0].status).toBe(Status.Success);
        expect(payments[0].transactionId).toBe('TXN-HIDDEN-1');
    });

    describe('EnrollmentService.initiateEnrollment', () => {
        it('creates a pending enrollment for a valid batch', async () => {
            const user = await createUser();
            const course = await createCourse(adminId);
            const batch = await createBatch(course._id);

            const result = await EnrollmentService.initiateEnrollment(user._id.toString(), batch._id.toString());

            expect(result).toBeTruthy();
            expect(result.enrollment).toBeTruthy();
            expect(result.enrollment.enrollmentId).toMatch(/^MA-\d+/);
            expect(result.enrollment.status).toBe(EnrollmentStatus.Pending);
        });

        it('throws ENROLLMENT_ALREADY_EXISTS for active enrollment', async () => {
            const user = await createUser();
            const course = await createCourse(adminId);
            const batch = await createBatch(course._id);

            await createPayment(user._id, batch._id, {
                transactionId: 'TXN-EXISTING',
                amount: 5000,
                currency: 'BDT',
                status: Status.Success,
                method: 'SSLCommerz',
            });

            await EnrollmentService.initiateEnrollment(user._id.toString(), batch._id.toString());

            await expect(
                EnrollmentService.initiateEnrollment(user._id.toString(), batch._id.toString())
            ).rejects.toThrow();
        });
    });
});

describe('Fix 19: PaymentAttempt one source of truth', () => {
    it('enforces sparse unique index on val_id', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

    await PaymentAttemptModel.create({
      userId: user._id,
      batchId: batch._id,
      enrollmentRef: new mongoose.Types.ObjectId(),
      enrollmentId: 'MA-1' + new Date().getFullYear() + '00001',
      transactionId: 'MA_RETRY_1',
      status: Status.Pending,
      amount: 1000,
      currency: 'BDT',
      method: 'SSLCommerz',
      gatewayResponse: { val_id: 'VAL_SAME_1' },
    });

        await expect(
            PaymentAttemptModel.create({
                userId: user._id,
                batchId: batch._id,
                enrollmentRef: new mongoose.Types.ObjectId(),
                enrollmentId: 'MA-1' + new Date().getFullYear() + '00006',
                transactionId: 'MA_RETRY_2',
                status: Status.Pending,
                gatewayResponse: { val_id: 'VAL_SAME_1' },
                method: 'SSLCommerz',
            })
        ).rejects.toThrow();
    });

    it('retry creates a new attempt linked to the same enrollment and supersedes the old one', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        const enrollmentId = 'MA-1' + new Date().getFullYear() + '00007';
        const enrollmentRef = new mongoose.Types.ObjectId();

        // First attempt - create directly
        await PaymentAttemptModel.create({
            userId: user._id,
            batchId: batch._id,
            enrollmentRef,
            enrollmentId,
            transactionId: 'MA_RETRY_FIRST',
            status: Status.Pending,
            amount: 1000,
            currency: 'BDT',
            method: 'SSLCommerz',
        });

        // Second attempt (retry) with a new tran_id
        const secondAttempt = await recordGatewayPaymentAttempt({
            userId: user._id.toString(),
            batch: batch as any,
            enrollmentId,
            enrollmentRef,
            transactionId: 'MA_RETRY_SECOND',
        });

        expect(secondAttempt).toBeTruthy();
        expect(secondAttempt.transactionId).toBe('MA_RETRY_SECOND');

        // First attempt should now be superseded
        const firstAttemptAfter = await PaymentAttemptModel.findOne({
            transactionId: 'MA_RETRY_FIRST',
        }).lean();
        expect(firstAttemptAfter).toBeTruthy();
        expect(firstAttemptAfter.status).toBe(Status.Superseded);
        expect((firstAttemptAfter.gatewayResponse as any)?.supersededBy).toBe('MA_RETRY_SECOND');

        // Payment row should point to the latest transactionId
        const payment = await PaymentModel.findOne({ enrollmentId }).lean();
        expect(payment?.transactionId).toBe('MA_RETRY_SECOND');

        // Only one active (non-superseded) attempt per enrollment
        const activeAttempts = await PaymentAttemptModel.find({
            enrollmentRef,
            status: Status.Pending,
        }).lean();
        expect(activeAttempts.length).toBe(1);
        expect(activeAttempts[0]?.transactionId).toBe('MA_RETRY_SECOND');
    });
});