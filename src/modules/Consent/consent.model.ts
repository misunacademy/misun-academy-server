import { Schema, model, Types } from 'mongoose';

export interface IConsent {
    userId: Types.ObjectId;
    consentType: string; // 'marketing_emails', 'newsletter', 'data_processing', 'terms_acceptance', etc.
    granted: boolean;
    grantedAt: Date;
    revokedAt?: Date;
    source: string; // 'web', 'mobile', 'admin', 'api'
    ip?: string;
    userAgent?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

const consentSchema = new Schema<IConsent>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        consentType: { type: String, required: true, index: true },
        granted: { type: Boolean, required: true },
        grantedAt: { type: Date, required: true },
        revokedAt: { type: Date },
        source: { type: String, required: true },
        ip: { type: String },
        userAgent: { type: String },
    },
    { timestamps: true }
);

// One active consent per user per type
consentSchema.index({ userId: 1, consentType: 1, granted: 1 });

export const ConsentModel = model<IConsent>('Consent', consentSchema);
