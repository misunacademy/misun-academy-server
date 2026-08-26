import { Schema, model, Types } from 'mongoose';

export interface IUploadAsset {
    publicId: string;
    uploadedBy?: Types.ObjectId;
    delivery: 'public' | 'authenticated';
    createdAt?: Date;
}

const uploadAssetSchema = new Schema<IUploadAsset>(
    {
        publicId: { type: String, required: true },
        uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        delivery: { type: String, enum: ['public', 'authenticated'], default: 'public' },
    },
    { timestamps: true }
);

uploadAssetSchema.index({ publicId: 1 }, { unique: true });
uploadAssetSchema.index({ uploadedBy: 1, createdAt: -1 });

export const UploadAssetModel = model<IUploadAsset>('UploadAsset', uploadAssetSchema);
