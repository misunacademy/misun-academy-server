import { Router, Request, Response } from 'express';
import { getAuth } from '../config/betterAuth';
import { toNodeHandler } from 'better-auth/node';

const router = Router();

// Mount Better Auth handler for all auth-related routes
// This handles: /sign-up, /sign-in, /sign-out, /session, /callback/*, etc.
router.all('*', (req: Request, res: Response) => {
  try {
    const auth = getAuth();
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
