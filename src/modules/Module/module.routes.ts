import express from 'express';
import { ModuleController } from './module.controller';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth';

const router = express.Router();

// All routes require admin authentication
router.use(requireAuth);
router.use(requireAdmin);

// Create module for a course
router.post('/courses/:courseId/modules', ModuleController.createModule);

// Get all modules for a course
router.get('/courses/:courseId/modules', ModuleController.getCourseModules);

// Reorder modules
router.put('/courses/:courseId/modules/reorder', ModuleController.reorderModules);

// Get module by ID
router.get('/modules/:moduleId', ModuleController.getModuleById);

// Update module
router.put('/modules/:moduleId', ModuleController.updateModule);

// Delete module
router.delete('/modules/:moduleId', ModuleController.deleteModule);

export const ModuleRoutes = router;
