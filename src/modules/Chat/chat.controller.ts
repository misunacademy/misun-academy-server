import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { ChatService } from './chat.service.js';

const chat = catchAsync(async (req: Request, res: Response) => {
  const { messages } = req.body;
  const userName = req.user?.name;

  const result = await ChatService.chat(messages, userName);

  // Token usage stays server-side (logged in the service) — returning it
  // aids cost-probing and serves no client purpose.
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Chat response generated successfully',
    data: { reply: result.reply },
  });
});

export const ChatController = { chat };
