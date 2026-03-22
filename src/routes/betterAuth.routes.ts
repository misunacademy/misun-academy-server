import { Router, Request, Response } from 'express';
import { getAuth } from '../config/betterAuth';
import { dynamicImport } from '../utils/dynamicImport';
import { EnrollmentModel } from '../modules/Enrollment/enrollment.model';
import { EnrollmentStatus } from '../types/common';

const router = Router();

router.get('/me', async (req: Request, res: Response) => {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: req.headers as any,
    });

    if (!session?.user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthenticated',
      });
    }

    const enrollments = await EnrollmentModel.find({
      userId: session.user.id,
      status: { $in: [EnrollmentStatus.Active, EnrollmentStatus.Completed] },
    })
      .populate({
        path: 'batchId',
        select: 'courseId title',
        populate: {
          path: 'courseId',
          select: 'title slug',
        },
      })
      .lean();

    const enrolledCourses = enrollments
      .map((enrollment: any) => {
        const course = enrollment?.batchId?.courseId;
        if (!course?._id) return null;
        return {
          id: String(course._id),
          slug: course.slug || '',
          title: course.title || '',
        };
      })
      .filter(Boolean);

    return res.status(200).json({
      success: true,
      data: {
        user: {
          ...session.user,
          enrolledCourses,
        },
      },
    });
  } catch (error) {
    console.error('GET /auth/me error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch authenticated user',
    });
  }
});

// Mount Better Auth handler for all auth-related routes
// This handles: /sign-up, /sign-in, /sign-out, /session, /callback/*, etc.
router.all('*', async (req: Request, res: Response) => {
  try {
    const auth = getAuth();
    // Dynamically import ESM-only package to avoid ERR_REQUIRE_ESM in CJS build
    const { toNodeHandler } = await dynamicImport('better-auth/node');
    const handler = toNodeHandler(auth);
    return handler(req, res);
  } catch (error) {
    console.error('Better Auth route error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication service not initialized',
    });
  }
});

export default router;
