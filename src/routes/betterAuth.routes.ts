import express, { Router, Request, Response } from 'express';
import { getAuth } from '../config/betterAuth.js';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { EnrollmentModel } from '../modules/Enrollment/enrollment.model.js';
import { EnrollmentStatus } from '../types/common.js';
import { logger } from '../config/logger.js';
import env from '../config/env.js';
import ApiError from '../errors/ApiError.js';
import { StatusCodes } from 'http-status-codes';

const router = Router();

// Better Auth must remain mounted before app-level body parsers.
// Parse JSON only for custom server action routes.
router.use('/server', express.json(), express.urlencoded({ extended: true }));

// Redirect targets (callbackURL/redirectTo/errorCallbackURL/...) flow into
// OAuth providers and post-login navigation. An attacker-supplied absolute
// URL would leak auth codes / bounce victims to phishing. Allow same-app
// relative paths and the configured frontend origins only.
const TRUSTED_REDIRECT_ORIGINS = [
    env.MA_FRONTEND_URL,
    env.EP_FRONTEND_URL,
    env.CLIENT_URL,
    'http://localhost:3000',
    'http://localhost:3001',
]
    .filter((s): s is string => Boolean(s))
    .map((s) => {
        try {
            const u = new URL(s);
            return `${u.protocol}//${u.host}`.toLowerCase();
        } catch {
            return null;
        }
    })
    .filter((s): s is string => Boolean(s));

const assertTrustedRedirect = (value: unknown, field: string): string | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') {
        throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid ${field}`);
    }
    if (value.startsWith('/') && !value.startsWith('//')) return value;
    try {
        const u = new URL(value);
        if (!['http:', 'https:'].includes(u.protocol)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid ${field}`);
        }
        const origin = `${u.protocol}//${u.host}`.toLowerCase();
        if (!TRUSTED_REDIRECT_ORIGINS.includes(origin)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid ${field}`);
        }
        return value;
    } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid ${field}`);
    }
};

// PATCH /server/update-user allowlist: better-auth marks role/status
// input:false, but never forward raw bodies to the auth layer — a future
// field/config slip would become a self-promotion primitive.
const UPDATE_USER_ALLOWED_KEYS = ['name', 'image', 'phone', 'address', 'avatar'] as const;

const pickUpdateUserBody = (body: any): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (!body || typeof body !== 'object') return out;
    for (const key of UPDATE_USER_ALLOWED_KEYS) {
        const value = (body as Record<string, unknown>)[key];
        if (value === undefined) continue;
        if (key === 'name' && (typeof value !== 'string' || value.length > 200)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid name');
        }
        if ((key === 'image' || key === 'avatar') && (typeof value !== 'string' || value.length > 2048)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid ${key}`);
        }
        if ((key === 'phone' || key === 'address') && (typeof value !== 'string' || value.length > 500)) {
            throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid ${key}`);
        }
        out[key] = value;
    }
    return out;
};



const buildAuthContext = async (req: Request) => {
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
    logger.error(error, `Better Auth server action error (${actionName})`);
    return res.status(500).json({
      success: false,
      message: `Authentication action failed: ${actionName}`,
    });
  }
};

router.post('/server/sign-in/email', async (req: Request, res: Response) => {
  const auth = getAuth();
  const callbackURL = assertTrustedRedirect(req.body?.callbackURL, 'callbackURL');
  return runAuthAction(res, 'signInEmail', async () =>
    auth.api.signInEmail({
      ...(await buildAuthContext(req)),
      body: {
        email: req.body?.email,
        password: req.body?.password,
        callbackURL,
        rememberMe: req.body?.rememberMe,
      },
    })
  );
});

router.post('/server/sign-in/social', async (req: Request, res: Response) => {
  const auth = getAuth();
  const callbackURL = assertTrustedRedirect(req.body?.callbackURL, 'callbackURL');
  const errorCallbackURL = assertTrustedRedirect(req.body?.errorCallbackURL, 'errorCallbackURL');
  const newUserCallbackURL = assertTrustedRedirect(req.body?.newUserCallbackURL, 'newUserCallbackURL');
  return runAuthAction(res, 'signInSocial', async () =>
    auth.api.signInSocial({
      ...(await buildAuthContext(req)),
      body: {
        provider: req.body?.provider,
        callbackURL,
        errorCallbackURL,
        newUserCallbackURL,
        // We redirect manually on the client after receiving provider URL.
        disableRedirect: true,
      },
    })
  );
});

router.post('/server/sign-up/email', async (req: Request, res: Response) => {
  const auth = getAuth();
  const callbackURL = assertTrustedRedirect(req.body?.callbackURL, 'callbackURL');
  // Terms consent is legal evidence: the client gates the checkbox, but
  // Enter-key submits and raw API calls bypass it — enforce server-side.
  if (req.body?.agreedToTerms !== true) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'You must accept the Terms & Conditions to create an account');
  }
  return runAuthAction(res, 'signUpEmail', async () =>
    auth.api.signUpEmail({
      ...(await buildAuthContext(req)),
      body: {
        email: req.body?.email,
        password: req.body?.password,
        name: req.body?.name,
        image: req.body?.image,
        callbackURL,
        agreedToTerms: true,
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
  const redirectTo = assertTrustedRedirect(req.body?.redirectTo, 'redirectTo');
  return runAuthAction(res, 'requestPasswordReset', async () =>
    auth.api.requestPasswordReset({
      ...(await buildAuthContext(req)),
      body: {
        email: req.body?.email,
        redirectTo,
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
  const body = pickUpdateUserBody(req.body);
  return runAuthAction(res, 'updateUser', async () =>
    auth.api.updateUser({
      ...(await buildAuthContext(req)),
      body,
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
    logger.error(error, 'GET /auth/me error');
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch authenticated user',
    });
  }
});

export const betterAuthCatchAll = async (req: Request, res: Response) => {
  try {
    const handler = toNodeHandler(getAuth());
    return handler(req, res);
  } catch (error) {
    logger.error(error, 'Better Auth route error');
    return res.status(500).json({
      success: false,
      message: 'Authentication service not initialized',
    });
  }
};

export default router;
