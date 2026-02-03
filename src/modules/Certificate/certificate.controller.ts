import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { CertificateService } from './certificate.service';

/**
 * Get certificate for enrollment
 */
const getCertificate = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { enrollmentId } = req.params as { enrollmentId: string };

    const certificate = await CertificateService.getCertificateByEnrollment(
        enrollmentId,
        id
    );

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Certificate retrieved successfully',
        data: certificate,
    });
});

/**
 * Get all user certificates
 */
const getMyCertificates = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;

    const certificates = await CertificateService.getUserCertificates(id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Certificates retrieved successfully',
        data: certificates,
    });
});

/**
 * Verify certificate (public)
 */
const verifyCertificate = catchAsync(async (req: Request, res: Response) => {
    const { certificateId } = req.params as { certificateId: string };

    const result = await CertificateService.verifyCertificate(certificateId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: result.isValid ? 'Certificate is valid' : 'Certificate is invalid',
        data: result,
    });
});

/**
 * Student: Request certificate (creates pending request)
 */
const requestCertificate = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { enrollmentId } = req.params as { enrollmentId: string };

    const certificate = await CertificateService.requestCertificate(enrollmentId, id);

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Certificate request submitted. Awaiting admin approval.',
        data: certificate,
    });
});

/**
 * Admin: Approve pending certificate
 */
const approveCertificate = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { certificateId } = req.params as { certificateId: string };

    const certificate = await CertificateService.approveCertificate(certificateId, id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Certificate approved and issued successfully',
        data: certificate,
    });
});

/**
 * Admin: Get all pending certificates
 */
const getPendingCertificates = catchAsync(async (req: Request, res: Response) => {
    const certificates = await CertificateService.getPendingCertificates();

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Pending certificates retrieved successfully',
        data: certificates,
    });
});

/**
 * Admin: Issue certificate manually (direct issuance, skips approval)
 */
const issueCertificate = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { enrollmentId } = req.params as { enrollmentId: string };

    const certificate = await CertificateService.issueCertificate(enrollmentId, id);

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Certificate issued successfully',
        data: certificate,
    });
});

/**
 * Admin: Revoke certificate
 */
const revokeCertificate = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { certificateId } = req.params as { certificateId: string };
    const { reason } = req.body;

    const certificate = await CertificateService.revokeCertificate(
        certificateId,
        reason,
        id
    );

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Certificate revoked successfully',
        data: certificate,
    });
});

/**
 * Check certificate eligibility
 */
const checkEligibility = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.user as any;
    const { enrollmentId } = req.params as { enrollmentId: string };

    // Verify user owns this enrollment
    const enrollment = await require('../Enrollment/enrollment.model').EnrollmentModel.findOne({
        _id: enrollmentId,
        id,
    });

    if (!enrollment) {
        sendResponse(res, {
            statusCode: StatusCodes.FORBIDDEN,
            success: false,
            message: 'Access denied',
            data: null,
        });
        return;
    }

    const isEligible = await CertificateService.checkEligibility(enrollmentId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: isEligible
            ? 'Eligible for certificate'
            : 'Not eligible for certificate',
        data: { isEligible },
    });
});

export const CertificateController = {
    requestCertificate,
    approveCertificate,
    getPendingCertificates,
    getCertificate,
    getMyCertificates,
    verifyCertificate,
    issueCertificate,
    revokeCertificate,
    checkEligibility,
};
