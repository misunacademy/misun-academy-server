import express from 'express';
import { RecordingController } from './recording.controller';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth';
import { checkBatchEnrollment } from '../../middlewares/batchAccess';

const router = express.Router();

// Admin routes
router.post('/', requireAuth, requireAdmin, RecordingController.createRecording);

router.get('/', requireAuth, requireAdmin, RecordingController.getAllRecordings);

router.get(
    '/:recordingId',
    requireAuth,
    requireAdmin,
    RecordingController.getRecordingById
);

router.put(
    '/:recordingId',
    requireAuth,
    requireAdmin,
    RecordingController.updateRecording
);

router.delete(
    '/:recordingId',
    requireAuth,
    requireAdmin,
    RecordingController.deleteRecording
);

// Student routes - get all recordings for enrolled batches
router.get(
    '/student/my-recordings',
    requireAuth,
    RecordingController.getStudentRecordings
);

// Student routes - get recordings for their enrolled batch
router.get(
    '/batch/:batchId',
    requireAuth,
    checkBatchEnrollment,
    RecordingController.getBatchRecordings
);

router.post(
    '/:recordingId/view',
    requireAuth,
    RecordingController.incrementViewCount
);

export const RecordingRoutes = router;
