import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const { method, originalUrl, correlationId } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;

    logger.info({
      correlationId,
      method,
      url: originalUrl,
      statusCode,
      duration: `${duration}ms`,
      contentLength: res.getHeader('content-length') || 0,
    }, `${method} ${originalUrl} ${statusCode} ${duration}ms`);
  });

  next();
};
