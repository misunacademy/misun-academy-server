import express from 'express';
import { PaymentController } from './payment.controller.js';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { allowCronSecret } from '../../middlewares/cronAuth.js';
import { verifyPaymentSchema, updatePaymentStatusSchema, reVerifyPaymentSchema, paymentHistoryQuerySchema } from '../../validations/payment.validation.js';

const router = express.Router();

// Public webhook endpoint (called by SSLCommerz)
router.post('/webhook', PaymentController.sslCommerzWebhook);

// Payment status check (redirect endpoint) - SSLCommerz uses POST
router.post('/status', PaymentController.checkPaymentStatus);
router.get('/status', PaymentController.checkPaymentStatus);

// Reconcile stale gateway payments + expire abandoned enrollments.
// Vercel Cron (Bearer CRON_SECRET) or an admin can trigger it.
router.all('/maintenance/run', allowCronSecret, PaymentController.runMaintenance);

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
    validateRequest(paymentHistoryQuerySchema),
    PaymentController.getPaymentHistory
);

router.get(
    '/history/:transactionId',
    requireAuth,
    requireAdmin,
    PaymentController.getPaymentDetail
);

router.post(
    '/:transactionId/verify',
    requireAuth,
    requireAdmin,
    validateRequest(verifyPaymentSchema),
    PaymentController.verifyManualPayment
);

router.post(
    '/:tran_id/re-verify',
    requireAuth,
    requireAdmin,
    validateRequest(reVerifyPaymentSchema),
    PaymentController.reVerifyPaymentWithGateway
);

router.put(
    '/:tran_id/status',
    requireAuth,
    requireAdmin,
    validateRequest(updatePaymentStatusSchema),
    PaymentController.updatePaymentWithEnrollStatus
);

export const PaymentRoutes = router;

