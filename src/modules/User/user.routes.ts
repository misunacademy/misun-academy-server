import express from 'express';
import { ProfileController } from '../Profile/profile.controller';
import { requireAuth } from '../../middlewares/betterAuth';

const router = express.Router();

// User profile endpoints (proxy to Profile controller)
router.get('/profile', requireAuth, ProfileController.getProfile);
router.put('/profile', requireAuth, ProfileController.updateProfile);

export const UserRoutes = router;
