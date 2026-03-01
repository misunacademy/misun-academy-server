import express from 'express';
import { requireAuth, requireAdmin, requireEmployee } from '../../middlewares/betterAuth';
import { EmployeeController } from './employee.controller';

const router = express.Router();

/* ─── EMPLOYEE-FACING ROUTES ─────────────────────────────────────────── */

// GET  /employee/salaries         → own salary history
router.get('/salaries', requireAuth, requireEmployee, EmployeeController.getMySalaries);

// GET  /employee/leave            → own leave requests
router.get('/leave', requireAuth, requireEmployee, EmployeeController.getMyLeaveRequests);

// POST /employee/leave            → submit new leave request
router.post('/leave', requireAuth, requireEmployee, EmployeeController.addLeaveRequest);

/* ─── ADMIN-FACING ROUTES ────────────────────────────────────────────── */

// GET  /employee/admin/employees          → list all employees
router.get('/admin/employees', requireAuth, requireAdmin, EmployeeController.getAllEmployees);

// GET  /employee/admin/salaries           → list all salary records
router.get('/admin/salaries', requireAuth, requireAdmin, EmployeeController.getAllSalaries);

// POST /employee/admin/salaries           → create a salary record
router.post('/admin/salaries', requireAuth, requireAdmin, EmployeeController.createSalary);

// PATCH /employee/admin/salaries/:id/status → update salary status
router.patch('/admin/salaries/:id/status', requireAuth, requireAdmin, EmployeeController.updateSalaryStatus);

// GET  /employee/admin/leave              → list all leave requests
router.get('/admin/leave', requireAuth, requireAdmin, EmployeeController.getAllLeaveRequests);

// PATCH /employee/admin/leave/:id/status  → approve or reject leave
router.patch('/admin/leave/:id/status', requireAuth, requireAdmin, EmployeeController.updateLeaveStatus);

export const EmployeeRoutes = router;
