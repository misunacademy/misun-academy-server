import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare module 'express-serve-static-core' {
  interface Request {
    correlationId: string;
  }
}

export const correlationId = (req: Request, _res: Response, next: NextFunction) => {
  const raw = req.headers['x-correlation-id'];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  // Accept only sane client-supplied IDs (uuid-ish); anything else gets a
  // server-generated one. Prevents log injection / header reflection.
  const id =
    candidate && /^[A-Za-z0-9-]{8,64}$/.test(candidate) ? candidate : uuidv4();
  req.correlationId = id;
  _res.setHeader('x-correlation-id', id);
  next();
};
