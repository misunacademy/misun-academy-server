/**
 * Payment cancel / fail / expiry + transaction-integrity tests.
 *
 * Covers:
 *  1. Cancel transitions Pending → Cancel, enrollment stays PaymentPending
 *     (no enrollmentId consumed).
 *  2. Fail transitions Pending → Failed, enrollment stays PaymentPending.
 *  3. finalizeSSLCommerzPayment rescues a Cancelled/Failed/Expired payment
 *     when the gateway returns VALID (amount/currency/tran_id checks).
 *  4. finalizeSSLCommerzPayment is idempotent (IPN twice).
 *  5. The enrollment counter is NOT incremented on cancel/fail/expire.
 *  6. A transaction abort rolls back the counter increment.
 *  7. markPaymentExpired moves a stale Pending payment to Expired.
 */

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import axios from 'axios';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/test-placeholder';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'test-secret-test-secret-test-secret';
process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL || 'http://localhost:5000/api/v1/auth';
process.env.SSL_STORE_ID = process.env.SSL_STORE_ID || 'test-store';
process.env.SSL_STORE_PASSWORD = process.env.SSL_STORE_PASSWORD || 'test-store-pass';
process.env.SSL_IS_LIVE = process.env.SSL_IS_LIVE || 'false';
process.env.SSL_VALIDATION_API =
  process.env.SSL_VALIDATION_API || 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php';

const mockAxiosGet = jest.spyOn(axios, 'get');

import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch } from '../helpers/factories.js';
import { PaymentModel } from '../../modules/Payment/payment.model.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { EnrollmentCounterModel } from '../../modules/Enrollment/enrollmentCounter.model.js';
import {
  PaymentService,
  recordGatewayPaymentAttempt,
} from '../../modules/Payment/payment.service.js';
import { Status, EnrollmentStatus } from '../../types/common.js';

const VALIDATION_VALID = {
  status: 'VALID',
  tran_id: 'TXN_VALID',
  amount: '5000.00',
  currency: 'BDT',
  val_id: 'VAL_123',
  store_amount: '5000.00',
  card_type: 'VISA',
  card_issuer: 'Dutch-Bangla Bank',
  bank_tran_id: 'BANK_123',
  tran_date: '2026-10-31 10:00:00',
};

let adminId: mongoose.Types.ObjectId;

beforeAll(async () => {
  await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

beforeEach(async () => {
  await clearTestDB();
  mockAxiosGet.mockReset();
  const admin = await createAdmin();
  adminId = admin._id;
});

const seedPendingPayment = async (overrides: Record<string, unknown> = {}) => {
  const user = await createUser();
  const course = await createCourse(adminId);
  const batch = await createBatch(course._id, { price: 5000 });
  const enrollment = await EnrollmentModel.create({
    userId: user._id,
    batchId: batch._id,
    status: EnrollmentStatus.PaymentPending,
  });
  const payment = await PaymentModel.create({
    userId: user._id,
    batchId: batch._id,
    enrollmentRef: enrollment._id,
    transactionId: `TXN-${Date.now()}`,
    amount: 5000,
    currency: 'BDT',
    status: Status.Pending,
    method: 'SSLCommerz',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    ...overrides,
  });
  return { user, course, batch, enrollment, payment };
};

describe('handleCancelPayment', () => {
  it('moves Pending → Cancel conditionally and does not consume an enrollmentId', async () => {
    const { payment, enrollment } = await seedPendingPayment();

    const updated = (await PaymentService.handleCancelPayment(payment.transactionId))!;
    expect(updated!.status).toBe(Status.Cancel);
    expect(updated!.cancelledAt).toBeTruthy();

    // Enrollment stays PaymentPending — no enrollmentId consumed.
    const fresh = (await EnrollmentModel.findById(enrollment._id).lean())!;
    expect(fresh.status).toBe(EnrollmentStatus.PaymentPending);
    expect(fresh.enrollmentId).toBeUndefined();

    // Counter unchanged.
    const counter = (await EnrollmentCounterModel.findOne().lean())!;
    expect(counter).toBeNull();
  });

  it('is idempotent: cancelling an already-Cancelled payment is a no-op', async () => {
    const { payment } = await seedPendingPayment({
      status: Status.Cancel,
      cancelledAt: new Date(),
    });

    const updated = (await PaymentService.handleCancelPayment(payment.transactionId))!;
    expect(updated).toBeNull();
  });

  it('never overwrites a Success payment', async () => {
    const { payment } = await seedPendingPayment({
      status: Status.Success,
    });

    const updated = (await PaymentService.handleCancelPayment(payment.transactionId))!;
    expect(updated).toBeNull();

    const fresh = (await PaymentModel.findById(payment._id).lean())!;
    expect(fresh.status).toBe(Status.Success);
  });
});

describe('handleFailPayment', () => {
  it('moves Pending → Failed conditionally', async () => {
    const { payment, enrollment } = await seedPendingPayment();

    const updated = (await PaymentService.handleFailPayment(payment.transactionId))!;

    expect(updated!.status).toBe(Status.Failed);
    expect(updated!.failedAt).toBeTruthy();

    // Enrollment stays PaymentPending — reusable.
    const fresh = (await EnrollmentModel.findById(enrollment._id).lean())!;
    expect(fresh.status).toBe(EnrollmentStatus.PaymentPending);
    expect(fresh.enrollmentId).toBeUndefined();
  });

  it('never overwrites a Success payment', async () => {
    const { payment } = await seedPendingPayment({
      status: Status.Success,
    });

    const updated = await PaymentService.handleFailPayment(payment.transactionId);
    expect(updated).toBeNull();

    const fresh = (await PaymentModel.findById(payment._id).lean())!;
    expect(fresh.status).toBe(Status.Success);
  });
});

describe('finalizeSSLCommerzPayment rescue (Cancelled/Failed/Expired → Success)', () => {
  it('rescues a Cancelled payment when the gateway returns VALID, assigning an enrollmentId', async () => {
    mockAxiosGet.mockResolvedValue({
      data: { ...VALIDATION_VALID, tran_id: 'TXN_CANCEL_RESCUE' },
    });

    const { payment, enrollment } = await seedPendingPayment({
      status: Status.Cancel,
      cancelledAt: new Date(),
      transactionId: 'TXN_CANCEL_RESCUE',
    });

    const result = await PaymentService.finalizeSSLCommerzPayment(payment.transactionId, 'VAL_123');

    expect(result.status).toBe(Status.Success);
    expect(result.verifiedAt).toBeTruthy();

    // Enrollment activated, enrollmentId assigned (MA-...).
    const fresh = (await EnrollmentModel.findById(enrollment._id).lean())!;
    expect(fresh.status).toBe(EnrollmentStatus.Active);
    expect(fresh.enrollmentId).toMatch(/^MA-\d+$/);
    expect(fresh.paymentId?.toString()).toBe(payment._id.toString());

    // Counter incremented exactly once.
    const counter = (await EnrollmentCounterModel.findOne({
      _id: 'MA-1',
    }).lean())!;
    expect(counter).toBeTruthy();
    expect(counter.count).toBe(1);

    // Payment carries the enrollmentId.
    const freshPayment = (await PaymentModel.findById(payment._id).lean())!;
    expect(freshPayment.enrollmentId).toBe(fresh.enrollmentId);
    expect(freshPayment.enrollmentRef?.toString()).toBe(enrollment._id.toString());
  });

  it('transaction abort rolls back the counter increment', async () => {
    mockAxiosGet.mockResolvedValue({
      data: { ...VALIDATION_VALID, tran_id: 'TXN_ABORT_TEST' },
    });

    const { payment } = await seedPendingPayment({
      status: Status.Cancel,
      cancelledAt: new Date(),
      transactionId: 'TXN_ABORT_TEST',
    });

    // Force the enrollment activation to fail → transaction aborts.
    const spy = jest
      .spyOn(EnrollmentModel, 'findOneAndUpdate')
      .mockRejectedValueOnce(new Error('activation failed'));

    await expect(
      PaymentService.finalizeSSLCommerzPayment(payment.transactionId, 'VAL_123')
    ).rejects.toThrow('activation failed');

    spy.mockRestore();

    // Counter must NOT have been incremented (rolled back by abort).
    const counter = (await EnrollmentCounterModel.findOne({
      _id: 'MA-1',
    }).lean())!;
    expect(counter).toBeNull();

    // Payment must NOT be marked Success (rolled back).
    const freshPayment = (await PaymentModel.findById(payment._id).lean())!;
    expect(freshPayment.status).toBe(Status.Cancel);
  });

  it('is idempotent: finalizing an already-Success payment returns early', async () => {
    mockAxiosGet.mockResolvedValue({
      data: { ...VALIDATION_VALID, tran_id: 'TXN_IDEMPOTENT' },
    });

    const { payment } = await seedPendingPayment({
      status: Status.Success,
      enrollmentId: 'MA-3202600001',
      transactionId: 'TXN_IDEMPOTENT',
    });

    const result = await PaymentService.finalizeSSLCommerzPayment(payment.transactionId, 'VAL_123');

    expect(result.status).toBe(Status.Success);
    // Validation should NOT be called again for an already-success payment.
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('marks validation failure as Failed (not Success)', async () => {
    mockAxiosGet.mockResolvedValue({
      data: { ...VALIDATION_VALID, status: 'FAILED', tran_id: 'TXN_FAIL_VAL' },
    });

    const { payment } = await seedPendingPayment({
      transactionId: 'TXN_FAIL_VAL',
    });

    const result = await PaymentService.finalizeSSLCommerzPayment(payment.transactionId, 'VAL_BAD');

    expect(result.status).toBe(Status.Failed);
  });

  it('expired then paid → Success', async () => {
    mockAxiosGet.mockResolvedValue({
      data: { ...VALIDATION_VALID, tran_id: 'TXN_EXPIRED_PAID' },
    });

    const { payment, enrollment } = await seedPendingPayment({
      status: Status.Expired,
      failedAt: new Date(),
      transactionId: 'TXN_EXPIRED_PAID',
    });

    const result = await PaymentService.finalizeSSLCommerzPayment(payment.transactionId, 'VAL_123');

    expect(result.status).toBe(Status.Success);

    const fresh = (await EnrollmentModel.findById(enrollment._id).lean())!;
    expect(fresh.status).toBe(EnrollmentStatus.Active);
    expect(fresh.enrollmentId).toMatch(/^MA-\d+$/);
  });
});

describe('recordGatewayPaymentAttempt does not consume the counter', () => {
  it('does not increment the counter when creating a Pending payment', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id, { price: 5000 });
    const enrollment = await EnrollmentModel.create({
      userId: user._id,
      batchId: batch._id,
      status: EnrollmentStatus.PaymentPending,
    });

    await recordGatewayPaymentAttempt({
      userId: user._id.toString(),
      batch: batch as any,
      enrollmentId: '',
      enrollmentRef: enrollment._id,
      transactionId: 'TXN_COUNTER_1',
    });

    const counter = (await EnrollmentCounterModel.findOne().lean())!;
    expect(counter).toBeNull();

    const payment = (await PaymentModel.findOne({ enrollmentRef: enrollment._id }).lean())!;
    expect(payment.enrollmentId).toBeUndefined();
    expect(payment.status).toBe(Status.Pending);
  });
});

describe('markPaymentExpired', () => {
  it('moves a stale Pending payment (past expiresAt) to Expired', async () => {
    const { payment } = await seedPendingPayment({
      status: Status.Pending,
      expiresAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
    });

    const marked = (await PaymentService.markPaymentExpired(payment.transactionId))!;

    expect(marked).toBeTruthy();
    expect(marked.status).toBe(Status.Expired);
    expect(marked.failedAt).toBeTruthy();
  });

  it('is a no-op when the payment is already terminal', async () => {
    const { payment } = await seedPendingPayment({
      status: Status.Success,
    });

    const marked = (await PaymentService.markPaymentExpired(payment.transactionId))!;
    expect(marked).toBeNull();
  });
});
