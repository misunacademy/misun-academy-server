import express from 'express';
import { ChatController } from './chat.controller.js';
import { optionalAuth } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { chatRequestSchema } from './chat.validation.js';

const router = express.Router();

router.post(
  '/',
  optionalAuth,
  validateRequest(chatRequestSchema),
  ChatController.chat
);

export const ChatRoutes = router;
