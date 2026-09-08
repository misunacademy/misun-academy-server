import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser, createAdmin, createCourse, createBatch, createPayment, createEnrollment } from '../helpers/factories.js';
import { RefundService } from '../../modules/Refund/refund.service.js';
import { RefundStatus, RefundChannel } from '../../modules/Refund/refund.interface.js';
import { Status, EnrollmentStatus } from '../../types/common.js';

let adminId: mongoose.Types.ObjectId;
let txnSeq = 0;

const nextTxn = (prefix = 'TXN') => `${prefix}-${Date.now()}-${++txnSeq}`;

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

const setupPaidEnrollment = async (overrides: Record<string, unknown> = {}) => {
  const user = await createUser();
  const course = await createCourse(adminId);
  const batch = await createBatch(course._id);
  const txn = nextTxn();
  const payment = await createPayment(user._id, batch._id, {
    transactionId: txn,
    enrollmentId: `ENR-${txn}`,
    status: Status.Success,
    ...overrides,
  });
  const enrollment = await createEnrollment(user._id, batch._id, {
    enrollmentId: `ENR-${txn}`,
    status: EnrollmentStatus.Active,
  });
  return { user, course, batch, payment, enrollment, txn };
};

describe('RefundService.createRefund', () => {
  it('creates a pending refund defaulting to the paid amount (manual channel)', async () => {
    const { payment, txn } = await setupPaidEnrollment();

    const refund = await RefundService.createRefund(
      { transactionId: txn, reason: 'Student requested withdrawal' },
      { id: adminId.toString(), role: 'admin' }
    );

    expect(refund.status).toBe(RefundStatus.Pending);
    expect(refund.amount).toBe(payment.amount);
    expect(refund.channel).toBe(RefundChannel.Manual);
    expect(refund.method).toBe('SSLCommerz');
  });

  it('assigns the gateway channel when bank_tran_id exists on the payment', async () => {
    const { txn } = await setupPaidEnrollment({
      gatewayResponse: { bank_tran_id: 'BANK123', card_issuer: 'Visa' },
    });

    const refund = await RefundService.createRefund(
      { transactionId: txn, reason: 'Duplicate charge' },
      { id: adminId.toString(), role: 'admin' }
    );

    expect(refund.channel).toBe(RefundChannel.Gateway);
  });

  it('rejects refunds for payments that are not successful', async () => {
    const user = await createUser();
    const course = await createCourse(adminId);
    const batch = await createBatch(course._id);
    const txn = nextTxn();
    await createPayment(user._id, batch._id, { transactionId: txn, status: Status.Pending });

    await expect(
      RefundService.createRefund({ transactionId: txn, reason: 'Too early' }, { id: adminId.toString() })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects amounts exceeding the paid amount', async () => {
    const { txn } = await setupPaidEnrollment();

    await expect(
      RefundService.createRefund(
        { transactionId: txn, amount: 999999, reason: 'Over refund' },
        { id: adminId.toString() }
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a second active refund for the same transaction', async () => {
    const { txn } = await setupPaidEnrollment();
    const actor = { id: adminId.toString() };

    await RefundService.createRefund({ transactionId: txn, reason: 'First' }, actor);

    await expect(
      RefundService.createRefund({ transactionId: txn, reason: 'Second' }, actor)
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('RefundService decisions', () => {
  it('approves a pending refund and stamps the processor', async () => {
    const { txn } = await setupPaidEnrollment();
    const refund = await RefundService.createRefund({ transactionId: txn, reason: 'Withdraw' }, { id: adminId.toString() });

    const approved = await RefundService.approveRefund(
      (refund._id as mongoose.Types.ObjectId).toString(),
      'Verified with student',
      { id: adminId.toString() }
    );

    expect(approved.status).toBe(RefundStatus.Approved);
    expect(approved.decisionNote).toBe('Verified with student');
    expect(approved.processedBy?.toString()).toBe(adminId.toString());
  });

  it('rejects completing a refund that is still pending', async () => {
    const { txn } = await setupPaidEnrollment();
    const refund = await RefundService.createRefund({ transactionId: txn, reason: 'Withdraw' }, { id: adminId.toString() });

    await expect(
      RefundService.completeRefund((refund._id as mongoose.Types.ObjectId).toString(), { id: adminId.toString() })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('completes a manual refund and revokes the enrollment', async () => {
    const { txn } = await setupPaidEnrollment();
    const actor = { id: adminId.toString() };
    const refund = await RefundService.createRefund({ transactionId: txn, reason: 'Withdraw' }, actor);
    const refundId = (refund._id as mongoose.Types.ObjectId).toString();

    await RefundService.approveRefund(refundId, undefined, actor);
    const completed = await RefundService.completeRefund(refundId, actor);

    expect(completed?.status).toBe(RefundStatus.Completed);
    expect(completed?.completedAt).toBeDefined();

    const payment = await mongoose
      .model('Payment')
      .findOne({ transactionId: txn })
      .lean<{ status: string }>();
    expect(payment?.status).toBe(Status.Refunded);

    const enrollment = await mongoose
      .model('Enrollment')
      .findOne({ enrollmentId: `ENR-${txn}` })
      .lean<{ status: string }>();
    expect(enrollment?.status).toBe(EnrollmentStatus.Refunded);
  });

  it('allows a new refund request after a rejection', async () => {
    const { txn } = await setupPaidEnrollment();
    const actor = { id: adminId.toString() };
    const refund = await RefundService.createRefund({ transactionId: txn, reason: 'Withdraw' }, actor);
    const refundId = (refund._id as mongoose.Types.ObjectId).toString();

    await RefundService.rejectRefund(refundId, 'Not eligible yet', actor);
    const second = await RefundService.createRefund({ transactionId: txn, reason: 'Changed decision' }, actor);

    expect(second.status).toBe(RefundStatus.Pending);
    expect((second._id as mongoose.Types.ObjectId).toString()).not.toBe(refundId);
  });
});

describe('RefundService.listRefunds', () => {
  it('returns refunds with student, course and batch info', async () => {
    const { txn, course } = await setupPaidEnrollment();
    const actor = { id: adminId.toString() };
    const refund = await RefundService.createRefund({ transactionId: txn, reason: 'Withdraw' }, actor);
    await RefundService.approveRefund((refund._id as mongoose.Types.ObjectId).toString(), undefined, actor);

    const { data, meta } = await RefundService.listRefunds({ status: RefundStatus.Approved });

    expect(meta.total).toBe(1);
    expect(data[0].transactionId).toBe(txn);
    expect(data[0].student).toBeDefined();
    expect(data[0].course.title).toBe(course.title);
    expect(data[0].status).toBe(RefundStatus.Approved);
  });

  it('filters by status and search term', async () => {
    const { txn } = await setupPaidEnrollment();
    const actor = { id: adminId.toString() };
    await RefundService.createRefund({ transactionId: txn, reason: 'Withdraw' }, actor);

    const pending = await RefundService.listRefunds({ status: RefundStatus.Pending });
    expect(pending.meta.total).toBe(1);

    const byTxn = await RefundService.listRefunds({ search: txn });
    expect(byTxn.data[0].transactionId).toBe(txn);

    const none = await RefundService.listRefunds({ status: RefundStatus.Completed });
    expect(none.meta.total).toBe(0);
  });
});