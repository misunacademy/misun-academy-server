import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { PrivacyService } from './privacy.service.js';
import { ConsentService } from '../Consent/consent.service.js';

/**
 * Self-service data export (GDPR data portability).
 * Returns all personal data for the authenticated user.
 */
const exportMyData = catchAsync(async (req: Request, res: Response) => {
    const { id: userId } = req.user as any;

    const data = await PrivacyService.exportUserData(userId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'User data exported successfully',
        data: data,
    });
});

/**
 * Self-service account deletion (soft-delete + anonymize PII).
 * Keeps enrollments/payments/certificates linked by userId for financial records.
 */
const deleteMyAccount = catchAsync(async (req: Request, res: Response) => {
    const { id: userId } = req.user as any;
    const { deletionReason } = req.body as { deletionReason?: string };

    await PrivacyService.deleteUserAccount(userId, userId, deletionReason ?? '');

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Account deleted successfully',
        data: null,
    });
});

/**
 * Record user consent (marketing emails, newsletter, terms, etc.).
 */
const recordConsent = catchAsync(async (req: Request, res: Response) => {
    const { id: userId } = req.user as any;
    const { consentType, granted, source } = req.body as {
        consentType: string;
        granted: boolean;
        source: string;
    };

    const result = await ConsentService.recordConsent(
        userId,
        consentType,
        granted,
        source || 'web',
        req.ip ?? undefined,
        req.get('User-Agent')
    );

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Consent recorded successfully',
        data: result,
    });
});

/**
 * Get all consents for the authenticated user.
 */
const getMyConsents = catchAsync(async (req: Request, res: Response) => {
    const { id: userId } = req.user as any;

    const consents = await ConsentService.getUserConsents(userId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'User consents retrieved successfully',
        data: consents,
    });
});

export const PrivacyController = {
    exportMyData,
    deleteMyAccount,
    recordConsent,
    getMyConsents,
};
