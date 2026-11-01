import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch, createPayment } from '../helpers/factories.js';
import { PaymentService, recordGatewayPaymentAttempt } from '../../modules/Payment/payment.service.js';
import { PaymentModel } from '../../modules/Payment/payment.model.js';
import { Status } from '../../types/common.js';

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
        transactionId: 'MA_SECOND_ATTEMPT',
      })
    ).resolves.toBeTruthy();

    const payment = await PaymentModel.findOne({ enrollmentId }).lean();
    expect(payment?.transactionId).toBe('MA_SECOND_ATTEMPT');
    expect(payment?.status).toBe(Status.Pending);
    expect((payment?.gatewayResponse as any)?.supersededTranIds).toEqual(['MA_FIRST_ATTEMPT']);
    // The audit trail must survive a retry.
    expect((payment?.gatewayResponse as any)?.submissions).toHaveLength(1);
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
      transactionId: 'MA_ONLY_ATTEMPT',
    });

    const payment = await PaymentModel.findOne({ enrollmentId }).lean();
    expect(payment?.transactionId).toBe('MA_ONLY_ATTEMPT');
    expect(payment?.amount).toBe(batch.price);
    expect((payment?.gatewayResponse as any)?.supersededTranIds).toBeUndefined();
  });
});
