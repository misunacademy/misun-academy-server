import express from 'express';
import { PaymentController } from './payment.controller.js';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { verifyPaymentSchema, updatePaymentStatusSchema } from '../../validations/payment.validation.js';

const router = express.Router();

// Public webhook endpoint (called by SSLCommerz)
router.post('/webhook', PaymentController.sslCommerzWebhook);

// Payment status check (redirect endpoint) - SSLCommerz uses POST
router.post('/status', PaymentController.checkPaymentStatus);
router.get('/status', PaymentController.checkPaymentStatus);

router.get(
    '/verify',
    requireAuth,
    PaymentController.verifyPaymentSuccessForCurrentUser
);

// Authenticated routes
router.get(
    '/me',
    requireAuth,
    PaymentController.getMyPayments
);

// Admin routes
router.get(
    '/history',
    requireAuth,
    requireAdmin,
    PaymentController.getPaymentHistory
);

router.post(
    '/:transactionId/verify',
    requireAuth,
    requireAdmin,
    validateRequest(verifyPaymentSchema),
    PaymentController.verifyManualPayment
);

router.put(
    '/:tran_id/status',
    requireAuth,
    requireAdmin,
    validateRequest(updatePaymentStatusSchema),
    PaymentController.updatePaymentWithEnrollStatus
);

export const PaymentRoutes = router;

