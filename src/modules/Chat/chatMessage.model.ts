import { Schema, model, Types } from 'mongoose';

export interface IChatMessage {
    userId: Types.ObjectId;
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    createdAt?: Date;
    updatedAt?: Date;
}

const chatMessageSchema = new Schema<IChatMessage>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        conversationId: {
            type: String,
            required: true,
            index: true,
        },
        role: {
            type: String,
            enum: ['user', 'assistant'],
            required: true,
        },
        content: {
            type: String,
            required: true,
        },
        promptTokens: {
            type: Number,
            default: 0,
        },
        completionTokens: {
            type: Number,
            default: 0,
        },
        totalTokens: {
            type: Number,
            default: 0,
        },
    },
    { timestamps: true }
);

chatMessageSchema.index({ userId: 1, createdAt: -1 });
chatMessageSchema.index({ conversationId: 1, createdAt: 1 });

export const ChatMessageModel = model<IChatMessage>('ChatMessage', chatMessageSchema);
