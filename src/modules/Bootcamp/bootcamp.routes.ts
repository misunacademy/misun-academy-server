import express from 'express';
import { BootcampController } from './bootcamp.controller.js';
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

export const BootcampRoutes = router;
