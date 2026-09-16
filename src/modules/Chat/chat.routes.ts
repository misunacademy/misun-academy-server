import express from 'express';
import { ChatController } from './chat.controller.js';
import { optionalAuth } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { createRateLimiter } from '../../middlewares/rateLimit.js';
import { chatRequestSchema } from './chat.validation.js';

const router = express.Router();

const chatLimiter = createRateLimiter({
    prefix: 'chat',
    windowMs: 60 * 60 * 1000,
    max: 10,
    keyByUser: true,
    message: 'Too many chat requests. Please wait a while before trying again.',
});

router.post(
  '/',
  optionalAuth,
  chatLimiter,
  validateRequest(chatRequestSchema),
  ChatController.chat
);

export const ChatRoutes = router;
