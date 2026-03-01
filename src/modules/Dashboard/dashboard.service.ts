import { PaymentModel } from "../Payment/payment.model";
import { EnrollmentModel } from "../Enrollment/enrollment.model";
import { UserModel } from "../User/user.model";
import { BatchModel } from "../Batch/batch.model";
import { CourseModel } from "../Course/course.model";
import { EnrollmentStatus } from "../../types/common";

const getDashboardMetaData = async () => {
    const now = new Date();
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(now.getDate() - 60);

    // 1. Total enrolled students (active enrollments)
    const totalEnrolledPromise = EnrollmentModel.countDocuments({
        status: EnrollmentStatus.Active,
    });

    // 2. Batch-wise total enrolled students
    const batchWiseEnrolledPromise = EnrollmentModel.aggregate([
        { $match: { status: EnrollmentStatus.Active } },
        {
            $group: {
                _id: "$batchId",
                totalEnrolled: { $sum: 1 },
            },
        },
    ]);

    // 3. Total income (all time, successful payments)
    const totalIncomePromise = PaymentModel.aggregate([
        { $match: { status: "success" } },
        { $group: { _id: null, totalIncome: { $sum: "$amount" } } },
    ]);

    // 4. Day-wise income & enrollment stats (last 60 days)
    const dayWiseStatsPromise = PaymentModel.aggregate([
        { $match: { status: "success", createdAt: { $gte: sixtyDaysAgo } } },
        {
            $group: {
                _id: {
                    $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
                },
                totalIncome: { $sum: "$amount" },
                totalEnrollment: { $sum: 1 },
            },
        },
        { $sort: { _id: 1 } },
    ]);

    // 5. Course-wise stats
    const courseWiseStatsPromise = PaymentModel.aggregate([
        { $match: { status: "success" } },
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
        { $match: { status: "success" } },
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
            $group: {
                _id: "$batch._id",
                batchTitle: { $first: "$batch.title" },
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
        totalIncome: totalIncomeResult[0]?.totalIncome || 0,
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
    const totalCourses = await CourseModel.countDocuments({ status: 'Published' });
    const totalBatches = await BatchModel.countDocuments();
    const activeEnrollments = await EnrollmentModel.countDocuments({
        status: EnrollmentStatus.Active
    });

    // Revenue stats (last 30 days)
    const revenueData = await PaymentModel.aggregate([
        {
            $match: {
                status: 'Success',
                createdAt: { $gte: thirtyDaysAgo }
            }
        },
        {
            $group: {
                _id: null,
                totalRevenue: { $sum: '$amount' },
                totalTransactions: { $sum: 1 }
            }
        }
    ]);

    const revenue = revenueData[0] || { totalRevenue: 0, totalTransactions: 0 };

    // Enrollment trends (last 30 days)
    const enrollmentTrends = await EnrollmentModel.aggregate([
        {
            $match: {
                createdAt: { $gte: thirtyDaysAgo }
            }
        },
        {
            $group: {
                _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
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
        .populate('courseId', 'title');

    // Recent enrollments
    const recentEnrollments = await EnrollmentModel.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('userId', 'name email')
        .populate({
            path: 'batchId',
            populate: { path: 'courseId', select: 'title' }
        });

    return {
        overview: {
            totalUsers,
            totalCourses,
            totalBatches,
            activeEnrollments,
            totalRevenue: revenue.totalRevenue,
            totalTransactions: revenue.totalTransactions,
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
    const activeUsers = await UserModel.countDocuments({ status: 'Active' });
    const suspendedUsers = await UserModel.countDocuments({ status: 'Suspended' });

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
    // Get student's enrollments
    const enrollments = await EnrollmentModel.find({
        userId,
        status: EnrollmentStatus.Active
    })
        .populate({
            path: 'batchId',
            populate: { path: 'courseId', select: 'title slug' }
        })
        .sort({ createdAt: -1 });

    const enrolledCoursesCount = enrollments.length;

    // Count completed courses (status could be 'Completed' if you have that)
    const completedCoursesCount = await EnrollmentModel.countDocuments({
        userId,
        status: EnrollmentStatus.Completed
    });

    // Get upcoming classes (active batches)
    const upcomingClasses = await BatchModel.countDocuments({
        _id: { $in: enrollments.map(e => e.batchId) },
        status: 'Active'
    });

    // Format enrolled courses
    const enrolledCourses = enrollments.map((enrollment: any) => ({
        id: enrollment._id,
        courseId: enrollment.batchId?.courseId?._id || enrollment.batchId?.courseId,
        courseTitle: enrollment.batchId?.courseId?.title || 'Unknown Course',
        courseSlug: enrollment.batchId?.courseId?.slug || '',
        shortDescription: enrollment.batchId?.courseId?.shortDescription || '',
        instructor: enrollment.batchId?.courseId?.instructor || null,
        batchTitle: enrollment.batchId?.title || 'Unknown Batch',
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


/**
 * Get employee dashboard data
 */
const getEmployeeDashboard = async (userId: string) => {
    const { SalaryModel } = await import('../Employee/salary.model');
    const { LeaveRequestModel } = await import('../Employee/leaveRequest.model');

    const totalSalaryPaid = await SalaryModel.aggregate([
        { $match: { employeeId: userId, status: 'Paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    const pendingLeaveCount = await LeaveRequestModel.countDocuments({
        employeeId: userId,
        status: 'Pending',
    });

    const approvedLeaveCount = await LeaveRequestModel.countDocuments({
        employeeId: userId,
        status: 'Approved',
    });

    const recentSalaries = await SalaryModel.find({ employeeId: userId })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

    return {
        totalSalaryPaid: totalSalaryPaid[0]?.total ?? 0,
        pendingLeaveCount,
        approvedLeaveCount,
        recentSalaries,
    };
};

export const DashboardService = {
    getDashboardMetaData,
    getAdminDashboard,
    getUserStats,
    getStudentDashboard,
    getEmployeeDashboard,
}
