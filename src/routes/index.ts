import express from 'express';
import { AdminAuthRoutes } from '../modules/Admin/admin.routes.js';
import { BatchRoutes } from '../modules/Batch/batch.routes.js';
import { PaymentRoutes } from '../modules/Payment/payment.routes.js';
import { DashboardRoutes } from '../modules/Dashboard/dashboard.routes.js';
import { CourseRoutes } from '../modules/Course/course.routes.js';
import { ContentRoutes } from '../modules/Content/content.routes.js';
// BetterAuthRoutes moved to app.ts (must be before express.json())
import { EnrollmentRoutes } from '../modules/Enrollment/enrollment.routes.js';
import { CourseEnrollmentRoutes } from '../modules/Enrollment/courseEnrollment.routes.js';
import { InstructorRoutes } from '../modules/Instructor/instructor.routes.js';
import { CertificateRoutes } from '../modules/Certificate/certificate.routes.js';
import { UploadRoutes } from '../modules/Upload/upload.routes.js';
import { UserRoutes } from '../modules/User/user.routes.js';
import { ModuleRoutes } from '../modules/Module/module.routes.js';
import { LessonRoutes } from '../modules/Lesson/lesson.routes.js';
import { RecordingRoutes } from '../modules/Recording/recording.routes.js';
import { ProfileRoutes } from '../modules/Profile/profile.routes.js';
import { SettingsRoutes } from '../modules/Settings/settings.routes.js';


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