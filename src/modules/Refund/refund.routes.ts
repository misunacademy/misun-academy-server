import express from 'express';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import {
  createRefundSchema,
  refundIdParamSchema,
  refundNoteSchema,
  refundQuerySchema,
} from './refund.validation.js';
import { RefundController } from './refund.controller.js';

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.post('/', validateRequest(createRefundSchema), RefundController.createRefund);

router.get('/', validateRequest(refundQuerySchema), RefundController.listRefunds);

router.get('/:id', validateRequest(refundIdParamSchema), RefundController.getRefundById);

router.post('/:id/approve', validateRequest(refundNoteSchema), RefundController.approveRefund);

router.post('/:id/reject', validateRequest(refundNoteSchema), RefundController.rejectRefund);

router.post('/:id/complete', validateRequest(refundIdParamSchema), RefundController.completeRefund);

export const RefundRoutes = router;