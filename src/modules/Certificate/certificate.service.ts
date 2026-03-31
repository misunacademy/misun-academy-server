import { CertificateModel } from './certificate.model.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import { BatchModel } from '../Batch/batch.model.js';
import { ModuleProgressModel } from '../Progress/moduleProgress.model.js';
import { ProgressService } from '../Progress/progress.service.js';
import { CertificateStatus, EnrollmentStatus } from '../../types/common.js';
import ApiError from '../../errors/ApiError.js';
import { StatusCodes } from 'http-status-codes';
import { sendCertificateApprovedEmail, sendCertificateIssuedEmail } from '../../services/emailService.js';
import { UserModel } from '../User/user.model.js';
import mongoose from 'mongoose';

const findCertificateByIdentifier = async (identifier: string) => {
    if (mongoose.Types.ObjectId.isValid(identifier)) {
        const byId = await CertificateModel.findById(identifier);
        if (byId) return byId;
    }
    return CertificateModel.findOne({ certificateId: identifier });
};

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
    const enrollment = await EnrollmentModel.findById(enrollmentId).populate({
        path: 'batchId',
        populate: { path: 'courseId' },
    });
    if (!enrollment) {
        return false;
    }

    // Check if enrollment is active or completed
    if (enrollment.status !== EnrollmentStatus.Active && enrollment.status !== EnrollmentStatus.Completed) {
        return false;
    }

    // When certificate is not available for the course, not eligible
    const course = (enrollment.batchId as any)?.courseId;
    if (!course || course.isCertificateAvailable === false) {
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

    const course = (batch.courseId as any);
    if (!course || course.isCertificateAvailable === false) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Certificates are not available for this course');
    }

    // Generate certificate ID
    const certificateId = generateCertificateId();
    const frontendBaseUrl = process.env.MA_FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000';
    const verificationUrl = `${frontendBaseUrl}/verify-certificate/${certificateId}`;

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
    const certificate = await findCertificateByIdentifier(certificateId);
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
    const frontendBaseUrl = process.env.MA_FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000';
    const verificationUrl = `${frontendBaseUrl}/verify-certificate/${certificateId}`;

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

    return enrichCertificateWithCompletion(certificate);
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
            batchName: (certificate.batchId as any).title,
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
    const certificate = await findCertificateByIdentifier(certificateId);
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
 * Attach enrollment progress percentage to certificates
 */
const enrichCertificateWithCompletion = async (certificate: any) => {
    let completionPercentage = 0;

    try {
        const progress = await ProgressService.getBatchProgress(certificate.enrollmentId.toString());
        completionPercentage = progress?.overallProgress ?? 0;
    } catch (err) {
        completionPercentage = 0;
    }

    const plainData = certificate.toObject ? certificate.toObject() : certificate;
    return {
        ...plainData,
        completionPercentage,
    };
};

const getAllCertificates = async (status?: string) => {
    const normalizedStatus = status?.toLowerCase();
    const statusFilter = normalizedStatus === 'approved'
        ? CertificateStatus.Active
        : normalizedStatus === 'rejected'
            ? CertificateStatus.Revoked
            : normalizedStatus === 'pending' || normalizedStatus === 'active' || normalizedStatus === 'revoked'
                ? normalizedStatus
                : undefined;

    const query = statusFilter ? { status: statusFilter } : {};

    const certificates = await CertificateModel.find(query)
        .populate('userId', 'name email')
        .populate({
            path: 'batchId',
            populate: { path: 'courseId', select: 'title' },
        })
        .sort({ createdAt: -1 });

    return Promise.all(certificates.map(enrichCertificateWithCompletion));
};

const updateCertificateStatus = async (
    certificateId: string,
    payload: { status?: string; reason?: string; rejectionReason?: string },
    adminId: string
) => {
    const certificate = await findCertificateByIdentifier(certificateId);
    if (!certificate) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Certificate not found');
    }

    const requestedStatus = payload.status?.toLowerCase();

    if (requestedStatus === 'approved' || requestedStatus === 'active') {
        if (certificate.status === CertificateStatus.Active) {
            return certificate;
        }
        if (certificate.status !== CertificateStatus.Pending) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Only pending certificates can be approved');
        }
        return approveCertificate(certificate.certificateId, adminId);
    }

    if (requestedStatus === 'rejected' || requestedStatus === 'revoked') {
        if (certificate.status === CertificateStatus.Revoked) {
            return certificate;
        }

        const reason = payload.rejectionReason || payload.reason || 'Rejected by admin';
        return revokeCertificate(certificate.certificateId, reason, adminId);
    }

    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid status. Use Approved/Rejected or Active/Revoked');
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

    return Promise.all(certificates.map(enrichCertificateWithCompletion));
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

    return Promise.all(certificates.map(enrichCertificateWithCompletion));
};

export const CertificateService = {
    requestCertificate,
    approveCertificate,
    issueCertificate,
    getCertificateByEnrollment,
    verifyCertificate,
    revokeCertificate,
    updateCertificateStatus,
    getAllCertificates,
    getUserCertificates,
    getPendingCertificates,
    checkEligibility,
};
