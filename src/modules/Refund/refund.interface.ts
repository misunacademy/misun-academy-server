import { Types } from 'mongoose';

export enum RefundStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
  Completed = 'completed',
}

export enum RefundChannel {
  Gateway = 'gateway',
  Manual = 'manual',
}

export interface IRefund {
  paymentId: Types.ObjectId;
  transactionId: string;
  enrollmentId?: string;
  userId: Types.ObjectId;
  batchId: Types.ObjectId;
  amount: number;
  currency: string;
  method: string;
  channel: RefundChannel;
  status: RefundStatus;
  reason: string;
  decisionNote?: string;
  gatewayRef?: string;
  gatewayResponse?: unknown;
  requestedBy: Types.ObjectId;
  processedBy?: Types.ObjectId;
  processedAt?: Date;
  completedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}