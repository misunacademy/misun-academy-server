import { ModuleProgressModel } from '../Progress/moduleProgress.model.js';
import { ModuleModel } from '../Module/module.model.js';
import { BatchModel } from '../Batch/batch.model.js';
import { EnrollmentModel } from './enrollment.model.js';
import { ProgressStatus, EnrollmentStatus } from '../../types/common.js';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';

export const initializeModuleProgress = async (enrollmentId: string) => {
    const enrollment = await EnrollmentModel.findById(enrollmentId).lean();
    if (!enrollment) return null;

    const batchPopulated = await BatchModel.findById(enrollment.batchId).populate('courseId').lean();
    if (!batchPopulated) return null;

    const courseId = (batchPopulated as any).courseId?._id;
    if (!courseId) return null;

    const existing = await ModuleProgressModel.findOne({ enrollmentId }).lean();
    if (existing) return existing;

    const modules = await ModuleModel.find({ courseId, batchId: enrollment.batchId }).sort({ orderIndex: 1 }).lean();
    if (modules.length === 0) return null;

    const progressEntries = modules.map((module: any, index: number) => ({
        enrollmentId,
        moduleId: module._id,
        status: index === 0 ? ProgressStatus.Unlocked : ProgressStatus.Locked,
        unlockedAt: index === 0 ? new Date() : undefined,
        completionPercentage: 0,
    }));

    return ModuleProgressModel.insertMany(progressEntries);
};

export const getUserEnrollments = async (userId: string, status?: EnrollmentStatus) => {
    const query: any = { userId };
    if (status) query.status = status;

    const enrollments = await EnrollmentModel.find(query)
        .populate({
            path: 'batchId',
            populate: { path: 'courseId', select: 'title thumbnailImage category level isCertificateAvailable' },
        })
        .sort({ createdAt: -1 })
        .lean();

    const enrollmentIds = enrollments.map((e: any) => e._id);
    const allModuleProgress = await ModuleProgressModel.find({ enrollmentId: { $in: enrollmentIds } }).lean();
    const progressByEnrollment: Record<string, any[]> = {};
    for (const mp of allModuleProgress as any[]) {
        const key = mp.enrollmentId?.toString();
        if (key) {
            if (!progressByEnrollment[key]) progressByEnrollment[key] = [];
            progressByEnrollment[key].push(mp);
        }
    }

    const batchCoursePairs: Record<string, { courseId: string; batchId: string }> = {};
    for (const enrollment of enrollments as any[]) {
        const resolvedBatchId = enrollment.batchId?._id ?? enrollment.batchId;
        const resolvedCourseId = enrollment.batchId?.courseId?._id ?? enrollment.batchId?.courseId;
        const key = `${resolvedCourseId}_${resolvedBatchId}`;
        if (resolvedCourseId && resolvedBatchId && !batchCoursePairs[key]) {
            batchCoursePairs[key] = { courseId: resolvedCourseId, batchId: resolvedBatchId };
        }
    }

    const pairValues = Object.values(batchCoursePairs);
    const allModules = pairValues.length > 0
        ? await ModuleModel.find({ $or: pairValues.map((p) => ({ courseId: p.courseId, batchId: p.batchId })) }).lean()
        : [];
    const modulesByPair: Record<string, any[]> = {};
    for (const mod of allModules as any[]) {
        const key = `${mod.courseId?.toString()}_${mod.batchId?.toString()}`;
        if (key) {
            if (!modulesByPair[key]) modulesByPair[key] = [];
            modulesByPair[key].push(mod);
        }
    }

    return (enrollments as any[]).map((enrollment) => {
        const key = enrollment._id?.toString();
        const moduleProgress = key ? progressByEnrollment[key] || [] : [];
        const resolvedBatchId = enrollment.batchId?._id ?? enrollment.batchId;
        const resolvedCourseId = enrollment.batchId?.courseId?._id ?? enrollment.batchId?.courseId;
        const pairKey = `${resolvedCourseId}_${resolvedBatchId}`;
        const modules = modulesByPair[pairKey] || [];

        const totalModules = modules.length;
        const completedModules = moduleProgress.filter((p: any) => p.status === ProgressStatus.Completed).length;
        const overallProgress = totalModules > 0 ? Math.round((moduleProgress.reduce((sum: number, m: any) => sum + m.completionPercentage, 0) / totalModules)) : 0;

        return {
            ...enrollment,
            isCertificateAvailable: enrollment.batchId?.courseId?.isCertificateAvailable !== undefined
                ? enrollment.batchId.courseId.isCertificateAvailable
                : true,
            progress: { totalModules, completedModules, overallProgress },
        };
    });
};

export const getEnrollmentDetails = async (enrollmentId: string, userId: string) => {
    const enrollment = await EnrollmentModel.findOne({ _id: enrollmentId, userId })
        .populate({
            path: 'batchId',
            populate: [
                { path: 'courseId', select: 'title slug thumbnailImage description' },
                { path: 'instructors', populate: 'userId' },
            ],
        })
        .populate('userId', 'name email phone')
        .lean();

    if (!enrollment) throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');

    const resolvedBatchId = (enrollment as any).batchId?._id ?? (enrollment as any).batchId;
    const resolvedCourseId = (enrollment as any).batchId?.courseId?._id ?? (enrollment as any).batchId?.courseId;
    const modules = await ModuleModel.find({ courseId: resolvedCourseId, batchId: resolvedBatchId }).sort({ orderIndex: 1 }).lean();
    const moduleProgress = await ModuleProgressModel.find({ enrollmentId }).lean();

    const moduleProgressMap = new Map((moduleProgress as any[]).map((mp) => [mp.moduleId?.toString(), mp]));
    const totalModules = modules.length;
    const completedModules = moduleProgress.filter((m: any) => m.status === ProgressStatus.Completed).length;
    const overallProgress = totalModules > 0 ? Math.round((moduleProgress.reduce((sum: number, m: any) => sum + m.completionPercentage, 0) / totalModules)) : 0;

    return {
        ...(enrollment as any),
        progress: { totalModules, completedModules, overallProgress },
        modules: modules.map((module: any) => ({
            ...module,
            progress: moduleProgressMap.get(module._id?.toString()) || null,
        })),
    };
};
