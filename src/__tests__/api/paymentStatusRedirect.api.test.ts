/**
 * Fix 1 regression: the `/payments/status` redirect must be read-only when no
 * `val_id` is present. `k` = HMAC(tran_id) only proves the URL was issued for
 * this transaction; it says nothing about the outcome.
 *
 * Covered here:
 *  1. status=success replayed (no val_id) must not activate a pending enrollment.
 *  2. status=failed replayed (no val_id) must not fail a pending enrollment.
 *  3. status=failed replayed (no val_id) must not downgrade a paid (Success) payment.
 *
 * The webhook (/api/v1/payments/webhook, HMAC + gateway validation) and the
 * reconciliation job remain the only state-changing paths.
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
import {
  EnrollmentStatus,
  Status,
  BatchStatus,
} from '../../types/common.js';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/test-placeholder';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'test-secret-test-secret-test-secret';
process.env.BETTER_AUTH_URL = process.env.BETTER_AUTH_URL || 'http://localhost:5000/api/v1/auth';
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-id';
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-secret';
process.env.SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'super@test.local';
process.env.SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'superpass123';
process.env.SSL_STORE_ID = process.env.SSL_STORE_ID || 'test-store';
process.env.SSL_STORE_PASSWORD = process.env.SSL_STORE_PASSWORD || 'test-store-pass';
process.env.SSL_IS_LIVE = process.env.SSL_IS_LIVE || 'false';
process.env.SSL_VALIDATION_API =
  process.env.SSL_VALIDATION_API || 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php';
process.env.SERVER_URL = process.env.SERVER_URL || 'http://localhost:5000';
process.env.MA_FRONTEND_URL = process.env.MA_FRONTEND_URL || 'http://localhost:3000';
process.env.EP_FRONTEND_URL = process.env.EP_FRONTEND_URL || 'http://localhost:3001';
process.env.EMAIL_USER = process.env.EMAIL_USER || 'test@example.com';
process.env.EMAIL_PASS = process.env.EMAIL_PASS || 'test-email-pass';

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

describe('POST /api/v1/payments/status — status-only redirect must be read-only', () => {
  const setup = async (paymentStatus: Status) => {
    const user = await createUser();
    const admin = await createAdmin();
    const course = await createCourse(admin._id, {
      title: `Status Course ${Date.now()}`,
      slug: `status-course-${Date.now()}`,
    });
    const batch = await createBatch(course._id, {
      price: 5000,
      currency: 'BDT',
      status: BatchStatus.Upcoming,
      enrollmentStartDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      enrollmentEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const enrollment = await EnrollmentModel.create({
      userId: user._id,
      batchId: batch._id,
      status: paymentStatus === Status.Success ? EnrollmentStatus.Active : EnrollmentStatus.PaymentPending,
      ...(paymentStatus === Status.Success ? { enrollmentId: `MA-32026${Date.now()}`, paymentId: new mongoose.Types.ObjectId() } : {}),
    });

    const transactionId = `TXN_TEST_${Date.now()}`;
    const payment = await PaymentModel.create({
      userId: user._id,
      batchId: batch._id,
      enrollmentRef: enrollment._id,
      transactionId,
      amount: 5000,
      currency: 'BDT',
      status: paymentStatus,
      method: 'SSLCommerz',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    return { user, batch, enrollment, payment, transactionId };
  };

  it('status=success replayed (no val_id) does not activate a pending enrollment', async () => {
    const { enrollment, transactionId } = await setup(Status.Pending);

    const res = await postStatusRedirect(transactionId, { status: 'success' });
    expect([301, 302]).toContain(res.status);

    const afterPayment = await PaymentModel.findOne({ transactionId }).lean();
    expect(afterPayment?.status).toBe(Status.Pending);

    const afterEnrollment = await EnrollmentModel.findById(enrollment._id).lean();
    expect(afterEnrollment?.status).toBe(EnrollmentStatus.PaymentPending);
  });

  it('status=failed replayed (no val_id) transitions Pending → Failed', async () => {
    const { enrollment, transactionId } = await setup(Status.Pending);

    const res = await postStatusRedirect(transactionId, { status: 'failed' });
    expect([301, 302]).toContain(res.status);

    const afterPayment = await PaymentModel.findOne({ transactionId }).lean();
    expect(afterPayment?.status).toBe(Status.Failed);
    expect(afterPayment?.failedAt).toBeTruthy();

    const afterEnrollment = await EnrollmentModel.findById(enrollment._id).lean();
    // Enrollment stays PaymentPending (reusable), not moved to PaymentFailed.
    expect(afterEnrollment?.status).toBe(EnrollmentStatus.PaymentPending);
  });

  it('status=failed replayed (no val_id) does not downgrade a paid payment', async () => {
    const { enrollment, transactionId } = await setup(Status.Success);

    const res = await postStatusRedirect(transactionId, { status: 'failed' });
    expect([301, 302]).toContain(res.status);

    const afterPayment = await PaymentModel.findOne({ transactionId }).lean();
    expect(afterPayment?.status).toBe(Status.Success);

    const afterEnrollment = await EnrollmentModel.findById(enrollment._id).lean();
    expect(afterEnrollment?.status).toBe(EnrollmentStatus.Active);
  });

  it('superseded transactionId (old gateway session after retry) still resolves instead of not_found', async () => {
    const { enrollment, batch, transactionId: setupTranId } = await setup(Status.Pending);

    // Mark the setup payment as superseded so we can create a fresh Pending
    // payment for oldTran without violating the unique partial index on
    // (enrollmentRef, status in [pending, review]).
    await PaymentModel.findOneAndUpdate(
      { transactionId: setupTranId },
      { $set: { status: Status.Superseded } }
    );

    // Original tran that gets superseded by a retry.
    const oldTran = `TXN_OLD_${Date.now()}`;
    const newTran = `TXN_NEW_${Date.now()}`;

    await PaymentModel.create({
      userId: enrollment.userId,
      batchId: batch._id,
      enrollmentRef: enrollment._id,
      transactionId: oldTran,
      amount: 5000,
      currency: 'BDT',
      status: Status.Pending,
      method: 'SSLCommerz',
      gatewayResponse: { gatewayPageURL: 'https://sandbox.sslcommerz.com/old-session' },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    // Simulate a retry: transactionId rotates to newTran, oldTran recorded in supersededTranIds.
    await PaymentModel.findOneAndUpdate(
      { transactionId: oldTran },
      {
        $set: {
          transactionId: newTran,
          'gatewayResponse.supersededTranIds': [oldTran],
        },
      }
    );

    // The old gateway session (oldTran) completes after the retry. It must
    // resolve via supersededTranIds, not 404 to status=not_found.
    const res = await postStatusRedirect(oldTran);
    expect([301, 302]).toContain(res.status);

    // Should redirect to the pending page (oldTran's status), not not_found.
    expect(res.headers.location).not.toContain('status=not_found');
    expect(res.headers.location).toContain('status=pending');
    expect(res.headers.location).toContain(`t=${encodeURIComponent(oldTran)}`);
  });
});
