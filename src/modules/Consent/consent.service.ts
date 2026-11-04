import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';
import { ConsentModel } from './consent.model.js';
import { UserModel } from '../User/user.model.js';

/**
 * Record or update user consent for a given type.
 * Idempotent: upserts based on userId + consentType.
 */
export const recordConsent = async (
    userId: string,
    consentType: string,
    granted: boolean,
    source: string,
    ip?: string,
    userAgent?: string
) => {
    const user = await UserModel.findById(userId);
    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    const now = new Date();

    const consent = await ConsentModel.findOneAndUpdate(
        { userId, consentType },
        {
            $set: {
                granted,
                grantedAt: granted ? now : undefined,
                revokedAt: granted ? undefined : now,
                source,
                ip,
                userAgent,
            },
            $setOnInsert: { createdAt: now },
        },
        { upsert: true, new: true }
    );

    return consent;
};

/**
 * Get all consents for a user
 */
export const getUserConsents = async (userId: string) => {
    const user = await UserModel.findById(userId);
    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    return ConsentModel.find({ userId }).lean();
};

/**
 * Check if a user has granted a specific consent
 */
export const hasConsent = async (userId: string, consentType: string): Promise<boolean> => {
    const consent = await ConsentModel.findOne({ userId, consentType, granted: true }).lean();
    return !!consent;
};

export const ConsentService = {
    recordConsent,
    getUserConsents,
    hasConsent,
};
