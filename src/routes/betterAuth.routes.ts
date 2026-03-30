import express, { Router, Request, Response } from 'express';
import { getAuth } from '../config/betterAuth';
import { dynamicImport } from '../utils/dynamicImport';
import { EnrollmentModel } from '../modules/Enrollment/enrollment.model';
import { EnrollmentStatus } from '../types/common';

const router = Router();

// Better Auth must remain mounted before app-level body parsers.
// Parse JSON only for custom server action routes.
router.use('/server', express.json(), express.urlencoded({ extended: true }));

let cachedBetterAuthHandler: ((req: Request, res: Response) => unknown) | null = null;

const getFromNodeHeaders = async () => {
  const { fromNodeHeaders } = await dynamicImport('better-auth/node');
  return fromNodeHeaders as (headers: any) => Headers;
};

const buildAuthContext = async (req: Request) => {
  const fromNodeHeaders = await getFromNodeHeaders();
  return {
    headers: fromNodeHeaders(req.headers as any),
    asResponse: true as const,
  };
};

const forwardBetterAuthResponse = async (res: Response, response: globalThis.Response) => {
  const headers = response.headers as any;
  const setCookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];

  if (Array.isArray(setCookies) && setCookies.length > 0) {
    res.setHeader('set-cookie', setCookies);
  }

  response.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === 'set-cookie' ||
      lowerKey === 'content-length' ||
      lowerKey === 'transfer-encoding' ||
      lowerKey === 'connection'
    ) {
      return;
    }
    res.setHeader(key, value);
  });

  res.status(response.status);

  const bodyText = await response.text();
  if (!bodyText) {
    return res.end();
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return res.json(JSON.parse(bodyText));
    } catch {
      return res.send(bodyText);
    }
  }

  return res.send(bodyText);
};

const runAuthAction = async (
  res: Response,
  actionName: string,
  action: () => Promise<globalThis.Response>
) => {
  try {
    const response = await action();
    return await forwardBetterAuthResponse(res, response);
  } catch (error) {
    console.error(`Better Auth server action error (${actionName}):`, error);
    return res.status(500).json({
      success: false,
      message: `Authentication action failed: ${actionName}`,
    });
  }
};

router.post('/server/sign-in/email', async (req: Request, res: Response) => {
  const auth = getAuth();
  return runAuthAction(res, 'signInEmail', async () =>
    auth.api.signInEmail({
      ...(await buildAuthContext(req)),
      body: {
        email: req.body?.email,
        password: req.body?.password,
        callbackURL: req.body?.callbackURL,
        rememberMe: req.body?.rememberMe,
      },
    })
  );
});

router.post('/server/sign-in/social', async (req: Request, res: Response) => {
  const auth = getAuth();
  return runAuthAction(res, 'signInSocial', async () =>
    auth.api.signInSocial({
      ...(await buildAuthContext(req)),
      body: {
        provider: req.body?.provider,
        callbackURL: req.body?.callbackURL,
        errorCallbackURL: req.body?.errorCallbackURL,
        newUserCallbackURL: req.body?.newUserCallbackURL,
        // We redirect manually on the client after receiving provider URL.
        disableRedirect: true,
      },
    })
  );
});

router.post('/server/sign-up/email', async (req: Request, res: Response) => {
  const auth = getAuth();
  return runAuthAction(res, 'signUpEmail', async () =>
    auth.api.signUpEmail({
      ...(await buildAuthContext(req)),
      body: {
        email: req.body?.email,
        password: req.body?.password,
        name: req.body?.name,
        image: req.body?.image,
        callbackURL: req.body?.callbackURL,
      },
    })
  );
});

router.post('/server/sign-out', async (req: Request, res: Response) => {
  const auth = getAuth();
  return runAuthAction(res, 'signOut', async () =>
    auth.api.signOut({
      ...(await buildAuthContext(req)),
      body: req.body,
    })
  );
});

router.post('/server/request-password-reset', async (req: Request, res: Response) => {
  const auth = getAuth();
  return runAuthAction(res, 'requestPasswordReset', async () =>
    auth.api.requestPasswordReset({
      ...(await buildAuthContext(req)),
      body: {
        email: req.body?.email,
        redirectTo: req.body?.redirectTo,
      },
    })
  );
});

router.post('/server/reset-password', async (req: Request, res: Response) => {
  const auth = getAuth();
  return runAuthAction(res, 'resetPassword', async () =>
    auth.api.resetPassword({
      ...(await buildAuthContext(req)),
      body: {
        newPassword: req.body?.newPassword,
        token: req.body?.token,
      },
    })
  );
});

router.get('/server/verify-email', async (req: Request, res: Response) => {
  const auth = getAuth();
  return runAuthAction(res, 'verifyEmail', async () =>
    auth.api.verifyEmail({
      ...(await buildAuthContext(req)),
      query: {
        token: req.query?.token,
      },
    })
  );
});

router.post('/server/change-password', async (req: Request, res: Response) => {
  const auth = getAuth();
  return runAuthAction(res, 'changePassword', async () =>
    auth.api.changePassword({
      ...(await buildAuthContext(req)),
      body: {
        currentPassword: req.body?.currentPassword,
        newPassword: req.body?.newPassword,
        revokeOtherSessions: req.body?.revokeOtherSessions,
      },
    })
  );
});

router.patch('/server/update-user', async (req: Request, res: Response) => {
  const auth = getAuth();
  return runAuthAction(res, 'updateUser', async () =>
    auth.api.updateUser({
      ...(await buildAuthContext(req)),
      body: req.body,
    })
  );
});

router.get('/server/list-sessions', async (req: Request, res: Response) => {
  const auth = getAuth();
  return runAuthAction(res, 'listSessions', async () =>
    auth.api.listSessions({
      ...(await buildAuthContext(req)),
    })
  );
});

router.post('/server/revoke-session', async (req: Request, res: Response) => {
  const auth = getAuth();
  return runAuthAction(res, 'revokeSession', async () =>
    auth.api.revokeSession({
      ...(await buildAuthContext(req)),
      body: {
        token: req.body?.token,
      },
    })
  );
});

router.get('/me', async (req: Request, res: Response) => {
  try {
    const auth = getAuth();
    const fromNodeHeaders = await getFromNodeHeaders();
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers as any),
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

// App-level catch-all handler for Better Auth endpoints.
// Keep this outside router mounting to preserve full request path.
export const betterAuthCatchAll = async (req: Request, res: Response) => {
  try {
    if (!cachedBetterAuthHandler) {
      const auth = getAuth();
      // Dynamically import ESM-only package to avoid ERR_REQUIRE_ESM in CJS build
      const { toNodeHandler } = await dynamicImport('better-auth/node');
      cachedBetterAuthHandler = toNodeHandler(auth);
    }

    const handler = cachedBetterAuthHandler;
    if (!handler) {
      throw new Error('Better Auth handler is unavailable');
    }

    return handler(req, res);
  } catch (error) {
    console.error('Better Auth route error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication service not initialized',
    });
  }
};

export default router;
