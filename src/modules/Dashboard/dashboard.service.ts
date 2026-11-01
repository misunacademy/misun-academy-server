import { PaymentModel } from "../Payment/payment.model.js";
import { EnrollmentModel } from "../Enrollment/enrollment.model.js";
import { UserModel } from "../User/user.model.js";
import { BatchModel } from "../Batch/batch.model.js";
import { CourseModel } from "../Course/course.model.js";
import { BatchStatus, CourseStatus, EnrollmentStatus, Status, UserStatus } from "../../types/common.js";
import mongoose from "mongoose";
import ApiError from "../../errors/ApiError.js";
import { StatusCodes } from "http-status-codes";

const getDashboardMetaData = async (courseId?: string) => {
    const now = new Date();
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(now.getDate() - 60);

    let filteredBatchIds: any[] | null = null;
    if (courseId) {
        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid courseId");
        }

        filteredBatchIds = await BatchModel.find({
            courseId: new mongoose.Types.ObjectId(courseId),
        }).distinct("_id");
    }

    const enrollmentMatch: any = {
        status: EnrollmentStatus.Active,
    };

    const paymentMatch: any = {
        status: "success",
    };

    if (filteredBatchIds) {
        enrollmentMatch.batchId = { $in: filteredBatchIds };
        paymentMatch.batchId = { $in: filteredBatchIds };
    }

    // 1. Total enrolled students (active enrollments)
    const totalEnrolledPromise = EnrollmentModel.countDocuments(enrollmentMatch);

    // 2. Batch-wise total enrolled students
    const batchWiseEnrolledPromise = EnrollmentModel.aggregate([
        { $match: enrollmentMatch },
        {
            $group: {
                _id: "$batchId",
                totalEnrolled: { $sum: 1 },
            },
        },
    ]);

    // 3. Total income (all time, successful payments), grouped by currency:
    // BDT and INR must never be summed into one number.
    const totalIncomePromise = PaymentModel.aggregate([
        { $match: paymentMatch },
        { $group: { _id: '$currency', totalIncome: { $sum: "$amount" } } },
    ]);

    // 4. Day-wise income & enrollment stats (last 60 days, Dhaka days —
    // UTC boundaries would split local business days at 6am)
    const dayWiseStatsPromise = PaymentModel.aggregate([
        { $match: { ...paymentMatch, createdAt: { $gte: sixtyDaysAgo } } },
        {
            $group: {
                _id: {
                    $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Dhaka" },
                },
                totalIncome: { $sum: "$amount" },
                totalEnrollment: { $sum: 1 },
            },
        },
        { $sort: { _id: 1 } },
    ]);

    // 5. Course-wise stats
    const courseWiseStatsPromise = PaymentModel.aggregate([
        { $match: paymentMatch },
        {
            $lookup: {
                from: "batches",
                localField: "batchId",
                foreignField: "_id",
                as: "batch",
            },
        },
        { $unwind: "$batch" },
        {
            $lookup: {
                from: "courses",
                localField: "batch.courseId",
                foreignField: "_id",
                as: "course",
            },
        },
        { $unwind: "$course" },
        {
            $group: {
                _id: "$course._id",
                courseTitle: { $first: "$course.title" },
                courseSlug: { $first: "$course.slug" },
                totalIncome: { $sum: "$amount" },
                totalEnrollments: { $sum: 1 },
            },
        },
        { $sort: { totalIncome: -1 } },
    ]);

    // 6. Batch-wise income
    const batchWiseIncomePromise = PaymentModel.aggregate([
        { $match: paymentMatch },
        {
            $lookup: {
                from: "batches",
                localField: "batchId",
                foreignField: "_id",
                as: "batch",
            },
        },
        { $unwind: "$batch" },
        {
            $lookup: {
                from: "courses",
                localField: "batch.courseId",
                foreignField: "_id",
                as: "course",
            },
        },
        {
            $unwind: {
                path: "$course",
                preserveNullAndEmptyArrays: true,
            },
        },
        {
            $group: {
                _id: "$batch._id",
                batchTitle: { $first: "$batch.title" },
                courseTitle: { $first: "$course.title" },
                batchNumber: {
                    $first: {
                        $concat: ["Batch #", { $toString: "$batch.batchNumber" }]
                    }
                },
                totalIncome: { $sum: "$amount" },
                totalEnrollments: { $sum: 1 },
            },
        },
        { $sort: { totalIncome: -1 } },
    ]);

    const [
        totalEnrolled,
        batchWiseEnrolled,
        totalIncomeResult,
        dayWiseStats,
        courseWiseStats,
        batchWiseIncome
    ] = await Promise.all([
        totalEnrolledPromise,
        batchWiseEnrolledPromise,
        totalIncomePromise,
        dayWiseStatsPromise,
        courseWiseStatsPromise,
        batchWiseIncomePromise,
    ]);

    return {
        totalEnrolled: totalEnrolled,
        batchWiseEnrolled: batchWiseEnrolled.map((b: any) => ({
            batchId: b._id,
            totalEnrolled: b.totalEnrolled,
        })),
        // Per-currency ledger (never sum across currencies downstream).
        // NOTE: legacy `totalIncome` below is a mixed-currency sum kept for
        // UI compatibility — migrate displays to totalIncomeByCurrency.
        totalIncomeByCurrency: (totalIncomeResult as any[]).map((r: any) => ({
            currency: r._id || 'BDT',
            totalIncome: r.totalIncome,
        })),
        totalIncome: (totalIncomeResult as any[]).reduce((s: number, r: any) => s + (r.totalIncome || 0), 0),
        dayWiseStats: dayWiseStats.map((d: any) => ({
            date: d._id,
            totalIncome: d.totalIncome,
            totalEnrollment: d.totalEnrollment,
        })),
        courseWiseStats: courseWiseStats.map((c: any) => ({
            courseId: c._id,
            courseTitle: c.courseTitle,
            courseSlug: c.courseSlug,
            totalIncome: c.totalIncome,
            totalEnrollments: c.totalEnrollments,
        })),
        batchWiseIncome: batchWiseIncome.map((b: any) => ({
            batchId: b._id,
            batchTitle: b.batchTitle,
            courseTitle: b.courseTitle,
            batchNumber: b.batchNumber,
            totalIncome: b.totalIncome,
            totalEnrollments: b.totalEnrollments,
        })),
    };
};

/**
 * Get admin dashboard analytics
 */
const getAdminDashboard = async () => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Overview stats
    const totalUsers = await UserModel.countDocuments();
    const totalCourses = await CourseModel.countDocuments({ status: CourseStatus.Published });
    const totalBatches = await BatchModel.countDocuments();
    const activeEnrollments = await EnrollmentModel.countDocuments({
        status: EnrollmentStatus.Active
    });

    // Revenue stats (last 30 days), grouped by currency.
    const revenueData = await PaymentModel.aggregate([
        {
            $match: {
                status: Status.Success,
                createdAt: { $gte: thirtyDaysAgo }
            }
        },
        {
            $group: {
                _id: '$currency',
                totalRevenue: { $sum: '$amount' },
                totalTransactions: { $sum: 1 }
            }
        }
    ]);

    const revenueByCurrency = revenueData.map((r: any) => ({
        currency: r._id || 'BDT',
        totalRevenue: r.totalRevenue,
        totalTransactions: r.totalTransactions,
    }));
    // Legacy mixed-currency rollup (UI compat) — prefer revenueByCurrency.
    const revenue = {
        totalRevenue: revenueByCurrency.reduce((s, r) => s + r.totalRevenue, 0),
        totalTransactions: revenueByCurrency.reduce((s, r) => s + r.totalTransactions, 0),
    };

    // Enrollment trends (last 30 days, Dhaka days)
    const enrollmentTrends = await EnrollmentModel.aggregate([
        {
            $match: {
                createdAt: { $gte: thirtyDaysAgo }
            }
        },
        {
            $group: {
                _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Dhaka' }
                },
                count: { $sum: 1 }
            }
        },
        { $sort: { _id: 1 } }
    ]);

    // Top batches by enrollment
    const topBatches = await BatchModel.find()
        .sort({ currentEnrollment: -1 })
        .limit(5)
        .populate('courseId', 'title')
        .lean();

    // Recent enrollments
    const recentEnrollments = await EnrollmentModel.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('userId', 'name email')
        .populate({
            path: 'batchId',
            populate: { path: 'courseId', select: 'title' }
        })
        .lean();

    return {
        overview: {
            totalUsers,
            totalCourses,
            totalBatches,
            activeEnrollments,
            totalRevenue: revenue.totalRevenue,
            totalTransactions: revenue.totalTransactions,
            revenueByCurrency,
        },
        enrollmentTrends,
        topBatches,
        recentEnrollments,
    };
};

/**
 * Get user management data
 */
const getUserStats = async () => {
    const totalUsers = await UserModel.countDocuments();
    const activeUsers = await UserModel.countDocuments({ status: UserStatus.Active });
    const suspendedUsers = await UserModel.countDocuments({ status: UserStatus.Suspended });

    const usersByRole = await UserModel.aggregate([
        {
            $group: {
                _id: '$role',
                count: { $sum: 1 }
            }
        }
    ]);

    return {
        totalUsers,
        activeUsers,
        suspendedUsers,
        usersByRole,
    };
};


/**
 * Get student dashboard data
 */
const getStudentDashboard = async (userId: string) => {
    // Get student's enrollments (active and completed courses should remain accessible lifetime)
    const enrollments = await EnrollmentModel.find({
        userId,
        status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] }
    })
        .populate({
            path: 'batchId',
            populate: { path: 'courseId', select: 'title slug thumbnailImage' }
        })
        .sort({ createdAt: -1 })
        .lean();

    const enrolledCoursesCount = enrollments.length;

    // Count completed courses (status could be 'Completed' if you have that)
    const completedCoursesCount = await EnrollmentModel.countDocuments({
        userId,
        status: EnrollmentStatus.Completed
    });

    // Get upcoming classes (running batches)
    const upcomingClasses = await BatchModel.countDocuments({
        _id: { $in: enrollments.map(e => e.batchId) },
        status: BatchStatus.Running
    });

    // Format enrolled courses
    const enrolledCourses = enrollments.map((enrollment: any) => ({
        id: enrollment._id,
        courseId: enrollment.batchId?.courseId?._id || enrollment.batchId?.courseId,
        batchId: enrollment.batchId?._id,
        courseTitle: enrollment.batchId?.courseId?.title || 'Unknown Course',
        courseSlug: enrollment.batchId?.courseId?.slug || '',
        thumbnailImage: enrollment.batchId?.courseId?.thumbnailImage || '',
        shortDescription: enrollment.batchId?.courseId?.shortDescription || '',
        instructor: enrollment.batchId?.courseId?.instructor || null,
        batchTitle: enrollment.batchId?.title || 'Unknown Batch',
        isCertificateAvailable: enrollment.batchId?.courseId?.isCertificateAvailable ?? true,
        accessType: enrollment.accessType || 'standard',
        batchNumber: enrollment.batchId?.batchNumber || '',
        enrolledAt: enrollment.createdAt,
        status: enrollment.status,
    }));

    // Get recent activity (recent enrollments)
    const recentActivity = enrollments.slice(0, 5).map((enrollment: any) => ({
        id: enrollment._id,
        action: 'Enrolled in course',
        batch: enrollment.batchId?.title || 'Unknown Batch',
        date: enrollment.createdAt,
        status: enrollment.status,
    }));

    return {
        enrolledCoursesCount,
        completedCoursesCount,
        upcomingClasses,
        enrolledCourses,
        recentActivity,
    };
};


const getInstructorDashboard = async (userId: string) => {

    // An instructor may own several courses — aggregate across all of them.
    const courses = await CourseModel.find({ instructorId: userId })
        .populate('instructorId', 'name email image')
        .lean();

    if (courses.length === 0) {
        return { courses: [], course: null, enrolledStudents: 0, activeBatches: 0, totalBatches: 0 };
    }

    const courseIds = courses.map((c: any) => c._id);

    // Get all batch IDs for these courses
    const batchIds = await BatchModel.find({ courseId: { $in: courseIds } }).distinct('_id');

    // Count enrolled students (Active + Completed graduates) + batches.
    const [enrolledStudents, totalBatches, activeBatches] = await Promise.all([
        EnrollmentModel.countDocuments({
            batchId: { $in: batchIds },
            status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
        }),
        BatchModel.countDocuments({ courseId: { $in: courseIds } }),
        BatchModel.countDocuments({ courseId: { $in: courseIds }, status: BatchStatus.Running }),
    ]);

    // `course` kept for backward compatibility (first course); prefer `courses`.
    return { courses, course: courses[0], enrolledStudents, activeBatches, totalBatches };
};

export const DashboardService = {
    getDashboardMetaData,
    getAdminDashboard,
    getUserStats,
    getStudentDashboard,
    getInstructorDashboard,
}
