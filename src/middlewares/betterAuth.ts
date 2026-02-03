import { Request, Response, NextFunction } from 'express';
import { getAuth } from '../config/betterAuth';
import { StatusCodes } from 'http-status-codes';
import { Role } from '../types/role';
import { UserStatus } from '../types/common';

// Extend Express Request to include user data
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        role: Role;
        status: UserStatus;
        emailVerified: boolean;
      };
      session?: any;
    }
  }
}

/**
 * Middleware to verify Better Auth session and attach user to request
 */
export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const auth = getAuth();
    // Get session from Better Auth
    const session = await auth.api.getSession({
      headers: req.headers as any,
    });

    if (!session || !session.user) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Authentication required. Please log in.',
      });
    }

    // Check if email is verified (Better Auth uses boolean for emailVerified)
    if (!session.user.emailVerified) {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: 'Please verify your email address before accessing this resource.',
      });
    }

    // Check if account is suspended or deleted
    const status = (session.user as any).status || UserStatus.Active;
    if (status === UserStatus.Suspended) {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: 'Your account has been suspended. Please contact support.',
      });
    }

    if (status === UserStatus.Deleted) {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: 'This account no longer exists.',
      });
    }

    // Attach user and session to request
    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: (session.user as any).role || Role.LEARNER,
      status: status,
      emailVerified: session.user.emailVerified,
    };

    req.session = session;

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(StatusCodes.UNAUTHORIZED).json({
      success: false,
      message: 'Invalid or expired session.',
    });
  }
};

/**
 * Middleware to require specific role(s)
 */
export const requireRole = (...allowedRoles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(StatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message: 'You do not have permission to access this resource.',
      });
    }

    next();
  };
};

/**
 * Middleware to require ADMIN or SUPERADMIN role
 */
export const requireAdmin = requireRole(Role.ADMIN, Role.SUPERADMIN);

/**
 * Middleware to require SUPERADMIN role only
 */
export const requireSuperAdmin = requireRole(Role.SUPERADMIN);

/**
 * Middleware to require INSTRUCTOR role or higher
 */
export const requireInstructor = requireRole(
  Role.INSTRUCTOR,
  Role.ADMIN,
  Role.SUPERADMIN
);

/**
 * Optional auth middleware - attaches user if session exists, but doesn't require it
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: req.headers as any,
    });

    if (session && session.user) {
      req.user = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: (session.user as any).role || Role.LEARNER,
        status: (session.user as any).status || UserStatus.Active,
        emailVerified: session.user.emailVerified,
      };
      req.session = session;
    }

    next();
  } catch (error) {
    // Silently fail for optional auth
    next();
  }
};
