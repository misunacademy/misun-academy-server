import {
    sendBatchStartReminderEmail as sendMisunBatchStartReminderEmail,
    sendCompletedBatchIncompleteReminderEmail as sendMisunCompletedBatchIncompleteReminderEmail,
    sendEnrollmentConfirmationEmail as sendMisunEnrollmentConfirmationEmail,
    sendPaymentFailedEmail as sendMisunPaymentFailedEmail,
    sendPaymentReviewEmail as sendMisunPaymentReviewEmail,
    sendPaymentSuccessEmail as sendMisunPaymentSuccessEmail,
    sendRunningBatchProgressReminderEmail as sendMisunRunningBatchProgressReminderEmail,
    sendWaitingPaymentVerificationEmail as sendMisunWaitingPaymentVerificationEmail,
} from './misunAcademyEmails.js';
import {
    sendBatchStartReminderEmail as sendEsunBatchStartReminderEmail,
    sendCompletedBatchIncompleteReminderEmail as sendEsunCompletedBatchIncompleteReminderEmail,
    sendEnrollmentConfirmationEmail as sendEsunEnrollmentConfirmationEmail,
    sendPaymentFailedEmail as sendEsunPaymentFailedEmail,
    sendPaymentReviewEmail as sendEsunPaymentReviewEmail,
    sendPaymentSuccessEmail as sendEsunPaymentSuccessEmail,
    sendRunningBatchProgressReminderEmail as sendEsunRunningBatchProgressReminderEmail,
    sendWaitingPaymentVerificationEmail as sendEsunWaitingPaymentVerificationEmail,
} from './esunPointEmails.js';

interface CourseEmailContext {
    courseName?: string | null;
    courseSlug?: string | null;
}

const isEnglishCourse = (context: CourseEmailContext): boolean => {
    const searchable = `${context.courseName || ''} ${context.courseSlug || ''}`.toLowerCase();
    return /\benglish\b/.test(searchable);
};

export const sendCoursePaymentSuccessEmail = async (
    context: CourseEmailContext,
    email: string,
    name: string,
    amount: number,
    currency: string,
    courseName: string,
    transactionId: string,
    paymentMethod?: string,
) => {
    if (isEnglishCourse(context)) {
        return sendEsunPaymentSuccessEmail(email, name, amount, currency, courseName, transactionId, paymentMethod);
    }

    return sendMisunPaymentSuccessEmail(email, name, amount, currency, courseName, transactionId, paymentMethod);
};

export const sendCourseBatchStartReminderEmail = async (
    context: CourseEmailContext,
    studentEmail: string,
    studentName: string,
    batchName: string,
    startDate: string,
) => {
    if (isEnglishCourse(context)) {
        return sendEsunBatchStartReminderEmail(studentEmail, studentName, batchName, startDate);
    }

    return sendMisunBatchStartReminderEmail(studentEmail, studentName, batchName, startDate);
};

export const sendCoursePaymentReviewEmail = async (
    context: CourseEmailContext,
    student: any,
    courseName: string,
    transactionId: string,
) => {
    if (isEnglishCourse(context)) {
        return sendEsunPaymentReviewEmail(student, courseName, transactionId);
    }

    return sendMisunPaymentReviewEmail(student, courseName, transactionId);
};

export const sendCoursePaymentFailedEmail = async (
    context: CourseEmailContext,
    student: any,
    courseName: string,
    reason: string,
) => {
    if (isEnglishCourse(context)) {
        return sendEsunPaymentFailedEmail(student, courseName, reason);
    }

    return sendMisunPaymentFailedEmail(student, courseName, reason);
};

export const sendCourseEnrollmentConfirmationEmail = async (
    context: CourseEmailContext,
    user: any,
    courseName: string,
    enrollmentId: string,
    amount: number,
    paymentMethod?: string,
) => {
    if (isEnglishCourse(context)) {
        return sendEsunEnrollmentConfirmationEmail(user, courseName, enrollmentId, amount, paymentMethod);
    }

    return sendMisunEnrollmentConfirmationEmail(user, courseName, enrollmentId, amount, paymentMethod);
};

export const sendCourseWaitingPaymentVerificationEmail = async (
    context: CourseEmailContext,
    student: any,
    courseName: string,
    transactionId: string,
) => {
    if (isEnglishCourse(context)) {
        return sendEsunWaitingPaymentVerificationEmail(student, courseName, transactionId);
    }

    return sendMisunWaitingPaymentVerificationEmail(student, courseName, transactionId);
};

export const sendCourseRunningBatchProgressReminderEmail = async (
    context: CourseEmailContext,
    email: string,
    name: string,
    courseName: string,
    batchName: string,
    progress: number,
) => {
    if (isEnglishCourse(context)) {
        return sendEsunRunningBatchProgressReminderEmail(email, name, courseName, batchName, progress);
    }

    return sendMisunRunningBatchProgressReminderEmail(email, name, courseName, batchName, progress);
};

export const sendCourseCompletedBatchIncompleteReminderEmail = async (
    context: CourseEmailContext,
    email: string,
    name: string,
    courseName: string,
    batchName: string,
    progress: number,
) => {
    if (isEnglishCourse(context)) {
        return sendEsunCompletedBatchIncompleteReminderEmail(email, name, courseName, batchName, progress);
    }

    return sendMisunCompletedBatchIncompleteReminderEmail(email, name, courseName, batchName, progress);
};
