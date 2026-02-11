import express from 'express';
import { ProfileController } from './profile.controller';
import { requireAuth } from '../../middlewares/betterAuth';
import validateRequest from '../../middlewares/validateRequest';
import {
  createProfileSchema,
  updateProfileSchema,
  updateInterestsSchema,
  addInterestSchema,
  removeInterestSchema,
} from '../../validations/profile.validation';

const router = express.Router();

// All profile routes require authentication
router.use(requireAuth);

// Profile CRUD operations
router.post('/', validateRequest(createProfileSchema), ProfileController.createProfile);
router.get('/', ProfileController.getProfile);
router.put('/', validateRequest(updateProfileSchema), ProfileController.updateProfile);
router.delete('/', ProfileController.deleteProfile);

// Interest management
router.put('/interests', validateRequest(updateInterestsSchema), ProfileController.updateInterests);
router.post('/interests', validateRequest(addInterestSchema), ProfileController.addInterest);
router.delete('/interests', validateRequest(removeInterestSchema), ProfileController.removeInterest);

// Centralized Student Profile - Single Source of Truth
router.get('/complete', ProfileController.getCompleteStudentProfile);
router.post('/sync-enrollments', ProfileController.syncAllUserEnrollmentsToProfile);

export const ProfileRoutes = router;