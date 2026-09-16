import express from 'express';
import { RecordingController } from './recording.controller.js';
import { requireAuth, requireInstructor } from '../../middlewares/betterAuth.js';
import { checkBatchEnrollment } from '../../middlewares/batchAccess.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { RecordingValidation } from './recording.validation.js';

const router = express.Router();

// Admin/Instructor routes
router.post('/', requireAuth, requireInstructor, validateRequest(RecordingValidation.createRecording), RecordingController.createRecording);

router.get('/', requireAuth, requireInstructor, RecordingController.getAllRecordings);

// Student routes — literal paths before parameterized routes to avoid collisions
router.get(
    '/student/my-recordings',
    requireAuth,
    RecordingController.getStudentRecordings
);

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
    validateRequest(RecordingValidation.updateRecording),
    RecordingController.updateRecording
);

router.delete(
    '/:recordingId',
    requireAuth,
    requireInstructor,
    RecordingController.deleteRecording
);

export const RecordingRoutes = router;
