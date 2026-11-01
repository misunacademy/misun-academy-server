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
import { PaymentModel } from '../../modules/Payment/payment.model.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { reconcilePendingPayments } from '../../modules/Payment/paymentReconciliation.service.js';
import { EnrollmentStatus, Status } from '../../types/common.js';

const MINUTE_MS = 60 * 1000;

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

const backdatePayment = async (id: mongoose.Types.ObjectId, minutes: number) => {
  await PaymentModel.updateOne(
    { _id: id },
    { $set: { updatedAt: new Date(Date.now() - minutes * MINUTE_MS) } },
    { timestamps: false }
  );
};

const setupPendingPayment = async (overrides: Record<string, unknown> = {}) => {
  const user = await createUser();
  const course = await createCourse(adminId);
  const batch = await createBatch(course._id);
  const enrollmentId = `MA-1-RECON-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  const enrollment = await createEnrollment(user._id, batch._id, {
    enrollmentId,
    status: EnrollmentStatus.Pending,
  });

  const payment = await createPayment(user._id, batch._id, {
    enrollmentId,
    status: Status.Pending,
    method: 'SSLCommerz',
    amount: batch.price,
    currency: 'BDT',
    transactionId: 'MA_CURRENT',
    ...overrides,
  });

  await backdatePayment(payment._id, 60);

  return { user, batch, enrollment, payment, enrollmentId };
};

describe('reconcilePendingPayments', () => {
  it('settles a payment the gateway reports as paid', async () => {
    await setupPendingPayment();
    const finalized: string[] = [];

    const summary = await reconcilePendingPayments({
      olderThanMinutes: 20,
      queryTransaction: async (tranId) => ({
        status: 'VALID',
        tran_id: tranId,
        amount: '5000',
        currency: 'BDT',
        val_id: 'VAL-123',
      }),
      finalizePayment: async (tranId, valId) => {
        finalized.push(`${tranId}:${valId}`);
      },
    });

    expect(summary.settled).toBe(1);
    expect(finalized).toEqual(['MA_CURRENT:VAL-123']);
  });

  it('rescues a payment completed on a superseded gateway session', async () => {
    await setupPendingPayment({
      transactionId: 'MA_NEW',
      gatewayResponse: { supersededTranIds: ['MA_OLD'] },
    });
    const finalized: string[] = [];

    const summary = await reconcilePendingPayments({
      olderThanMinutes: 20,
      queryTransaction: async (tranId) => {
        if (tranId === 'MA_OLD') {
          return {
            status: 'VALID',
            tran_id: tranId,
            amount: '5000',
            currency: 'BDT',
            val_id: 'VAL-OLD',
          };
        }
        return { status: 'FAILED', tran_id: tranId };
      },
      finalizePayment: async (tranId, valId) => {
        finalized.push(`${tranId}:${valId}`);
      },
    });

    expect(summary.settled).toBe(1);
    expect(finalized).toEqual(['MA_OLD:VAL-OLD']);
  });

  it('marks a dead attempt failed and moves the enrollment to payment-failed', async () => {
    const { payment, enrollment } = await setupPendingPayment();

    const summary = await reconcilePendingPayments({
      olderThanMinutes: 20,
      queryTransaction: async (tranId) => ({ status: 'FAILED', tran_id: tranId }),
    });

    expect(summary.failed).toBe(1);

    const failedPayment = await PaymentModel.findById(payment._id).lean();
    expect(failedPayment?.status).toBe(Status.Failed);
    expect((failedPayment?.gatewayResponse as any)?.reconciledStatus).toBe('FAILED');

    const failedEnrollment = await EnrollmentModel.findById(enrollment._id).lean();
    expect(failedEnrollment?.status).toBe(EnrollmentStatus.PaymentFailed);
  });

  it('leaves the payment pending when the gateway is unreachable', async () => {
    const { payment, enrollment } = await setupPendingPayment();

    const summary = await reconcilePendingPayments({
      olderThanMinutes: 20,
      queryTransaction: async () => {
        throw new Error('gateway timeout');
      },
    });

    expect(summary.stillPending).toBe(1);
    expect(summary.failed).toBe(0);

    const untouched = await PaymentModel.findById(payment._id).lean();
    expect(untouched?.status).toBe(Status.Pending);
    const untouchedEnrollment = await EnrollmentModel.findById(enrollment._id).lean();
    expect(untouchedEnrollment?.status).toBe(EnrollmentStatus.Pending);
  });

  it('never settles a paid transaction whose amount or currency does not match', async () => {
    const { payment } = await setupPendingPayment();
    const finalized: string[] = [];

    const summary = await reconcilePendingPayments({
      olderThanMinutes: 20,
      queryTransaction: async (tranId) => ({
        status: 'VALID',
        tran_id: tranId,
        amount: '1',
        currency: 'BDT',
        val_id: 'VAL-TAMPER',
      }),
      finalizePayment: async (tranId, valId) => {
        finalized.push(`${tranId}:${valId}`);
      },
    });

    expect(summary.skipped).toBe(1);
    expect(summary.settled).toBe(0);
    expect(finalized).toEqual([]);

    const untouched = await PaymentModel.findById(payment._id).lean();
    expect(untouched?.status).toBe(Status.Pending);
  });

  it('skips payments that were touched inside the reconciliation window', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    const enrollmentId = `MA-1-RECON-recent-${Date.now()}`;

    await createEnrollment(user._id, batch._id, {
      enrollmentId,
      status: EnrollmentStatus.Pending,
    });
    await createPayment(user._id, batch._id, {
      enrollmentId,
      status: Status.Pending,
      method: 'SSLCommerz',
      amount: batch.price,
      currency: 'BDT',
      transactionId: 'MA_RECENT',
    });

    const summary = await reconcilePendingPayments({
      olderThanMinutes: 20,
      queryTransaction: async () => ({ status: 'VALID', amount: '5000', currency: 'BDT', val_id: 'x' }),
      finalizePayment: async () => undefined,
    });

    expect(summary.checked).toBe(0);
  });
});
