import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import {
  createUser,
  createAdmin,
  createCourse,
  createBatch,
  createEnrollment,
  createPayment,
} from '../helpers/factories.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { EnrollmentStatusHistoryModel } from '../../modules/Enrollment/enrollmentStatusHistory.model.js';
import { PaymentModel } from '../../modules/Payment/payment.model.js';
import { expireAbandonedEnrollments } from '../../modules/Enrollment/enrollmentMaintenance.service.js';
import { EnrollmentStatus, Status } from '../../types/common.js';

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

/** Move a row's `updatedAt` into the past without the model re-stamping it. */
const backdate = async (
  // Any mongoose model with `updatedAt` — we only need the raw update.
  model: mongoose.Model<any>,
  id: mongoose.Types.ObjectId,
  hours: number
) => {
  await model.updateOne(
    { _id: id },
    { $set: { updatedAt: new Date(Date.now() - hours * HOUR_MS) } },
    { timestamps: false }
  );
};

describe('expireAbandonedEnrollments', () => {
  it('expires a stale unpaid enrollment and its pending payment', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    const enrollmentId = 'MA-1-EXPIRY-1';

    const enrollment = await createEnrollment(user._id, batch._id, {
      enrollmentId,
      status: EnrollmentStatus.Pending,
    });
    const payment = await createPayment(user._id, batch._id, {
      enrollmentId,
      status: Status.Pending,
    });

    await backdate(EnrollmentModel, enrollment._id, 72);
    await backdate(PaymentModel, payment._id, 72);

    const summary = await expireAbandonedEnrollments({ olderThanHours: 48 });

    expect(summary).toEqual({ checked: 1, expired: 1, skipped: 0 });

    const expiredEnrollment = await EnrollmentModel.findById(enrollment._id).lean();
    expect(expiredEnrollment?.status).toBe(EnrollmentStatus.PaymentFailed);
    expect(expiredEnrollment?.statusChangeReason).toContain('Auto-expired');

    const expiredPayment = await PaymentModel.findById(payment._id).lean();
    expect(expiredPayment?.status).toBe(Status.Failed);
    expect((expiredPayment?.gatewayResponse as any)?.expiredReason).toBe(
      'abandoned-enrollment'
    );
  });

  it('never expires a manual payment that is awaiting admin review', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    const enrollmentId = 'MA-1-EXPIRY-2';

    const enrollment = await createEnrollment(user._id, batch._id, {
      enrollmentId,
      status: EnrollmentStatus.PaymentPending,
    });
    const payment = await createPayment(user._id, batch._id, {
      enrollmentId,
      status: Status.Review,
      method: 'PhonePay',
    });

    await backdate(EnrollmentModel, enrollment._id, 120);
    await backdate(PaymentModel, payment._id, 120);

    const summary = await expireAbandonedEnrollments({ olderThanHours: 48 });

    expect(summary).toEqual({ checked: 1, expired: 0, skipped: 1 });

    const untouched = await EnrollmentModel.findById(enrollment._id).lean();
    expect(untouched?.status).toBe(EnrollmentStatus.PaymentPending);
  });

  it('never expires an enrollment whose payment already succeeded', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    const enrollmentId = 'MA-1-EXPIRY-3';

    const enrollment = await createEnrollment(user._id, batch._id, {
      enrollmentId,
      status: EnrollmentStatus.Pending,
    });
    const payment = await createPayment(user._id, batch._id, {
      enrollmentId,
      status: Status.Success,
    });

    await backdate(EnrollmentModel, enrollment._id, 72);
    await backdate(PaymentModel, payment._id, 72);

    const summary = await expireAbandonedEnrollments({ olderThanHours: 48 });

    expect(summary.expired).toBe(0);
    const untouched = await EnrollmentModel.findById(enrollment._id).lean();
    expect(untouched?.status).toBe(EnrollmentStatus.Pending);
  });

  it('leaves recent enrollments inside the payment window alone', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);

    const enrollment = await createEnrollment(user._id, batch._id, {
      enrollmentId: 'MA-1-EXPIRY-4',
      status: EnrollmentStatus.Pending,
    });

    const summary = await expireAbandonedEnrollments({ olderThanHours: 48 });

    expect(summary).toEqual({ checked: 0, expired: 0, skipped: 0 });
    const untouched = await EnrollmentModel.findById(enrollment._id).lean();
    expect(untouched?.status).toBe(EnrollmentStatus.Pending);
  });

  it('expires an enrollment that never got a payment row', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);

    const enrollment = await createEnrollment(user._id, batch._id, {
      enrollmentId: 'MA-1-EXPIRY-5',
      status: EnrollmentStatus.Pending,
    });
    await backdate(EnrollmentModel, enrollment._id, 72);

    const summary = await expireAbandonedEnrollments({ olderThanHours: 48 });

    expect(summary.expired).toBe(1);
    const expired = await EnrollmentModel.findById(enrollment._id).lean();
    expect(expired?.status).toBe(EnrollmentStatus.PaymentFailed);
  });
});

describe('expireAbandonedEnrollments — status history + concurrency', () => {
    it('writes status history row on cron expiry', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        const enrollmentId = 'MA-1-EXPIRY-HISTORY';

        const enrollment = await createEnrollment(user._id, batch._id, {
            enrollmentId,
            status: EnrollmentStatus.Pending,
        });
        const payment = await createPayment(user._id, batch._id, {
            enrollmentId,
            status: Status.Pending,
        });

        await backdate(EnrollmentModel, enrollment._id, 72);
        await backdate(PaymentModel, payment._id, 72);

        await expireAbandonedEnrollments({ olderThanHours: 48 });

        const history = await EnrollmentStatusHistoryModel.find({
            enrollmentId: enrollment._id,
            to: EnrollmentStatus.Expired,
        }).lean();

        expect(history.length).toBeGreaterThan(0);
        const row = history[0];
        expect(row.from).toBe(EnrollmentStatus.Pending);
        expect(row.to).toBe(EnrollmentStatus.Expired);
        expect(row.actorType).toBe('cron');
        expect(row.source).toContain('expireAbandonedEnrollments');
        expect(row.reason).toContain('Auto-expired');
    });

    it('is safe when run twice concurrently', async () => {
        const user = await createUser();
        const course = await createCourse(adminId);
        const batch = await createBatch(course._id);
        const enrollmentId = 'MA-1-EXPIRY-CONCUR';

        const enrollment = await createEnrollment(user._id, batch._id, {
            enrollmentId,
            status: EnrollmentStatus.Pending,
        });
        const payment = await createPayment(user._id, batch._id, {
            enrollmentId,
            status: Status.Pending,
        });

        await backdate(EnrollmentModel, enrollment._id, 72);
        await backdate(PaymentModel, payment._id, 72);

        const results = await Promise.allSettled([
            expireAbandonedEnrollments({ olderThanHours: 48 }),
            expireAbandonedEnrollments({ olderThanHours: 48 }),
        ]);

        const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
        expect(fulfilled).toBe(2);

        const final = await EnrollmentModel.findById(enrollment._id).lean();
        expect(final?.status).toBe(EnrollmentStatus.Expired);

        const history = await EnrollmentStatusHistoryModel.find({
            enrollmentId: enrollment._id,
            to: EnrollmentStatus.Expired,
        }).lean();
        expect(history.length).toBeGreaterThanOrEqual(1);
    });
});
