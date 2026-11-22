import { NextFunction, Request, Response } from 'express';
import { ZodType } from 'zod';

const validateRequest =
    (schema: ZodType<Record<string, any>>) =>
        async (req: Request, res: Response, next: NextFunction): Promise<void> => {
            try {
                const parsed = await schema.parseAsync({
                    body: req.body,
                    query: req.query,
                    params: req.params,
                    cookies: req.cookies,
                });
                if (parsed.body !== undefined) {
                    req.body = parsed.body;
                }
                return next();
            } catch (error) {
                next(error);
            }
        };

export default validateRequest;