import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';

type ResourceModel = mongoose.Model<any>;
type UserFieldExtractor = (resource: any) => string | undefined;

export const requireOwnership = (
    model: ResourceModel,
    resourceIdParam: string,
    extractUserId: UserFieldExtractor = (resource) => resource?.userId?.toString()
) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const resourceId = req.params[resourceIdParam];
            if (!resourceId) {
                return res.status(StatusCodes.BAD_REQUEST).json({
                    success: false,
                    message: `Resource ID (${resourceIdParam}) is required`,
                });
            }

            const resource = await model.findById(resourceId).lean();
            if (!resource) {
                return res.status(StatusCodes.NOT_FOUND).json({
                    success: false,
                    message: 'Resource not found',
                });
            }

            const ownerId = extractUserId(resource);
            const userId = req.user?.id;

            if (!ownerId || !userId) {
                return res.status(StatusCodes.FORBIDDEN).json({
                    success: false,
                    message: 'Access denied',
                });
            }

            const isOwner = ownerId === userId;
            const isAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';

            if (!isOwner && !isAdmin) {
                return res.status(StatusCodes.FORBIDDEN).json({
                    success: false,
                    message: 'You do not have permission to access this resource',
                });
            }

            next();
        } catch (error) {
            next(error);
        }
    };
};

export const requireOwnershipByUserId = (
    model: ResourceModel,
    userIdField: string = 'userId',
    paramName: string = 'id'
) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const paramValue = req.params[paramName] || req.query[paramName] || req.body[paramName];
            if (!paramValue) {
                return res.status(StatusCodes.BAD_REQUEST).json({
                    success: false,
                    message: `Resource identifier is required`,
                });
            }

            const resource = await model.findOne({
                $or: [
                    { _id: paramValue },
                    { enrollmentId: paramValue },
                ].filter(Boolean),
            }).lean();

            if (!resource) {
                return res.status(StatusCodes.NOT_FOUND).json({
                    success: false,
                    message: 'Resource not found',
                });
            }

            const ownerId = (resource as any)[userIdField]?.toString();
            const userId = req.user?.id;

            if (!ownerId || !userId) {
                return res.status(StatusCodes.FORBIDDEN).json({
                    success: false,
                    message: 'Access denied',
                });
            }

            const isOwner = ownerId === userId;
            const isAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';

            if (!isOwner && !isAdmin) {
                return res.status(StatusCodes.FORBIDDEN).json({
                    success: false,
                    message: 'You do not have permission to access this resource',
                });
            }

            next();
        } catch (error) {
            next(error);
        }
    };
};
