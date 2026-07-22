import express, { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { z } from 'zod';
import { MotivationalMessageService } from './motivationalMessage.service.js';

const router = express.Router();

router.use(requireAuth);
router.use(requireAdmin);

const messageSchema = z.object({
    body: z.object({
        minPercentage: z.number().min(0).max(100),
        maxPercentage: z.number().min(0).max(100),
        title: z.string().min(1),
        message: z.string().min(1),
        emoji: z.string().optional(),
        isActive: z.boolean().default(true),
    }),
});

const updateMessageSchema = z.object({
    body: z.object({
        minPercentage: z.number().min(0).max(100).optional(),
        maxPercentage: z.number().min(0).max(100).optional(),
        title: z.string().min(1).optional(),
        message: z.string().min(1).optional(),
        emoji: z.string().optional().nullable(),
        isActive: z.boolean().optional(),
    }),
});

const getAll = catchAsync(async (_req: Request, res: Response) => {
    const messages = await MotivationalMessageService.getAllMessages();
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Messages retrieved successfully',
        data: messages,
    });
});

const create = catchAsync(async (req: Request, res: Response) => {
    const message = await MotivationalMessageService.createMessage(req.body);
    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Message created successfully',
        data: message,
    });
});

const update = catchAsync(async (req: Request, res: Response) => {
    const { messageId } = req.params;
    const message = await MotivationalMessageService.updateMessage(messageId, req.body);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Message updated successfully',
        data: message,
    });
});

const remove = catchAsync(async (req: Request, res: Response) => {
    const { messageId } = req.params;
    await MotivationalMessageService.deleteMessage(messageId);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Message deleted successfully',
        data: null,
    });
});

router.get('/messages', getAll);
router.post('/messages', validateRequest(messageSchema), create);
router.put('/messages/:messageId', validateRequest(updateMessageSchema), update);
router.delete('/messages/:messageId', remove);

export const MotivationalMessageRoutes = router;
