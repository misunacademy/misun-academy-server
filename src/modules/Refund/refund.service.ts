import mongoose, { PipelineStage } from 'mongoose';
import { RefundModel } from './refund.model.js';
import { RefundChannel, RefundStatus } from './refund.interface.js';
import { PaymentModel } from '../Payment/payment.model.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import { UserModel } from '../User/user.model.js';
import { Status, EnrollmentStatus } from '../../types/common.js';
import ApiError from '../../errors/ApiError.js';
import { StatusCodes } from 'http-status-codes';
import { recordAudit } from '../../models/auditLog.model.js';
import { NotificationService } from '../Notification/notification.service.js';
import env from '../../config/env.js';

interface Actor {
  id: string;
  role?: string;
}

interface CreateRefundPayload {
  transactionId: string;
  amount?: number;
  reason: string;
}

interface ListQuery {
  status?: RefundStatus;
  search?: string;
  page?: number;
  limit?: number;
}

const getBankTranId = (gatewayResponse: unknown): string | undefined => {
  if (!gatewayResponse || typeof gatewayResponse !== 'object') return undefined;
  const gw = gatewayResponse as Record<string, unknown>;
  return typeof gw.bank_tran_id === 'string' && gw.bank_tran_id ? gw.bank_tran_id : undefined;
};

const resolveSslBaseUrl = (): string =>
  env.SSL_IS_LIVE === 'true' ? 'https://live.sslcommerz.com' : 'https://sandbox.sslcommerz.com';

interface SslRefundResult {
  status?: string;
  refund_ref?: string;
  errorReason?: string;
}

const requestGatewayRefund = async (
  bankTranId: string,
  amount: number,
  remarks: string
): Promise<SslRefundResult | null> => {
  const body = new URLSearchParams({
    store_id: env.SSL_STORE_ID,
    store_passwd: env.SSL_STORE_PASSWORD,
    bank_tran_id: bankTranId,
    refund_amount: amount.toFixed(2),
    refund_remarks: remarks,
  });

  try {
    const res = await fetch(`${resolveSslBaseUrl()}/merchant/api/refund/api.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    return (await res.json()) as SslRefundResult;
  } catch {
    return null;
  }
};

const createRefund = async (payload: CreateRefundPayload, actor: Actor, ip?: string) => {
  const payment = await PaymentModel.findOne({ transactionId: payload.transactionId });
  if (!payment) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Payment not found');
  }
  if (payment.status !== Status.Success) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Only successful payments can be refunded');
  }

  const amount = payload.amount ?? payment.amount;
  if (amount <= 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Refund amount must be positive');
  }
  if (amount > payment.amount) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Refund amount cannot exceed the paid amount');
  }

  const activeRefund = await RefundModel.findOne({
    transactionId: payload.transactionId,
    status: { $in: [RefundStatus.Pending, RefundStatus.Approved, RefundStatus.Completed] },
  });
  if (activeRefund) {
    throw new ApiError(StatusCodes.CONFLICT, 'An active refund already exists for this transaction');
  }

  const bankTranId = getBankTranId(payment.gatewayResponse);
  const channel =
    payment.method === 'SSLCommerz' && bankTranId ? RefundChannel.Gateway : RefundChannel.Manual;

  const refund = await RefundModel.create({
    paymentId: payment._id,
    transactionId: payment.transactionId,
    enrollmentId: payment.enrollmentId,
    userId: payment.userId,
    batchId: payment.batchId,
    amount,
    currency: payment.currency,
    method: payment.method,
    channel,
    status: RefundStatus.Pending,
    reason: payload.reason,
    requestedBy: new mongoose.Types.ObjectId(actor.id),
  });

  await recordAudit({
    actor: actor.id,
    actorRole: actor.role,
    action: 'refund.create',
    targetType: 'Refund',
    targetId: refund._id.toString(),
    metadata: { transactionId: payload.transactionId, amount, channel },
    ip,
  });

  return refund;
};

const listRefunds = async (query: ListQuery) => {
  const { status, search, page = 1, limit = 10 } = query;

  const filters: Record<string, unknown> = {};
  if (status) filters.status = status;

  const searchFilter: Record<string, unknown> | null = search
    ? {
        $or: [
          { 'matchedUser.name': { $regex: search, $options: 'i' } },
          { 'matchedUser.email': { $regex: search, $options: 'i' } },
          { transactionId: { $regex: search, $options: 'i' } },
        ],
      }
    : null;

  const pipeline: PipelineStage[] = [
    ...(Object.keys(filters).length > 0 ? [{ $match: filters }] : []),
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'batches',
        localField: 'batchId',
        foreignField: '_id',
        as: 'batch',
      },
    },
    { $unwind: { path: '$batch', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'courses',
        localField: 'batch.courseId',
        foreignField: '_id',
        as: 'course',
      },
    },
    { $unwind: { path: '$course', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'payments',
        localField: 'paymentId',
        foreignField: '_id',
        as: 'payment',
      },
    },
    { $unwind: { path: '$payment', preserveNullAndEmptyArrays: true } },
    ...(searchFilter ? [{ $match: searchFilter }] : []),
    { $sort: { createdAt: -1 } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
    {
      $project: {
        transactionId: 1,
        amount: 1,
        currency: 1,
        method: 1,
        channel: 1,
        status: 1,
        reason: 1,
        decisionNote: 1,
        gatewayRef: 1,
        processedAt: 1,
        completedAt: 1,
        createdAt: 1,
        student: {
          _id: '$user._id',
          name: '$user.name',
          email: '$user.email',
          phone: '$user.phoneNumber',
        },
        batch: {
          _id: '$batch._id',
          title: '$batch.title',
          batchNumber: { $concat: ['Batch #', { $toString: '$batch.batchNumber' }] },
        },
        course: {
          _id: '$course._id',
          title: '$course.title',
          slug: '$course.slug',
        },
        paymentStatus: '$payment.status',
      },
    },
  ];

  const countPipeline: PipelineStage[] = [
    ...(Object.keys(filters).length > 0 ? [{ $match: filters }] : []),
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'matchedUser',
      },
    },
    ...(searchFilter ? [{ $match: searchFilter }] : []),
    { $count: 'total' },
  ];

  const [data, totalResult] = await Promise.all([
    RefundModel.aggregate(pipeline),
    RefundModel.aggregate(countPipeline),
  ]);

  const total = totalResult[0]?.total ?? 0;

  return {
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    data,
  };
};

const getRefundById = async (id: string) => {
  const refund = await RefundModel.findById(id)
    .populate('userId', 'name email phoneNumber')
    .populate('requestedBy', 'name email')
    .populate('processedBy', 'name email')
    .populate('batchId', 'title batchNumber')
    .lean();
  return refund;
};

const approveRefund = async (id: string, note: string | undefined, actor: Actor, ip?: string) => {
  const refund = await RefundModel.findById(id);
  if (!refund) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Refund not found');
  }
  if (refund.status !== RefundStatus.Pending) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Only pending refunds can be approved');
  }

  refund.status = RefundStatus.Approved;
  refund.decisionNote = note ?? refund.decisionNote;
  refund.processedBy = new mongoose.Types.ObjectId(actor.id);
  refund.processedAt = new Date();
  await refund.save();

  await recordAudit({
    actor: actor.id,
    actorRole: actor.role,
    action: 'refund.approve',
    targetType: 'Refund',
    targetId: id,
    metadata: { transactionId: refund.transactionId, amount: refund.amount },
    ip,
  });

  return refund;
};

const rejectRefund = async (id: string, note: string | undefined, actor: Actor, ip?: string) => {
  const refund = await RefundModel.findById(id);
  if (!refund) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Refund not found');
  }
  if (refund.status !== RefundStatus.Pending) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Only pending refunds can be rejected');
  }

  refund.status = RefundStatus.Rejected;
  refund.decisionNote = note ?? refund.decisionNote;
  refund.processedBy = new mongoose.Types.ObjectId(actor.id);
  refund.processedAt = new Date();
  await refund.save();

  await recordAudit({
    actor: actor.id,
    actorRole: actor.role,
    action: 'refund.reject',
    targetType: 'Refund',
    targetId: id,
    metadata: { transactionId: refund.transactionId, amount: refund.amount },
    ip,
  });

  return refund;
};

const completeRefund = async (id: string, actor: Actor, ip?: string) => {
  const refund = await RefundModel.findById(id);
  if (!refund) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Refund not found');
  }
  if (refund.status !== RefundStatus.Approved) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Only approved refunds can be completed');
  }

  let gatewayResponse: unknown = refund.gatewayResponse;
  let gatewayRef = refund.gatewayRef;

  if (refund.channel === RefundChannel.Gateway) {
    const payment = await PaymentModel.findById(refund.paymentId).lean();
    const bankTranId = getBankTranId(payment?.gatewayResponse);
    if (!bankTranId) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Gateway refund unavailable: bank_tran_id missing. Complete this refund manually instead.'
      );
    }

    const result = await requestGatewayRefund(bankTranId, refund.amount, `Refund for ${refund.transactionId}`);
    if (!result || result.status !== 'SUCCESS') {
      throw new ApiError(
        StatusCodes.BAD_GATEWAY,
        `Gateway refund failed: ${result?.errorReason ?? 'no response from SSLCommerz'}`
      );
    }
    gatewayResponse = result;
    gatewayRef = result.refund_ref;
  }

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    refund.status = RefundStatus.Completed;
    refund.gatewayResponse = gatewayResponse;
    refund.gatewayRef = gatewayRef;
    refund.processedBy = new mongoose.Types.ObjectId(actor.id);
    refund.completedAt = new Date();
    await refund.save({ session });

    await PaymentModel.findOneAndUpdate(
      { transactionId: refund.transactionId },
      { status: Status.Refunded, updatedAt: new Date() },
      { session }
    );

    if (refund.enrollmentId) {
      await EnrollmentModel.findOneAndUpdate(
        { enrollmentId: refund.enrollmentId },
        { status: EnrollmentStatus.Refunded },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }

  const user = await UserModel.findById(refund.userId).lean();
  if (user) {
    try {
      await NotificationService.createNotification({
        userId: user._id.toString(),
        type: 'payment_refunded',
        title: 'Payment refunded',
        message: `Your payment for transaction ${refund.transactionId} has been refunded.`,
        link: '/dashboard/notifications',
      });
    } catch {
      // notification is best-effort
    }
  }

  await recordAudit({
    actor: actor.id,
    actorRole: actor.role,
    action: 'refund.complete',
    targetType: 'Refund',
    targetId: id,
    metadata: {
      transactionId: refund.transactionId,
      amount: refund.amount,
      channel: refund.channel,
      gatewayRef,
    },
    ip,
  });

  return RefundModel.findById(id).lean();
};

export const RefundService = {
  createRefund,
  listRefunds,
  getRefundById,
  approveRefund,
  rejectRefund,
  completeRefund,
};