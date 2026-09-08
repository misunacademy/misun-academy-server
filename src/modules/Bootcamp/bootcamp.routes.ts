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
} from './bootcampCatalog.validation.js';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
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

export const BootcampRoutes = router;
