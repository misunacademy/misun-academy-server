import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch, createPayment } from '../helpers/factories.js';
import { PaymentService } from '../../modules/Payment/payment.service.js';
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
