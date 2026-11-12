import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch, createPayment } from '../helpers/factories.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { PaymentModel } from '../../modules/Payment/payment.model.js';
import { EnrollmentStatus, Status } from '../../types/common.js';
import { purgeTerminalPaymentRecords } from '../../modules/Payment/paymentCleanup.service.js';
import { expireAbandonedEnrollments } from '../../modules/Enrollment/enrollmentMaintenance.service.js';
import { AuditLogModel } from '../../models/auditLog.model.js';

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

describe('Fix 20: Retention without destroying audit trail', () => {
    it('archives expired enrollments instead of hard-deleting', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        const enrollment = await EnrollmentModel.create({
            userId: user._id,
            batchId: batch._id,
            status: EnrollmentStatus.Pending,
        });

        // Backdate updatedAt BEFORE expireAbandonedEnrollments so it finds the enrollment
        enrollment.updatedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
        await enrollment.save({ timestamps: false });

        // Expire the enrollment
        await expireAbandonedEnrollments({ olderThanHours: 48 });

        // Backdate updatedAt again after expireAbandonedEnrollments reset it to current time
        enrollment.updatedAt = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
        await enrollment.save({ timestamps: false });

        const result = await purgeTerminalPaymentRecords({ olderThanDays: 90 });

        const archived = await EnrollmentModel.findById(enrollment._id).lean();
        expect(archived).not.toBeNull();
        expect(archived!.archivedAt).toBeDefined();
        expect(result.enrollments).toBeGreaterThanOrEqual(1);
    });

    it('does not hard-delete enrollments - archivedAt is set instead', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        const enrollment = await EnrollmentModel.create({
            userId: user._id,
            batchId: batch._id,
            status: EnrollmentStatus.Pending,
        });

        // Backdate updatedAt BEFORE expireAbandonedEnrollments so it finds the enrollment
        await EnrollmentModel.findByIdAndUpdate(enrollment._id, {
            updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        }, { timestamps: false });

        await expireAbandonedEnrollments({ olderThanHours: 48 });

        // Backdate updatedAt again after expireAbandonedEnrollments reset it to current time
        await EnrollmentModel.findByIdAndUpdate(enrollment._id, {
            updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        }, { timestamps: false });

        await purgeTerminalPaymentRecords({ olderThanDays: 90 });

        const archived = await EnrollmentModel.findById(enrollment._id).lean();
        expect(archived).not.toBeNull();
        expect(archived!.archivedAt).toBeDefined();
        expect(archived!.status).toBe(EnrollmentStatus.Expired);
    });

    it('redacts sensitive gatewayResponse fields in archived payments', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        const enrollment = await EnrollmentModel.create({
            userId: user._id,
            batchId: batch._id,
            enrollmentId: 'MA-1-RETENTION-003',
            status: EnrollmentStatus.Pending,
        });
        await expireAbandonedEnrollments({ olderThanHours: 48 });
        await createPayment(user._id, batch._id, {
            enrollmentId: enrollment.enrollmentId,
            status: Status.Failed,
            gatewayResponse: { cardNumber: '4111111111111111', cvv: '123', bankName: 'Test Bank' },
        });

        // Backdate the payment's updatedAt (find by enrollmentId since enrollment.paymentId is not set)
        await PaymentModel.findOneAndUpdate(
            { enrollmentId: enrollment.enrollmentId },
            { updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) },
            { timestamps: false }
        );

        await purgeTerminalPaymentRecords({ olderThanDays: 90 });

        const archivedPayment = await PaymentModel.findOne({
            enrollmentId: enrollment.enrollmentId,
        }).lean();
        expect(archivedPayment).not.toBeNull();
        expect(archivedPayment!.archivedAt).toBeDefined();
        expect(archivedPayment!.gatewayResponse.cardNumber).toBeUndefined();
        expect(archivedPayment!.gatewayResponse.cvv).toBeUndefined();
    });

    it('writes audit log when archiving enrollments', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        const enrollment = await EnrollmentModel.create({
            userId: user._id,
            batchId: batch._id,
            status: EnrollmentStatus.Pending,
        });

        // Backdate updatedAt BEFORE expireAbandonedEnrollments so it finds the enrollment
        await EnrollmentModel.findByIdAndUpdate(enrollment._id, {
            updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        }, { timestamps: false });

        await expireAbandonedEnrollments({ olderThanHours: 48 });

        // Backdate updatedAt again after expireAbandonedEnrollments reset it to current time
        await EnrollmentModel.findByIdAndUpdate(enrollment._id, {
            updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        }, { timestamps: false });

        await purgeTerminalPaymentRecords({ olderThanDays: 90 });

        const auditLogs = await AuditLogModel.find({
            action: 'enrollment.archive',
        }).lean();
        expect(auditLogs.length).toBeGreaterThan(0);
        expect(auditLogs[0].targetId).toBe(enrollment._id.toString());
    });

    it('is idempotent - running twice does not double-archive', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        const enrollment = await EnrollmentModel.create({
            userId: user._id,
            batchId: batch._id,
            status: EnrollmentStatus.Pending,
        });

        // Backdate updatedAt BEFORE expireAbandonedEnrollments so it finds the enrollment
        await EnrollmentModel.findByIdAndUpdate(enrollment._id, {
            updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        }, { timestamps: false });

        await expireAbandonedEnrollments({ olderThanHours: 48 });

        // Backdate updatedAt again after expireAbandonedEnrollments reset it to current time
        await EnrollmentModel.findByIdAndUpdate(enrollment._id, {
            updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        }, { timestamps: false });

        await purgeTerminalPaymentRecords({ olderThanDays: 90 });

        const firstCount = await EnrollmentModel.countDocuments({
            _id: enrollment._id,
            archivedAt: { $exists: true },
        });
        expect(firstCount).toBe(1);

        await purgeTerminalPaymentRecords({ olderThanDays: 90 });

        const secondCount = await EnrollmentModel.countDocuments({
            _id: enrollment._id,
            archivedAt: { $exists: true },
        });
        expect(secondCount).toBe(1);
    });
});

describe('Fix 21: Purge never touches paid or ID-bearing records', () => {
    it('never archives Success payments', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        await createPayment(user._id, batch._id, {
            status: Status.Success,
            enrollmentId: 'MA-1-PURGE-001',
        });
        // Backdate updatedAt so it would otherwise be eligible
        await PaymentModel.findOneAndUpdate(
            { status: Status.Success, enrollmentId: 'MA-1-PURGE-001' },
            { updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) },
            { timestamps: false }
        );

        await purgeTerminalPaymentRecords({ olderThanDays: 90 });

        const payment = await PaymentModel.findOne({ enrollmentId: 'MA-1-PURGE-001' }).lean();
        expect(payment).not.toBeNull();
        expect(payment!.archivedAt).toBeUndefined();
        expect(payment!.status).toBe(Status.Success);
    });

    it('never archives Refunded payments', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        await createPayment(user._id, batch._id, {
            status: Status.Refunded,
            enrollmentId: 'MA-1-PURGE-002',
        });
        await PaymentModel.findOneAndUpdate(
            { status: Status.Refunded, enrollmentId: 'MA-1-PURGE-002' },
            { updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) },
            { timestamps: false }
        );

        await purgeTerminalPaymentRecords({ olderThanDays: 90 });

        const payment = await PaymentModel.findOne({ enrollmentId: 'MA-1-PURGE-002' }).lean();
        expect(payment).not.toBeNull();
        expect(payment!.archivedAt).toBeUndefined();
        expect(payment!.status).toBe(Status.Refunded);
    });

    it('never archives Review payments', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        await createPayment(user._id, batch._id, {
            status: Status.Review,
            enrollmentId: 'MA-1-PURGE-003',
        });
        await PaymentModel.findOneAndUpdate(
            { status: Status.Review, enrollmentId: 'MA-1-PURGE-003' },
            { updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) },
            { timestamps: false }
        );

        await purgeTerminalPaymentRecords({ olderThanDays: 90 });

        const payment = await PaymentModel.findOne({ enrollmentId: 'MA-1-PURGE-003' }).lean();
        expect(payment).not.toBeNull();
        expect(payment!.archivedAt).toBeUndefined();
        expect(payment!.status).toBe(Status.Review);
    });

    it('never archives enrollments holding an enrollmentId (paid)', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

        // PaymentFailed with an enrollmentId (legacy data scenario) must not be archived
        const enrollment = await EnrollmentModel.create({
            userId: user._id,
            batchId: batch._id,
            enrollmentId: 'MA-1-PURGE-004',
            status: EnrollmentStatus.PaymentFailed,
        });
        await EnrollmentModel.findByIdAndUpdate(enrollment._id, {
            updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        }, { timestamps: false });

        await purgeTerminalPaymentRecords({ olderThanDays: 90 });

        const archived = await EnrollmentModel.findById(enrollment._id).lean();
        expect(archived).not.toBeNull();
        expect(archived!.archivedAt).toBeUndefined();
        expect(archived!.status).toBe(EnrollmentStatus.PaymentFailed);
    });

    it('archives enrollments without enrollmentId (legacy failed attempts)', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);

        // PaymentFailed with NO enrollmentId is eligible for archiving
        const enrollment = await EnrollmentModel.create({
            userId: user._id,
            batchId: batch._id,
            status: EnrollmentStatus.PaymentFailed,
        });
        await EnrollmentModel.findByIdAndUpdate(enrollment._id, {
            updatedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
        }, { timestamps: false });

        await purgeTerminalPaymentRecords({ olderThanDays: 90 });

        const archived = await EnrollmentModel.findById(enrollment._id).lean();
        expect(archived).not.toBeNull();
        expect(archived!.archivedAt).toBeDefined();
    });
});
