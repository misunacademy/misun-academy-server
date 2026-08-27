import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const COOKIE_NAME = 'XSRF-TOKEN';
const TOKEN_LENGTH = 32;

function generateToken(): string {
  return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
}

function getSharedDomain(hostname: string): string | undefined {
  const parts = hostname.split('.');
  if (parts.length < 3) return undefined;
  return '.' + parts.slice(-3).join('.');
}

const getTrustedOrigins = (): string[] => {
  return [
    process.env.MA_FRONTEND_URL,
    process.env.EP_FRONTEND_URL,
    process.env.CLIENT_URL,
    'http://localhost:3000',
    'http://localhost:3001',
  ].filter((s): s is string => Boolean(s));
};

function isTrustedOrigin(origin: string): boolean {
  const trusted = getTrustedOrigins();
  return trusted.some((to) => {
    const normalized = to.replace(/\/+$/, '');
    return origin === normalized || origin.startsWith(normalized + '/');
  });
}

function setCsrfCookie(req: Request, res: Response): void {
  if (req.cookies?.[COOKIE_NAME]) return;

  const token = generateToken();
  const sharedDomain = getSharedDomain(req.hostname);

  res.cookie(COOKIE_NAME, token, {
    httpOnly: false,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(sharedDomain ? { domain: sharedDomain } : {}),
  });
}

const CSRF_EXEMPT_PATHS = [
  '/payments/status',
  '/payments/webhook',
];

export const csrfProtection = (req: Request, res: Response, next: NextFunction) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    setCsrfCookie(req, res);
    return next();
  }

  if (CSRF_EXEMPT_PATHS.some((p) => req.path.startsWith(p))) {
    return next();
  }

  const existingCookie = req.cookies?.[COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'] as string | undefined;

  // Double-submit cookie pattern (works when client can read the cookie via JS)
  if (existingCookie && headerToken) {
    if (headerToken === existingCookie) {
      return next();
    }
    return res.status(403).json({
      success: false,
      message: 'CSRF protection: Invalid X-CSRF-Token',
    });
  }

  // Fallback: Origin/Referer validation for cross-origin setups
  const origin = req.headers['origin'] as string | undefined;
  if (origin && isTrustedOrigin(origin)) {
    return next();
  }

  const referer = req.headers['referer'] as string | undefined;
  if (referer && isTrustedOrigin(referer)) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'CSRF protection: Missing X-CSRF-Token header',
  });
};
