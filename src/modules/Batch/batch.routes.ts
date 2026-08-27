import express from 'express';
import validateRequest from '../../middlewares/validateRequest.js';
import { BatchController } from './batch.controller.js';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import { createBatchSchema, updateBatchSchema, updateBatchStatusSchema } from './batch.validation.js';
import env from '../../config/env.js';

const router = express.Router();

const allowCronSecret = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) => {
    const authHeader = req.headers.authorization;
    if (env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`) {
        return next();
    }
    requireAuth(req, res, () => requireAdmin(req, res, next));
};

// Public access for listing batches (used by student-facing views)
router.get('/', BatchController.getAllBatches);
router.get('/upcoming', BatchController.getUpcomingBatches);
router.get('/current-enrollments', BatchController.getCurrentEnrollmentBatches); // Note plural `enrollments` to differentiate
router.get('/current-enrollment', BatchController.getCurrentEnrollmentBatch);
router.get('/:id', BatchController.getBatchById);

router.put(
    '/:id',
    requireAuth,
    requireAdmin,
    validateRequest(updateBatchSchema),
    BatchController.updateBatch
);

router.post(
    '/',
    requireAuth,
    requireAdmin,
    validateRequest(createBatchSchema),
    BatchController.createBatch
);

// Manual status transition
router.post(
    '/:id/transition',
    requireAuth,
    requireAdmin,
    validateRequest(updateBatchStatusSchema),
    BatchController.transitionBatchStatus
);

// Trigger auto-transition (admin manually, or Vercel Cron with Bearer CRON_SECRET)
router.all(
    '/auto-transition/run',
    allowCronSecret,
    BatchController.runAutoTransition
);

// Delete batch
router.delete(
    '/:id',
    requireAuth,
    requireAdmin,
    BatchController.deleteBatch
);

export const BatchRoutes = router;