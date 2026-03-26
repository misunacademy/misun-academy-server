import express from 'express';
import { AdminAuthRoutes } from '../modules/Admin/admin.routes';
import { BatchRoutes } from '../modules/Batch/batch.routes';
import { PaymentRoutes } from '../modules/Payment/payment.routes';
import { DashboardRoutes } from '../modules/Dashboard/dashboard.routes';
import { CourseRoutes } from '../modules/Course/course.routes';
import { ContentRoutes } from '../modules/Content/content.routes';
// BetterAuthRoutes moved to app.ts (must be before express.json())
import { EnrollmentRoutes } from '../modules/Enrollment/enrollment.routes';
import { CourseEnrollmentRoutes } from '../modules/Enrollment/courseEnrollment.routes';
import { InstructorRoutes } from '../modules/Instructor/instructor.routes';
import { CertificateRoutes } from '../modules/Certificate/certificate.routes';
import { UploadRoutes } from '../modules/Upload/upload.routes';
import { UserRoutes } from '../modules/User/user.routes';
import { ModuleRoutes } from '../modules/Module/module.routes';
import { LessonRoutes } from '../modules/Lesson/lesson.routes';
import { RecordingRoutes } from '../modules/Recording/recording.routes';
import { ProfileRoutes } from '../modules/Profile/profile.routes';
import { SettingsRoutes } from '../modules/Settings/settings.routes';


const router = express.Router();

const moduleRoutes = [
    // Better Auth route is now mounted directly in app.ts before express.json()
    {
        path: '/admin',
        route: AdminAuthRoutes,
    },
    {
        path: '/courses',
        route: CourseRoutes,
    },
    {
        path: '/batches',
        route: BatchRoutes,
    },
    {
        path: '/content',
        route: ContentRoutes,
    },
    {
        path: '/admin/modules',
        route: ModuleRoutes,
    },
    {
        path: '/admin/lessons',
        route: LessonRoutes,
    },
    {
        path: '/recordings',
        route: RecordingRoutes,
    },
    {
        path: '/enrollments',
        route: EnrollmentRoutes,
    },
    {
        path: '/course-enrollment',
        route: CourseEnrollmentRoutes,
    },
    {
        path: '/instructor',
        route: InstructorRoutes,
    },
    {
        path: '/certificates',
        route: CertificateRoutes,
    },
    {
        path: '/payments',
        route: PaymentRoutes,
    },
    {
        path: '/dashboard',
        route: DashboardRoutes,
    },
    {
        path: '/upload',
        route: UploadRoutes,
    },
    {
        path: '/profile',
        route: ProfileRoutes,
    },
    {
        path: '/settings',
        route: SettingsRoutes,
    },
    {
        path: '/',
        route: UserRoutes,
    }
];

moduleRoutes.forEach(route => router.use(route.path, route.route));
export default router;