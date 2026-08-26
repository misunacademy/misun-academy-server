import express from 'express';
import { AuditLogController } from './auditLog.controller.js';
import { requireAuth, requireSuperAdmin } from '../../middlewares/betterAuth.js';

const router = express.Router();

router.use(requireAuth, requireSuperAdmin);

router.get('/', AuditLogController.getAuditLogs);

export const AuditLogRoutes = router;
