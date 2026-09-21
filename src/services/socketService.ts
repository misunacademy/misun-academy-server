import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { fromNodeHeaders } from 'better-auth/node';
import { getAuth } from '../config/betterAuth.js';
import { UserStatus } from '../types/common.js';

const eventRateLimit = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 10000;
const RATE_LIMIT_MAX = 20;

const checkRateLimit = (userId: string): boolean => {
  const now = Date.now();
  const record = eventRateLimit.get(userId);
  if (!record || now > record.resetAt) {
    eventRateLimit.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (record.count >= RATE_LIMIT_MAX) return false;
  record.count++;
  return true;
};

let io: Server | null = null;

export const initializeSocketIO = (httpServer: HTTPServer) => {
  if (io) return io;

  const allowedOrigins = [
    process.env.MA_FRONTEND_URL,
    process.env.EP_FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:3001',
  ].filter(Boolean) as string[];

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.use(async (socket: Socket, next) => {
    try {
      const auth = getAuth();
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(socket.request.headers as any),
      });

      if (!session || !session.user) {
        return next(new Error('Authentication required'));
      }

      // Same bar as HTTP requireAuth: verified email + non-revoked status.
      // Otherwise suspended/deleted/unverified users keep a realtime channel
      // (including the admin room on stale sessions) that REST denies them.
      if (!session.user.emailVerified) {
        return next(new Error('Email verification required'));
      }

      const accountStatus = (session.user as any).status || UserStatus.Active;
      if (accountStatus === UserStatus.Suspended || accountStatus === UserStatus.Deleted) {
        return next(new Error('Account is not active'));
      }

      (socket as any).userId = session.user.id;
      (socket as any).userRole = (session.user as any).role || 'learner';
      next();
    } catch {
      next(new Error('Invalid session'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId;
    const role = (socket as any).userRole;

    socket.join(`user:${userId}`);

    if (role === 'admin' || role === 'superadmin') {
      socket.join('admin');
    }

    // Rate limit per user AND event: one noisy event must not starve the
    // user's other events for the whole window.
    socket.use(([event, ..._args], next) => {
      if (!checkRateLimit(`${userId}:${String(event)}`)) {
        return next(new Error('Rate limit exceeded'));
      }
      next();
    });

    socket.on('disconnect', () => {
    });
  });

  return io;
};

export const getIO = (): Server | null => {
  return io;
};

const clearExpiredRateLimits = () => {
  const now = Date.now();
  for (const [key, record] of eventRateLimit) {
    if (now > record.resetAt) eventRateLimit.delete(key);
  }
};
setInterval(clearExpiredRateLimits, 60000);

export const closeSocketIO = () => {
  if (io) {
    io.close();
    io = null;
  }
};
