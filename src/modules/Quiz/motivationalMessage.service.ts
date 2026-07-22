import { StatusCodes } from 'http-status-codes';
import { MotivationalMessageModel } from './motivationalMessage.model.js';
import ApiError from '../../errors/ApiError.js';

const getAllMessages = async () => {
    const messages = await MotivationalMessageModel.find()
        .sort({ minPercentage: 1 })
        .lean();
    return messages;
};

const createMessage = async (data: any) => {
    const overlapping = await MotivationalMessageModel.findOne({
        isActive: true,
        minPercentage: { $lte: data.maxPercentage },
        maxPercentage: { $gte: data.minPercentage },
    }).lean();

    if (overlapping) {
        throw new ApiError(
            StatusCodes.CONFLICT,
            'This percentage range overlaps with an existing message'
        );
    }

    const message = await MotivationalMessageModel.create(data);
    return message;
};

const updateMessage = async (messageId: string, data: any) => {
    const message = await MotivationalMessageModel.findById(messageId).lean();
    if (!message) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Motivational message not found');
    }

    const updated = await MotivationalMessageModel.findByIdAndUpdate(
        messageId,
        { $set: data },
        { new: true, runValidators: true }
    );
    return updated;
};

const deleteMessage = async (messageId: string) => {
    const message = await MotivationalMessageModel.findById(messageId).lean();
    if (!message) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Motivational message not found');
    }

    await MotivationalMessageModel.findByIdAndDelete(messageId);
    return null;
};

const getMessageForPercentage = async (percentage: number) => {
    const message = await MotivationalMessageModel.findOne({
        isActive: true,
        minPercentage: { $lte: percentage },
        maxPercentage: { $gte: percentage },
    })
        .sort({ minPercentage: 1 })
        .lean();

    return message || null;
};

export const MotivationalMessageService = {
    getAllMessages,
    createMessage,
    updateMessage,
    deleteMessage,
    getMessageForPercentage,
};
