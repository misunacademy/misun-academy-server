import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare module 'express-serve-static-core' {
  interface Request {
    correlationId: string;
  }
}

export const correlationId = (req: Request, _res: Response, next: NextFunction) => {
  const id = (req.headers['x-correlation-id'] as string) || uuidv4();
  req.correlationId = id;
  _res.setHeader('x-correlation-id', id);
  next();
};
