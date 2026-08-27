import { Schema, model, Types } from 'mongoose';
import { logger } from '../config/logger.js';

export interface IAuditLog {
    actor?: Types.ObjectId;
    actorRole?: string;
    action: string;
    targetType: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
    createdAt?: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
    {
        actor: { type: Schema.Types.ObjectId, ref: 'User' },
        actorRole: { type: String },
        action: { type: String, required: true, index: true },
        targetType: { type: String, required: true },
        targetId: { type: String, index: true },
        metadata: { type: Schema.Types.Mixed },
        ip: { type: String },
    },
    { timestamps: true }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

export const AuditLogModel = model<IAuditLog>('AuditLog', auditLogSchema);

interface RecordAuditParams {
    actor?: string;
    actorRole?: string;
    action: string;
    targetType: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    ip?: string;
}

export const recordAudit = async (params: RecordAuditParams): Promise<void> => {
    try {
        await AuditLogModel.create({
            ...params,
            actor: params.actor as unknown as Types.ObjectId | undefined,
        });
    } catch (error) {
        logger.error(error, 'Failed to write audit log entry');
    }
};
