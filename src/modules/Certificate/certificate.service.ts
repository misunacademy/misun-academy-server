import { CertificateModel } from './certificate.model';
import { EnrollmentModel } from '../Enrollment/enrollment.model';
import { BatchModel } from '../Batch/batch.model';
import { ModuleProgressModel } from '../Progress/moduleProgress.model';
import { CertificateStatus, EnrollmentStatus } from '../../types/common';
import ApiError from '../../errors/ApiError';
import { StatusCodes } from 'http-status-codes';
import { sendCertificateApprovedEmail, sendCertificateIssuedEmail } from '../../services/emailService';
import { UserModel } from '../User/user.model';

/**
 * Generate unique certificate ID
 */
const generateCertificateId = (): string => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `CERT-${timestamp}-${random}`;
};

/**
 * Check if enrollment is eligible for certificate
 * Requirements: All modules must be at 100% completion
 */
const checkEligibility = async (enrollmentId: string): Promise<boolean> => {
    const enrollment = await EnrollmentModel.findById(enrollmentId).populate('batchId');
    if (!enrollment) {
        return false;
    }

    // Check if enrollment is active or completed
    if (enrollment.status !== EnrollmentStatus.Active && enrollment.status !== EnrollmentStatus.Completed) {
        return false;
    }

    // Check if all modules are completed (100%)
    const moduleProgress = await ModuleProgressModel.find({ enrollmentId });

    if (moduleProgress.length === 0) {
        return false;  // No progress tracked
    }

    const allModulesCompleted = moduleProgress.every(
        (progress) => progress.completionPercentage === 100
    );

    return allModulesCompleted;
};

/**
 * Request certificate (creates pending certificate awaiting admin approval)
 * Student can request once all modules are 100% complete
 */
const requestCertificate = async (enrollmentId: string, userId: string) => {
    // Verify ownership
    const enrollment = await EnrollmentModel.findOne({ _id: enrollmentId, userId });
    if (!enrollment) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'Access denied');
    }

    // Check if already has certificate (pending or active)
    const existingCertificate = await CertificateModel.findOne({ enrollmentId });
    if (existingCertificate) {
        if (existingCertificate.status === CertificateStatus.Pending) {
            throw new ApiError(StatusCodes.CONFLICT, 'Certificate request is pending admin approval');
        }
        throw new ApiError(StatusCodes.CONFLICT, 'Certificate already issued for this enrollment');
    }

    // Check eligibility (100% completion)
    const isEligible = await checkEligibility(enrollmentId);
    if (!isEligible) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'You must complete all modules (100%) before requesting a certificate'
        );
    }

    // Get batch and course details
    const batch = await BatchModel.findById(enrollment.batchId).populate('courseId');
    if (!batch) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Batch not found');
    }

    // Generate certificate ID
    const certificateId = generateCertificateId();
    const verificationUrl = `${process.env.MA_FRONTEND_URL || process.env.CLIENT_URL}/verify-certificate/${certificateId}`;

    // Create PENDING certificate awaiting admin approval
    const certificate = await CertificateModel.create({
        enrollmentId,
        userId,
        batchId: enrollment.batchId,
        courseId: (batch.courseId as any)._id,
        certificateId,
        issueDate: new Date(),
        certificateUrl: verificationUrl,
        verificationUrl,
        status: CertificateStatus.Pending,  // Awaiting admin approval
        issuedBy: userId,  // Requested by student
    });

    return certificate;
};

/**
 * Approve certificate (Admin only)
 * Changes status from Pending to Active
 */
const approveCertificate = async (certificateId: string, approvedBy: string) => {
    const certificate = await CertificateModel.findOne({ certificateId });
    if (!certificate) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Certificate not found');
    }

    if (certificate.status !== CertificateStatus.Pending) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Certificate is not pending approval');
    }

    // Approve certificate
    certificate.status = CertificateStatus.Active;
    (certificate as any).approvedBy = approvedBy;
    (certificate as any).approvedAt = new Date();
    await certificate.save();

    // Update enrollment
    await EnrollmentModel.findByIdAndUpdate(certificate.enrollmentId, {
        certificateIssued: true,
        completedAt: new Date(),
        status: EnrollmentStatus.Completed
    });

    // Send certificate approved email
    try {
        const enrollment = await EnrollmentModel.findById(certificate.enrollmentId).populate('batchId');
        if (enrollment) {
            const user = await UserModel.findById(enrollment.userId);
            const batch = await BatchModel.findById(enrollment.batchId).populate('courseId');
            if (user && batch && batch.courseId) {
                sendCertificateApprovedEmail(
                    user.email,
                    user.name,
                    (batch.courseId as any).title || 'Unknown Course',
                    certificate.certificateId
                );
            }
        }
    } catch (emailError) {
        console.error('Failed to send certificate approved email:', emailError);
    }

    return certificate;
};

/**
 * Issue certificate directly (Admin only - for manual issuance)
 * Skips pending status and issues immediately
 */
const issueCertificate = async (enrollmentId: string, issuedBy: string) => {
    // Check if already issued
    const existingCertificate = await CertificateModel.findOne({ enrollmentId });
    if (existingCertificate) {
        throw new ApiError(StatusCodes.CONFLICT, 'Certificate already exists for this enrollment');
    }

    // Check eligibility
    const isEligible = await checkEligibility(enrollmentId);
    if (!isEligible) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'Enrollment is not eligible for certificate. All modules must be completed.'
        );
    }

    // Get enrollment and batch details
    const enrollment = await EnrollmentModel.findById(enrollmentId)
        .populate('userId', 'name email')
        .populate({
            path: 'batchId',
            populate: { path: 'courseId', select: 'title' },
        });

    if (!enrollment) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
    }

    const batch = enrollment.batchId as any;

    // Generate certificate
    const certificateId = generateCertificateId();
    const verificationUrl = `${process.env.MA_FRONTEND_URL || process.env.CLIENT_URL}/verify-certificate/${certificateId}`;

    const certificate = await CertificateModel.create({
        enrollmentId,
        userId: enrollment.userId,
        batchId: enrollment.batchId,
        courseId: batch.courseId._id,
        certificateId,
        issueDate: new Date(),
        certificateUrl: verificationUrl,
        verificationUrl,
        status: CertificateStatus.Active,  // Direct issuance - already approved
        issuedBy: issuedBy as any,
    });

    // Update enrollment
    await EnrollmentModel.findByIdAndUpdate(enrollmentId, {
        certificateIssued: true,
        certificateId: certificate._id,
        completedAt: new Date(),
        status: EnrollmentStatus.Completed
    });

    // Send certificate issued email
    try {
        const user = await UserModel.findById(enrollment.userId);
        if (user && batch && batch.courseId) {
            sendCertificateIssuedEmail(
                user.email,
                user.name,
                batch.courseId.title || 'Unknown Course',
                certificate.certificateId
            );
        }
    } catch (emailError) {
        console.error('Failed to send certificate issued email:', emailError);
    }

    return certificate;
};

/**
 * Get certificate by enrollment
 */
const getCertificateByEnrollment = async (enrollmentId: string, userId: string) => {
    const enrollment = await EnrollmentModel.findOne({ _id: enrollmentId, userId });
    if (!enrollment) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'Access denied');
    }

    const certificate = await CertificateModel.findOne({ enrollmentId })
        .populate('userId', 'name email')
        .populate({
            path: 'batchId',
            populate: { path: 'courseId', select: 'title' },
        });

    if (!certificate) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Certificate not found');
    }

    return certificate;
};

/**
 * Verify certificate by certificate ID (public)
 */
const verifyCertificate = async (certificateId: string) => {
    const certificate = await CertificateModel.findOne({ certificateId })
        .populate('userId', 'name')
        .populate({
            path: 'batchId',
            populate: { path: 'courseId', select: 'title' },
        });

    if (!certificate) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Certificate not found');
    }

    if (certificate.status === CertificateStatus.Revoked) {
        return {
            isValid: false,
            status: 'revoked',
            reason: 'Certificate has been revoked',
            revokedAt: certificate.revokedAt,
            revocationReason: certificate.revokedReason,
        };
    }

    if (certificate.status === CertificateStatus.Pending) {
        return {
            isValid: false,
            status: 'pending',
            reason: 'Certificate is pending admin approval',
        };
    }

    return {
        isValid: true,
        status: 'active',
        certificate: {
            certificateId: certificate.certificateId,
            recipientName: (certificate.userId as any).name,
            courseName: ((certificate.batchId as any).courseId as any).title,
            batchId: certificate.batchId,
            issuedDate: certificate.issueDate,
        },
    };
};

/**
 * Revoke certificate
 */
const revokeCertificate = async (
    certificateId: string,
    reason: string,
    revokedBy: string
) => {
    const certificate = await CertificateModel.findOne({ certificateId });
    if (!certificate) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Certificate not found');
    }

    if (certificate.status === CertificateStatus.Revoked) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Certificate is already revoked');
    }

    certificate.status = CertificateStatus.Revoked;
    certificate.revokedAt = new Date();
    certificate.revokedReason = reason;
    (certificate as any).revokedBy = revokedBy;
    await certificate.save();

    return certificate;
};

/**
 * Get all certificates for a user (includes pending, active, and revoked)
 */
const getUserCertificates = async (userId: string) => {
    const certificates = await CertificateModel.find({ userId })
        .populate({
            path: 'batchId',
            populate: { path: 'courseId', select: 'title thumbnail' },
        })
        .sort({ issueDate: -1 });

    return certificates;
};

/**
 * Get all pending certificates (Admin only)
 */
const getPendingCertificates = async () => {
    const certificates = await CertificateModel.find({ status: CertificateStatus.Pending })
        .populate('userId', 'name email')
        .populate({
            path: 'batchId',
            populate: { path: 'courseId', select: 'title' },
        })
        .sort({ issueDate: -1 });

    return certificates;
};

export const CertificateService = {
    requestCertificate,
    approveCertificate,
    issueCertificate,
    getCertificateByEnrollment,
    verifyCertificate,
    revokeCertificate,
    getUserCertificates,
    getPendingCertificates,
    checkEligibility,
};
