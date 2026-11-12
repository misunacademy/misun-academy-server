/**
 * API-level regression for the production 500 on a second enrollment attempt.
 *
 * Production symptom: a learner initiated checkout, left the gateway page
 * (enrollment `pending`, SSLCommerz payment `pending`), then tried again.
 * `POST /api/v1/enrollments` returned 500 "Something went wrong !" because the
 * retry mixed `$set: gatewayResponse` with `$addToSet: gatewayResponse.supersededTranIds`
 * (MongoServerError code 40 — path conflict).
 *
 * This test drives the real HTTP route, real auth, real MongoDB transaction and
 * the real payment bookkeeping. Only the outbound SSLCommerz `init` call is
 * mocked, because it is a third-party network dependency.
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import type { Express } from 'express';

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

// Must be registered before `app.js` (and therefore payment.service) is loaded.
jest.unstable_mockModule('sslcommerz-lts', () => {
  class MockSSLCommerzPayment {
    constructor(..._args: unknown[]) {
      void _args;
    }

    init() {
      return Promise.resolve({
        GatewayPageURL: 'https://sandbox.sslcommerz.com/Ecommerce/checkout.php?sessionkey=test',
      });
    }
  }

  return { default: MockSSLCommerzPayment };
});

import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createAdmin, createCourse, createBatch } from '../helpers/factories.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { PaymentModel } from '../../modules/Payment/payment.model.js';
import { UserModel } from '../../modules/User/user.model.js';
import { BatchStatus, EnrollmentStatus, Status } from '../../types/common.js';

let app: Express;

const TRUSTED_ORIGIN = 'http://localhost:3000';
const OLD_TRAN_ID = 'MA_OLD_TXN_0001';

const signUpAndSignIn = async () => {
  const email = `retry-${Date.now()}-${Math.floor(Math.random() * 10000)}@test.local`;
  const password = 'Str0ngPassw0rd!';

  // Better Auth's first call after boot can fail while its internal schema /
  // default-user setup settles; the existing API suite retries the same way.
  let signUp: request.Response | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    signUp = await request(app)
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ name: 'Retry Learner', email, password });
    if (signUp.status !== 500) break;
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  expect([200, 201]).toContain(signUp!.status);

  const user = await UserModel.findOneAndUpdate(
    { email },
    { $set: { emailVerified: true, role: 'learner' } },
    { new: true }
  );
  expect(user).toBeTruthy();

  const signIn = await request(app)
    .post('/api/v1/auth/sign-in/email')
    .set('Origin', TRUSTED_ORIGIN)
    .send({ email, password });
  expect(signIn.status).toBe(200);

  const cookieHeader = ((signIn.headers['set-cookie'] ?? []) as unknown as string[])
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

  return { id: user!._id.toString(), cookieHeader };
};

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

describe('POST /api/v1/enrollments — retry after an abandoned gateway attempt', () => {
  it('returns a fresh payment URL instead of a 500 and preserves the old tran id', async () => {
    await clearTestDB();

    const learner = await signUpAndSignIn();
    const admin = await createAdmin();
    const course = await createCourse(admin._id, {
      title: `Retry Course ${Date.now()}`,
      slug: `retry-course-${Date.now()}`,
    });
    const batch = await createBatch(course._id, {
      price: 5000,
      currency: 'BDT',
      status: BatchStatus.Upcoming,
      enrollmentStartDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      enrollmentEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // Exact production state: pending enrollment + pending gateway payment
    // that already holds a gateway response.
    const enrollment = await EnrollmentModel.create({
      userId: learner.id,
      batchId: batch._id,
      status: EnrollmentStatus.PaymentPending,
    });

    await PaymentModel.create({
      userId: learner.id,
      batchId: batch._id,
      enrollmentRef: enrollment._id,
      transactionId: OLD_TRAN_ID,
      amount: 5000,
      currency: 'BDT',
      status: Status.Pending,
      method: 'SSLCommerz',
      gatewayResponse: {
        gatewayPageURL: 'https://sandbox.sslcommerz.com/old-session',
        cardType: 'VISA-Debit',
      },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const firstRetry = await request(app)
      .post('/api/v1/enrollments')
      .set('Cookie', learner.cookieHeader)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ batchId: batch._id.toString() });

    expect(firstRetry.status).toBe(200);
    expect(firstRetry.body.success).toBe(true);
    expect(firstRetry.body.data.paymentUrl).toContain('sslcommerz.com');

    const firstTranId = firstRetry.body.data.transactionId as string;
    expect(firstTranId).toBeTruthy();
    expect(firstTranId).not.toBe(OLD_TRAN_ID);

    const afterFirstRetry = await PaymentModel.findOne({ enrollmentRef: enrollment._id }).lean();
    expect(afterFirstRetry?.status).toBe(Status.Pending);
    expect(afterFirstRetry?.transactionId).toBe(firstTranId);
    expect(afterFirstRetry?.gatewayResponse?.supersededTranIds).toContain(OLD_TRAN_ID);
    // Audit trail from the previous attempt is preserved, not overwritten.
    expect(afterFirstRetry?.gatewayResponse?.cardType).toBe('VISA-Debit');

    // Second retry: the earlier retry's tran id becomes superseded too.
    const secondRetry = await request(app)
      .post('/api/v1/enrollments')
      .set('Cookie', learner.cookieHeader)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ batchId: batch._id.toString() });

    expect(secondRetry.status).toBe(200);
    expect(secondRetry.body.success).toBe(true);

    const secondTranId = secondRetry.body.data.transactionId as string;
    expect(secondTranId).not.toBe(firstTranId);

    const afterSecondRetry = await PaymentModel.findOne({ enrollmentRef: enrollment._id }).lean();
    expect(afterSecondRetry?.transactionId).toBe(secondTranId);
    expect(afterSecondRetry?.gatewayResponse?.supersededTranIds).toEqual(
      expect.arrayContaining([OLD_TRAN_ID, firstTranId])
    );

    // One enrollment, one payment row — no duplicates created by the retries.
    expect(await EnrollmentModel.countDocuments({ userId: learner.id })).toBe(1);
    expect(await PaymentModel.countDocuments({ enrollmentRef: enrollment._id })).toBe(1);
    expect((await EnrollmentModel.findById(enrollment._id).lean())?.status).toBe(
      EnrollmentStatus.PaymentPending
    );
  });

  it('refuses to charge again while a manual payment is under verification', async () => {
    await clearTestDB();

    const learner = await signUpAndSignIn();
    const admin = await createAdmin();
    const course = await createCourse(admin._id);
    const batch = await createBatch(course._id, {
      price: 5000,
      enrollmentStartDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      enrollmentEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const enrollment = await EnrollmentModel.create({
      userId: learner.id,
      batchId: batch._id,
      status: EnrollmentStatus.PaymentPending,
    });

    await PaymentModel.create({
      userId: learner.id,
      batchId: batch._id,
      enrollmentRef: enrollment._id,
      transactionId: 'PHONEPAY-UTR-1',
      amount: 5000,
      currency: 'BDT',
      status: Status.Review,
      method: 'PhonePay',
    });

    const res = await request(app)
      .post('/api/v1/enrollments')
      .set('Cookie', learner.cookieHeader)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ batchId: batch._id.toString() });

    expect(res.status).toBe(409);
    expect(String(res.body.message)).toMatch(/under verification/i);

    const untouched = await PaymentModel.findOne({ enrollmentRef: enrollment._id }).lean();
    expect(untouched?.status).toBe(Status.Review);
  });
});
