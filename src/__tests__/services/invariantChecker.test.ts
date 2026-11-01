import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch, createEnrollment, createPayment } from '../helpers/factories.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { EnrollmentStatusHistoryModel } from '../../modules/Enrollment/enrollmentStatusHistory.model.js';
import { CertificateModel } from '../../modules/Certificate/certificate.model.js';
import { BootcampPurchaseModel } from '../../modules/Bootcamp/bootcampPurchase.model.js';
import { runEnrollmentInvariants } from '../../services/invariantChecker.js';
import { EnrollmentStatus, Status, CertificateStatus, UserStatus } from '../../types/common.js';
import { InvariantResult } from '../../services/invariantChecker.js';

const HOUR_MS = 60 * 60 * 1000;

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

describe('InvariantChecker — enrollment invariants', () => {
    it('check 1: no duplicate non-terminal enrollment per user + batch', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

        // Insert directly via collection to bypass unique index.
        // The unique index covers Pending/PaymentPending/Active/Completed/Suspended,
        // but NOT Expired — so Expired duplicates are the realistic case.
        await EnrollmentModel.collection.insertOne({
            userId: user._id,
            batchId: batch._id,
            status: EnrollmentStatus.Expired,
            enrollmentId: 'DUP-ENR-1',
        });
        await EnrollmentModel.collection.insertOne({
            userId: user._id,
            batchId: batch._id,
            status: EnrollmentStatus.Expired,
            enrollmentId: 'DUP-ENR-2',
        });

        const result = await runEnrollmentInvariants();
        const dupCheck = result.find((r: InvariantResult) => r.checkId === 'dup_enrollment');
        expect(dupCheck?.violatingIds.length).toBeGreaterThanOrEqual(1);
    });

    it('check 2: every active enrollment has success payment OR admin grant', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

        // Active enrollment without any payment record
        await createEnrollment(user._id, batch._id, { status: EnrollmentStatus.Active });

        const result = await runEnrollmentInvariants();
        const check = result.find((r: InvariantResult) => r.checkId === 'active_has_payment_or_grant');
        expect(check?.violatingIds.length).toBeGreaterThanOrEqual(1);
    });

    it('check 3: refunded enrollment implies refunded payment', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

        await createEnrollment(user._id, batch._id, {
            status: EnrollmentStatus.Refunded,
            paymentId: new mongoose.Types.ObjectId(),
        });

        const result = await runEnrollmentInvariants();
        const check = result.find((r: InvariantResult) => r.checkId === 'refunded_implies_refunded_payment');
        expect(check?.violatingIds.length).toBeGreaterThanOrEqual(1);
    });

    it('check 4: completed implies active certificate', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

        await createEnrollment(user._id, batch._id, { status: EnrollmentStatus.Completed });

        const result = await runEnrollmentInvariants();
        const check = result.find((r: InvariantResult) => r.checkId === 'completed_implies_certificate');
        expect(check?.violatingIds.length).toBeGreaterThanOrEqual(1);
    });

    it('check 5: suspended user has no active enrollments', async () => {
        const user = await createUser({ status: UserStatus.Suspended });
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

        await createEnrollment(user._id, batch._id, { status: EnrollmentStatus.Active });

        const result = await runEnrollmentInvariants();
        const check = result.find((r: InvariantResult) => r.checkId === 'suspended_no_active');
        expect(check?.violatingIds.length).toBeGreaterThanOrEqual(1);
    });

    it('check 6: every success payment has enrollment', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

        await createPayment(user._id, batch._id, {
            status: Status.Success,
        });

        const result = await runEnrollmentInvariants();
        const check = result.find((r: InvariantResult) => r.checkId === 'success_has_enrollment');
        expect(check?.violatingIds.length).toBeGreaterThanOrEqual(1);
    });

    it('check 7: no pending enrollment older than expiry window', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id, {
            enrollmentEndDate: new Date(Date.now() + 86400000),
        });

        const enrollment = await createEnrollment(user._id, batch._id, {
            status: EnrollmentStatus.Pending,
        });

        // Backdate beyond 48h expiry
        await EnrollmentModel.findByIdAndUpdate(
            enrollment._id,
            { updatedAt: new Date(Date.now() - 100 * 60 * 60 * 1000) },
            { timestamps: false }
        );

        const result = await runEnrollmentInvariants();
        const check = result.find((r: InvariantResult) => r.checkId === 'no_stale_pending');
        expect(check?.violatingIds.length).toBeGreaterThanOrEqual(1);
    });

    it('check 8: every enrollment status change has history row', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

        const enrollment = await createEnrollment(user._id, batch._id, {
            status: EnrollmentStatus.Active,
        });

        // Delete any history rows for this enrollment
        await EnrollmentStatusHistoryModel.deleteMany({ enrollmentId: enrollment._id });

        const result = await runEnrollmentInvariants();
        const check = result.find((r: InvariantResult) => r.checkId === 'status_has_history');
        expect(check?.violatingIds.length).toBeGreaterThanOrEqual(1);
    });

    it('check 9: every success payment has val_id OR manual approval audit', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

        await createPayment(user._id, batch._id, {
            status: Status.Success,
            gatewayResponse: {}, // no val_id
        });

        const result = await runEnrollmentInvariants();
        const check = result.find((r: InvariantResult) => r.checkId === 'success_has_validation');
        expect(check?.violatingIds.length).toBeGreaterThanOrEqual(1);
    });

    it('returns empty when all invariants hold', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

        // Valid: active enrollment with payment and certificate
        const enrollment = await createEnrollment(user._id, batch._id, {
            status: EnrollmentStatus.Active,
        });
        await createPayment(user._id, batch._id, {
            status: Status.Success,
            enrollmentId: enrollment.enrollmentId,
            gatewayResponse: { val_id: 'VAL123' },
        });
        await CertificateModel.create({
            enrollmentId: enrollment._id,
            userId: user._id,
            batchId: batch._id,
            courseId: course._id,
            certificateId: 'CERT-TEST',
            status: CertificateStatus.Active,
            issuedBy: user._id,
            verificationUrl: 'https://example.com/verify/CERT-TEST',
            certificateUrl: 'https://example.com/cert/CERT-TEST.pdf',
        });
        await EnrollmentStatusHistoryModel.create({
            enrollmentId: enrollment._id,
            userId: user._id,
            batchId: batch._id,
            from: EnrollmentStatus.Pending,
            to: EnrollmentStatus.Active,
            actorType: 'user',
            source: 'test',
        });

        const result = await runEnrollmentInvariants();
        const violations = result.reduce((sum: number, r: InvariantResult) => sum + r.violatingIds.length, 0);
        expect(violations).toBe(0);
    });
});

describe('InvariantChecker — bootcamp invariants', () => {
    it('check 13: Paid purchase without validated payment is violation', async () => {
        const user = await createUser();
        await BootcampPurchaseModel.create({
            user: user._id,
            bootcamp: new mongoose.Types.ObjectId(),
            amount: 1000,
            transactionId: 'TXN-NO-VALIDATION',
            status: 'paid',
            gatewayResponse: {}, // no val_id
        });

        const result = await runEnrollmentInvariants();
        const check = result.find((r: InvariantResult) => r.checkId === 'bootcamp_paid_has_validation');
        expect(check?.violatingIds.length).toBeGreaterThanOrEqual(1);
    });

    it('check 14: no duplicate Paid purchase per user + product', async () => {
        const user = await createUser();
        const productId = new mongoose.Types.ObjectId();
        await BootcampPurchaseModel.create({
            user: user._id,
            bootcamp: productId,
            amount: 1000,
            transactionId: 'TXN-DUP-1',
            status: 'paid',
        });
        await BootcampPurchaseModel.create({
            user: user._id,
            bootcamp: productId,
            amount: 1000,
            transactionId: 'TXN-DUP-2',
            status: 'paid',
        });

        const result = await runEnrollmentInvariants();
        const check = result.find((r: InvariantResult) => r.checkId === 'bootcamp_no_duplicate_paid');
        expect(check?.violatingIds.length).toBeGreaterThanOrEqual(1);
    });
});
