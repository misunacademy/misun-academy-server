import express from 'express';
import { ContentController } from './content.controller';
import { requireAuth } from '../../middlewares/betterAuth';
import { checkBatchEnrollment } from '../../middlewares/batchAccess';

const router = express.Router();

// All routes require authentication and batch enrollment
router.use(requireAuth);

// Get modules for a batch
router.get(
    '/batches/:batchId/modules',
    checkBatchEnrollment,
    ContentController.getBatchModules
);

// Get lessons for a module
router.get(
    '/batches/:batchId/modules/:moduleId/lessons',
    checkBatchEnrollment,
    ContentController.getModuleLessons
);

// Get lesson details
router.get(
    '/batches/:batchId/modules/:moduleId/lessons/:lessonId',
    checkBatchEnrollment,
    ContentController.getLessonDetails
);

// Get module resources
router.get(
    '/batches/:batchId/modules/:moduleId/resources',
    checkBatchEnrollment,
    ContentController.getModuleResources
);

// Update lesson progress
router.post(
    '/progress/lessons/:lessonId',
    checkBatchEnrollment,
    ContentController.updateLessonProgress
);

// Get batch progress
router.get(
    '/progress/batches/:batchId',
    checkBatchEnrollment,
    ContentController.getBatchProgress
);

export const ContentRoutes = router;
