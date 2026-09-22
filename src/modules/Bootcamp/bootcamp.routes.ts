import express from 'express';
import { BootcampController } from './bootcamp.controller.js';
import { BootcampCatalogController } from './bootcampCatalog.controller.js';
import {
    createBootcampSchema,
    updateBootcampSchema,
    bootcampSlugParamSchema,
    setRecordedPriceSchema,
    publishRecordingSchema,
    adminBootcampQuerySchema,
    adminBootcampPurchaseQuerySchema,
    addBootcampVideoSchema,
    updateBootcampVideoSchema,
    deleteBootcampVideoSchema,
    bootcampIdParamSchema,
} from './bootcampCatalog.validation.js';
import { requireAuth, requireAdmin, optionalAuth } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { createRateLimiter } from '../../middlewares/rateLimit.js';
import {
    registerBootcampValidationSchema,
    updateBootcampRegistrationValidationSchema,
    bootcampQueryValidationSchema,
    bootcampIdParamValidationSchema,
} from './bootcamp.validation.js';

const router = express.Router();

const bootcampRegisterLimiter = createRateLimiter({
    prefix: 'bootcamp-register',
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Too many registration attempts, please try again after 15 minutes',
});

router.get('/current', BootcampCatalogController.getCurrentBootcamp);

router.get('/past', BootcampCatalogController.getPastBootcamps);

router.get(
    '/slug/:slug',
    optionalAuth,
    validateRequest(bootcampSlugParamSchema),
    BootcampCatalogController.getBootcampBySlug
);

router.post(
    '/register',
    bootcampRegisterLimiter,
    validateRequest(registerBootcampValidationSchema),
    BootcampController.registerForBootcamp
);

router.get(
    '/registrations',
    requireAuth,
    requireAdmin,
    validateRequest(bootcampQueryValidationSchema),
    BootcampController.getBootcampRegistrations
);

router.get(
    '/registrations/stats',
    requireAuth,
    requireAdmin,
    BootcampController.getBootcampStats
);

router.patch(
    '/registrations/:id',
    requireAuth,
    requireAdmin,
    validateRequest(updateBootcampRegistrationValidationSchema),
    BootcampController.updateBootcampRegistration
);

router.delete(
    '/registrations/:id',
    requireAuth,
    requireAdmin,
    validateRequest(bootcampIdParamValidationSchema),
    BootcampController.deleteBootcampRegistration
);

router.get(
    '/catalog',
    requireAuth,
    requireAdmin,
    validateRequest(adminBootcampQuerySchema),
    BootcampCatalogController.listBootcampsAdmin
);

router.post(
    '/catalog',
    requireAuth,
    requireAdmin,
    validateRequest(createBootcampSchema),
    BootcampCatalogController.createBootcamp
);

router.patch(
    '/catalog/:id',
    requireAuth,
    requireAdmin,
    validateRequest(updateBootcampSchema),
    BootcampCatalogController.updateBootcamp
);

router.patch(
    '/catalog/:id/recorded-price',
    requireAuth,
    requireAdmin,
    validateRequest(setRecordedPriceSchema),
    BootcampCatalogController.setRecordedPrice
);

router.post(
    '/catalog/:id/publish-recording',
    requireAuth,
    requireAdmin,
    validateRequest(publishRecordingSchema),
    BootcampCatalogController.publishRecording
);

// --- Bootcamp videos (standalone, no Course/Batch dependency) ---
router.post(
    '/catalog/:id/videos',
    requireAuth,
    requireAdmin,
    validateRequest(addBootcampVideoSchema),
    BootcampCatalogController.addBootcampVideo
);

router.patch(
    '/catalog/:id/videos/:videoId',
    requireAuth,
    requireAdmin,
    validateRequest(updateBootcampVideoSchema),
    BootcampCatalogController.updateBootcampVideo
);

router.delete(
    '/catalog/:id/videos/:videoId',
    requireAuth,
    requireAdmin,
    validateRequest(deleteBootcampVideoSchema),
    BootcampCatalogController.deleteBootcampVideo
);

router.get(
    '/catalog/:id/videos',
    requireAuth,
    requireAdmin,
    validateRequest(bootcampIdParamSchema),
    BootcampCatalogController.listBootcampVideos
);

// --- Bootcamp recording purchases (SSLCommerz only — gateway callbacks
// finalize automatically; learners see their own via /my-purchases; admins
// manage/report on every purchase through the /purchases endpoints) ---
router.get(
    '/purchases/stats',
    requireAuth,
    requireAdmin,
    validateRequest(adminBootcampPurchaseQuerySchema),
    BootcampCatalogController.getBootcampPurchaseStats
);

router.get(
    '/purchases',
    requireAuth,
    requireAdmin,
    validateRequest(adminBootcampPurchaseQuerySchema),
    BootcampCatalogController.listBootcampPurchases
);

router.get(
    '/my-purchases',
    requireAuth,
    BootcampCatalogController.getMyBootcampPurchases
);

router.get(
    '/slug/:slug/videos',
    requireAuth,
    validateRequest(bootcampSlugParamSchema),
    BootcampCatalogController.getMyBootcampVideos
);

// --- SSLCommerz payment for bootcamp recordings ---
// Status callback is hit by the SSLCommerz gateway (form POST into the popup
// window) and by browser top-level navigation — both carry no session/CSRF, so
// it stays public and is verified via the HMAC callback key (same as PaymentRoutes).
router.post(
    '/slug/:slug/payment/initiate',
    requireAuth,
    validateRequest(bootcampSlugParamSchema),
    BootcampCatalogController.initiateBootcampSSLCommerz
);

router.get('/payments/status', BootcampCatalogController.bootcampPaymentStatus);

router.post('/payments/status', BootcampCatalogController.bootcampPaymentStatus);

router.post(
    '/payments/webhook',
    express.urlencoded({ extended: true }),
    express.json(),
    BootcampCatalogController.bootcampPaymentWebhook
);

export const BootcampRoutes = router;
