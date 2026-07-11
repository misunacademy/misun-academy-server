import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { fromNodeHeaders } from 'better-auth/node';
import { getAuth } from '../config/betterAuth.js';

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

      (socket as any).userId = session.user.id;
      (socket as any).userRole = (session.user as any).role || 'learner';
      next();
    } catch (error) {
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

    socket.on('disconnect', () => {
    });
  });

  return io;
};

export const getIO = (): Server | null => {
  return io;
};
