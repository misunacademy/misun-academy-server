import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import mongoose from 'mongoose';
import axios from 'axios';
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

  it('hides failed and cancelled gateway attempts from the learner', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);

    await createPayment(user._id, batch._id, {
      status: Status.Success,
      transactionId: 'MY-HIDDEN-SUCCESS',
      enrollmentId: 'MY-HIDDEN-1',
    });
    await createPayment(user._id, batch._id, {
      status: Status.Failed,
      transactionId: 'MY-HIDDEN-FAILED',
      enrollmentId: 'MY-HIDDEN-2',
    });
    await createPayment(user._id, batch._id, {
      status: Status.Cancel,
      transactionId: 'MY-HIDDEN-CANCEL',
      enrollmentId: 'MY-HIDDEN-3',
    });

    const payments = await PaymentService.getMyPayments(user._id.toString());

    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe(Status.Success);
  });
});

describe('PaymentService.checkPaymentStatus', () => {
  it('returns status for an existing payment', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    const payment = await createPayment(user._id, batch._id, {
      status: Status.Success,
    });

    const result = await PaymentService.checkPaymentStatus(payment.transactionId);

    expect(result).toBeDefined();
    expect(result.payment.status).toBe(Status.Success);
  });
});

describe('PaymentService.verifyPaymentForCurrentUser', () => {
  it('verifies a successful payment through a superseded transaction id', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    const enrollment = await EnrollmentModel.create({
      userId: user._id,
      batchId: batch._id,
      enrollmentId: 'MA-1202600001',
      status: EnrollmentStatus.Active,
    });

    await createPayment(user._id, batch._id, {
      enrollmentId: enrollment.enrollmentId,
      transactionId: 'MA_CURRENT_ATTEMPT',
      status: Status.Success,
      gatewayResponse: {
        paidTranId: 'MA_OLD_ATTEMPT',
        supersededTranIds: ['MA_OLD_ATTEMPT'],
      },
    });

    const result = await PaymentService.verifyPaymentForCurrentUser(
      'MA_OLD_ATTEMPT',
      user._id.toString()
    );

    expect(result.verified).toBe(true);
    expect(result.paymentStatus).toBe(Status.Success);
    expect(result.transactionId).toBe('MA_CURRENT_ATTEMPT');
  });
});

describe('PaymentService.getPaymentHistory — student phone', () => {
  it('includes the student phone number from the user record', async () => {
    const user = await createUser({ phone: '01700000000' });
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    await createPayment(user._id, batch._id, { status: Status.Success });

    const result: any = await PaymentService.getPaymentHistory({});

    expect(result.data).toHaveLength(1);
    expect(result.data[0].student.phone).toBe('01700000000');
  });
});

describe('recordGatewayPaymentAttempt — re-initiating an abandoned payment', () => {
  it('supersedes the previous tran id without a conflicting-update error', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    const enrollmentId = `MA-1${new Date().getFullYear()}00001`;

    await createPayment(user._id, batch._id, {
      enrollmentId,
      transactionId: 'MA_FIRST_ATTEMPT',
      status: Status.Pending,
      gatewayResponse: {
        submissions: [{ senderNumber: '01700000000', phonePeTransactionId: 'UTR1' }],
      },
    });

    // Regression: the old implementation wrote `$set: { gatewayResponse }`
    // together with `$addToSet: { 'gatewayResponse.supersededTranIds' }`,
    // which MongoDB rejects (code 40) — every retry after the first click
    // returned a generic 500.
    await expect(
      recordGatewayPaymentAttempt({
        userId: user._id.toString(),
        batch: batch as any,
        enrollmentId,
        enrollmentRef: new mongoose.Types.ObjectId(),
        transactionId: 'MA_SECOND_ATTEMPT',
      })
    ).resolves.toBeTruthy();

    const payment = await PaymentModel.findOne({ enrollmentId }).lean();
    expect(payment?.transactionId).toBe('MA_SECOND_ATTEMPT');
    expect(payment?.status).toBe(Status.Pending);
    expect((payment?.gatewayResponse as any)?.supersededTranIds).toEqual(['MA_FIRST_ATTEMPT']);
    // The audit trail must survive a retry.
    expect((payment?.gatewayResponse as any)?.submissions).toHaveLength(1);
    const attempts = await PaymentAttemptModel.find({
      transactionId: { $in: ['MA_SECOND_ATTEMPT'] },
    }).lean();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe(Status.Pending);
  });

  it('keeps every superseded tran id across repeated retries', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    const enrollmentId = `MA-1${new Date().getFullYear()}00002`;

    for (const transactionId of ['MA_A', 'MA_B', 'MA_C']) {
      await recordGatewayPaymentAttempt({
        userId: user._id.toString(),
        batch: batch as any,
        enrollmentId,
        enrollmentRef: new mongoose.Types.ObjectId(),
        transactionId,
      });
    }

    const payment = await PaymentModel.findOne({ enrollmentId }).lean();
    expect(payment?.transactionId).toBe('MA_C');
    expect((payment?.gatewayResponse as any)?.supersededTranIds).toEqual(['MA_A', 'MA_B']);
  });

  it('creates the payment row on the first attempt', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    const enrollmentId = `MA-1${new Date().getFullYear()}00003`;

    await recordGatewayPaymentAttempt({
      userId: user._id.toString(),
      batch: batch as any,
      enrollmentId,
      enrollmentRef: new mongoose.Types.ObjectId(),
      transactionId: 'MA_ONLY_ATTEMPT',
    });

    const payment = await PaymentModel.findOne({ enrollmentId }).lean();
    expect(payment?.transactionId).toBe('MA_ONLY_ATTEMPT');
    expect(payment?.amount).toBe(batch.price);
    expect((payment?.gatewayResponse as any)?.supersededTranIds).toBeUndefined();
  });
});

describe('PaymentService.updatePaymentWithEnrollStatus — guarded activation', () => {
  it('rejects success because the generic admin transition cannot mint paid state', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    const transactionId = `TXN-ADMIN-SUCCESS-${Date.now()}`;

    await createPayment(user._id, batch._id, {
      transactionId,
      status: Status.Pending,
    });

    await expect(
      PaymentService.updatePaymentWithEnrollStatus(
        transactionId,
        Status.Success,
        undefined,
        adminId.toString(),
        'manual status change'
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('recovers an expired enrollment after verified payment', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    const enrollmentId = `MA-EXPIRED-${Date.now()}`;
    const transactionId = `TXN-EXPIRED-${Date.now()}`;

    await EnrollmentModel.create({
      userId: user._id,
      batchId: batch._id,
      enrollmentId,
      status: EnrollmentStatus.Expired,
    });
    await createPayment(user._id, batch._id, {
      enrollmentId,
      transactionId,
      status: Status.Pending,
    });

    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        status: 'VALID',
        tran_id: transactionId,
        amount: 5000,
        currency: 'BDT',
      },
    } as any);
    await PaymentService.finalizeSSLCommerzPayment(transactionId, 'VAL-EXPIRED');

    const enrollment = await EnrollmentModel.findOne({ enrollmentId }).lean();
    expect(enrollment?.status).toBe(EnrollmentStatus.Active);
    expect(enrollment?.statusChangeReason).toMatch(/recovered/i);
  });

  it('increments the batch once when duplicate payment updates race', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    const enrollmentId = `MA-RACE-${Date.now()}`;
    const transactionId = `TXN-RACE-${Date.now()}`;

    await EnrollmentModel.create({
      userId: user._id,
      batchId: batch._id,
      enrollmentId,
      status: EnrollmentStatus.Expired,
    });
    await createPayment(user._id, batch._id, {
      enrollmentId,
      transactionId,
      status: Status.Pending,
    });

    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        status: 'VALID',
        tran_id: transactionId,
        amount: 5000,
        currency: 'BDT',
      },
    } as any);
    const results = await Promise.allSettled([
      PaymentService.finalizeSSLCommerzPayment(transactionId, 'VAL-RACE'),
      PaymentService.finalizeSSLCommerzPayment(transactionId, 'VAL-RACE'),
    ]);

    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    // currentEnrollment counter deprecated — use countActiveEnrollments() instead
    const activeCount = await EnrollmentService.countActiveEnrollments(batch._id.toString());
    expect(activeCount).toBe(1);
    const enrollment = await EnrollmentModel.findOne({ enrollmentId }).lean();
    expect(enrollment?.status).toBe(EnrollmentStatus.Active);
  });

  it('does not activate a refunded enrollment when a payment is reported successful', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    const enrollmentId = `MA-REFUNDED-${Date.now()}`;

    await EnrollmentModel.create({
      userId: user._id,
      batchId: batch._id,
      enrollmentId,
      status: EnrollmentStatus.Refunded,
    });

    const transactionId = `TXN-REFUNDED-${Date.now()}`;
    await createPayment(user._id, batch._id, {
      enrollmentId,
      transactionId,
      status: Status.Pending,
    });

    jest.spyOn(axios, 'get').mockResolvedValue({
      data: {
        status: 'VALID',
        tran_id: transactionId,
        amount: 5000,
        currency: 'BDT',
      },
    } as any);
    await PaymentService.finalizeSSLCommerzPayment(transactionId, 'VAL-REFUNDED');

    const payment = await PaymentModel.findOne({ enrollmentId }).lean();
    const enrollment = await EnrollmentModel.findOne({ enrollmentId }).lean();

    expect(payment?.status).toBe(Status.Review);
    expect(enrollment?.status).toBe(EnrollmentStatus.Refunded);
  });

  describe('reVerifyPaymentWithGateway — admin re-verify never trusts chosen status', () => {
    const mockGatewayQuery: any = jest.fn();

    beforeEach(() => {
      jest.clearAllMocks();
      mockGatewayQuery.mockReset();
    });

    it('activates enrollment when gateway confirms Success with matching amount/currency/tran_id', async () => {
      const user = await createUser();
      const course = await createCourse(adminId);
      const batch = await createBatch(course._id);
      const enrollmentId = `MA-REVERIFY-${Date.now()}`;
      const transactionId = `TXN-REVERIFY-${Date.now()}`;

      await EnrollmentModel.create({
        userId: user._id,
        batchId: batch._id,
        enrollmentId,
        status: EnrollmentStatus.Pending,
      });
      await createPayment(user._id, batch._id, {
        enrollmentId,
        transactionId,
        amount: 5000,
        currency: 'BDT',
        status: Status.Pending,
      });

      mockGatewayQuery.mockResolvedValue({
        tran_id: transactionId,
        status: 'VALID',
        amount: 5000,
        currency: 'BDT',
      } as any);

      const result = await PaymentService.reVerifyPaymentWithGateway(
        transactionId,
        adminId.toString(),
        'Customer claims payment was deducted',
        mockGatewayQuery as any
      );

      expect(result.payment.status).toBe(Status.Success);
      const enrollment = await EnrollmentModel.findOne({ enrollmentId }).lean();
      expect(enrollment?.status).toBe(EnrollmentStatus.Active);
    });

    it('refuses amount mismatch — no state change', async () => {
      const user = await createUser();
      const course = await createCourse(adminId);
      const batch = await createBatch(course._id);
      const transactionId = `TXN-MISMATCH-${Date.now()}`;

      await createPayment(user._id, batch._id, {
        transactionId,
        amount: 5000,
        currency: 'BDT',
        status: Status.Pending,
      });

      mockGatewayQuery.mockResolvedValue({
        tran_id: transactionId,
        status: 'VALID',
        amount: 99999,
        currency: 'BDT',
      } as any);

      await expect(
        PaymentService.reVerifyPaymentWithGateway(
          transactionId,
          adminId.toString(),
          'Admin re-verify',
          mockGatewayQuery as any
        )
      ).rejects.toMatchObject({ statusCode: 400 });

      const payment = await PaymentModel.findOne({ transactionId }).lean();
      expect(payment?.status).toBe(Status.Pending);
    });

    it('marks payment Failed when gateway reports Failed', async () => {
      const user = await createUser();
      const course = await createCourse(adminId);
      const batch = await createBatch(course._id);
      const enrollmentId = `MA-REVERIFY-FAIL-${Date.now()}`;
      const transactionId = `TXN-REVERIFY-FAIL-${Date.now()}`;

      await EnrollmentModel.create({
        userId: user._id,
        batchId: batch._id,
        enrollmentId,
        status: EnrollmentStatus.Pending,
      });
      await createPayment(user._id, batch._id, {
        enrollmentId,
        transactionId,
        amount: 5000,
        currency: 'BDT',
        status: Status.Pending,
      });

      mockGatewayQuery.mockResolvedValue({
        tran_id: transactionId,
        status: 'FAILED',
        amount: 5000,
        currency: 'BDT',
      } as any);

      const result = await PaymentService.reVerifyPaymentWithGateway(
        transactionId,
        adminId.toString(),
        'Gateway reports failure',
        mockGatewayQuery as any
      );

      expect(result.payment.status).toBe(Status.Failed);
      const enrollment = await EnrollmentModel.findOne({ enrollmentId }).lean();
      expect(enrollment?.status).toBe(EnrollmentStatus.PaymentFailed);
    });

    it('throws on gateway transport failure — payment stays pending', async () => {
      const user = await createUser();
      const course = await createCourse(adminId);
      const batch = await createBatch(course._id);
      const transactionId = `TXN-TRANSPORT-${Date.now()}`;

      await createPayment(user._id, batch._id, {
        transactionId,
        amount: 5000,
        currency: 'BDT',
        status: Status.Pending,
      });

      mockGatewayQuery.mockResolvedValue(null);

      await expect(
        PaymentService.reVerifyPaymentWithGateway(
          transactionId,
          adminId.toString(),
          'Transport test',
          mockGatewayQuery as any
        )
      ).rejects.toMatchObject({ statusCode: 503 });

      const payment = await PaymentModel.findOne({ transactionId }).lean();
      expect(payment?.status).toBe(Status.Pending);
    });
  });

  describe('failEnrollment writes status history', () => {
    it('marks enrollment PaymentFailed with a history row', async () => {
      const user = await createUser();
      const course = await createCourse(adminId);
      const batch = await createBatch(course._id, { status: BatchStatus.Running });
      const enrollmentId = `MA-FAIL-HIST-${Date.now()}`;

      await EnrollmentModel.create({
        userId: user._id,
        batchId: batch._id,
        enrollmentId,
        status: EnrollmentStatus.Pending,
      });
      const payment = await PaymentModel.create({
        userId: user._id,
        batchId: batch._id,
        transactionId: `TXN-FAIL-HIST-${Date.now()}`,
        enrollmentId,
        amount: 5000,
        currency: 'BDT',
        status: Status.Pending,
        method: 'SSLCommerz',
      });

      const session = await mongoose.startSession();
      session.startTransaction();
      try {
        const notify = await failEnrollment(payment, session, 'Gateway declined');
        await session.commitTransaction();
        expect(notify).not.toBeNull();
        if (notify?.kind === 'failed') {
          expect(notify.reason).toContain('Gateway declined');
        }
      } finally {
        session.endSession();
      }

      const enrollment = await EnrollmentModel.findOne({ enrollmentId }).lean();
      expect(enrollment?.status).toBe(EnrollmentStatus.PaymentFailed);
      expect(enrollment).not.toBeNull();

      const history = await EnrollmentStatusHistoryModel.find({
        enrollmentId: (enrollment as any)._id,
        to: EnrollmentStatus.PaymentFailed,
      }).lean();

      expect(history.length).toBeGreaterThan(0);
      const row = history[0];
      expect(row.from).toBe(EnrollmentStatus.Pending);
      expect(row.to).toBe(EnrollmentStatus.PaymentFailed);
      expect(row.reason).toContain('Gateway declined');
    });
  });
});
