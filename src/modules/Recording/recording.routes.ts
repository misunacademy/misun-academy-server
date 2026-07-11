import express from 'express';
import { RecordingController } from './recording.controller.js';
import { requireAuth, requireInstructor } from '../../middlewares/betterAuth.js';
import { checkBatchEnrollment } from '../../middlewares/batchAccess.js';

const router = express.Router();

// Admin/Instructor routes
router.post('/', requireAuth, requireInstructor, RecordingController.createRecording);

router.get('/', requireAuth, requireInstructor, RecordingController.getAllRecordings);

router.get(
    '/:recordingId',
    requireAuth,
    requireInstructor,
    RecordingController.getRecordingById
);

router.put(
    '/:recordingId',
    requireAuth,
    requireInstructor,
    RecordingController.updateRecording
);

router.delete(
    '/:recordingId',
    requireAuth,
    requireInstructor,
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
