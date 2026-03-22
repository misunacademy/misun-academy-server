import express from 'express';
import validateRequest from '../../middlewares/validateRequest';
import { BatchController } from './batch.controller';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth';
import { Role } from '../../types/role';
import { createBatchSchema, updateBatchSchema } from './batch.validation';
const router = express.Router();

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
    BatchController.transitionBatchStatus
);

// Trigger auto-transition (admin can run manually)
router.post(
    '/auto-transition/run',
    requireAuth,
    requireAdmin,
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