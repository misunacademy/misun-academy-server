import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';
import { UserModel } from '../User/user.model.js';
import { EnrollmentModel } from '../Enrollment/enrollment.model.js';
import { PaymentModel } from '../Payment/payment.model.js';
import { CertificateModel } from '../Certificate/certificate.model.js';
import { LessonProgressModel } from '../Progress/lessonProgress.model.js';
import { ModuleProgressModel } from '../Progress/moduleProgress.model.js';
import { QuizProgressModel } from '../Progress/quizProgress.model.js';
import { UserStatus } from '../../types/common.js';
import { recordAudit } from '../../models/auditLog.model.js';

/**
 * Export all personal data for a user (GDPR data portability).
 * Returns enrollments, payments, certificates, progress records.
 * Sensitive gateway fields (card numbers, CVV) are redacted.
 */
export const exportUserData = async (userId: string) => {
    const user = await UserModel.findById(userId).lean();
    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    const enrollments = await EnrollmentModel.find({ userId }).lean();
    const payments = await PaymentModel.find({ userId }).lean();
    const certificates = await CertificateModel.find({ userId }).lean();
    const lessonProgress = await LessonProgressModel.find({ userId: userId as any }).lean();
    const moduleProgress = await ModuleProgressModel.find({ userId: userId as any }).lean();
    const quizProgress = await QuizProgressModel.find({ userId: userId as any }).lean();

    // Redact sensitive payment fields
    const redactedPayments = payments.map((p) => {
        const { gatewayResponse, ...rest } = p as any;
        const redactedGateway = { ...gatewayResponse };
        delete redactedGateway.cardNumber;
        delete redactedGateway.cvv;
        delete redactedGateway.cardCvv;
        delete redactedGateway.securityCode;
        return {
            ...rest,
            gatewayResponse: redactedGateway,
        };
    });

    await recordAudit({
        actor: userId,
        actorRole: 'user',
        action: 'user.data_export',
        targetType: 'User',
        targetId: userId,
        metadata: { exportedAt: new Date() },
    });

    return {
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            address: user.address,
            role: user.role,
            status: user.status,
            emailVerified: user.emailVerified,
            studentId: user.studentId,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        },
        enrollments,
        payments: redactedPayments,
        certificates,
        lessonProgress,
        moduleProgress,
        quizProgress,
        exportedAt: new Date(),
    };
};

/**
 * Self-service account deletion (soft-delete + anonymize PII).
 * Keeps enrollments/payments/certificates linked by userId for financial records.
 */
export const deleteUserAccount = async (userId: string, actorId: string, deletionReason: string) => {
    if (!deletionReason?.trim()) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Deletion reason is required');
    }

    const user = await UserModel.findById(userId);
    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    // Soft-delete + anonymize PII
    user.deletedAt = new Date();
    user.deletedBy = actorId;
    user.deletionReason = deletionReason.trim();
    user.status = UserStatus.Deleted;
    user.email = `deleted+${user._id}@deleted.invalid`;
    user.name = 'Deleted User';
    user.phone = undefined;
    user.address = undefined;
    user.avatar = undefined;
    user.anonymizedAt = new Date();
    await user.save();

    await recordAudit({
        actor: actorId,
        actorRole: 'user',
        action: 'user.delete',
        targetType: 'User',
        targetId: userId,
        metadata: { deletionReason: user.deletionReason },
    });

    return {
        userId: user._id,
        status: user.status,
        deletedAt: user.deletedAt,
        anonymizedAt: user.anonymizedAt,
        email: user.email,
        name: user.name,
    };
};

export const PrivacyService = {
    exportUserData,
    deleteUserAccount,
};
