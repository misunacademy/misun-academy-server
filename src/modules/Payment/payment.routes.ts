import express from 'express';
import { PaymentController } from './payment.controller';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth';

const router = express.Router();

// Public webhook endpoint (called by SSLCommerz)
router.post('/webhook', PaymentController.sslCommerzWebhook);

// Payment status check (redirect endpoint) - SSLCommerz uses POST
router.post('/status', PaymentController.checkPaymentStatus);
router.get('/status', PaymentController.checkPaymentStatus);

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
    PaymentController.verifyManualPayment
);

router.put(
    '/:tran_id/status',
    requireAuth,
    requireAdmin,
    PaymentController.updatePaymentWithEnrollStatus
);

export const PaymentRoutes = router;

