import { Request } from 'express';
import { Role } from './role.js';

declare global {
    namespace Express {
        interface Request {
            user?: {
                userId: string;
                role: Role;
                email: string;
            };
        }
    }
}

export {};
