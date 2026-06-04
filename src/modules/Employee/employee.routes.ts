import express from 'express';
import { EmployeeController } from './employee.controller.js';
import {
    requireAuth,
    requireAdmin,
    requireEmployee,
} from '../../middlewares/betterAuth.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
//  ADMIN ROUTES  — must be declared before employee routes to avoid collisions
// ─────────────────────────────────────────────────────────────────────────────

// Employees list
router.get('/admin/employees',             requireAuth, requireAdmin, EmployeeController.getAllEmployees);

// Salary management
router.get('/admin/salaries',              requireAuth, requireAdmin, EmployeeController.getAllSalariesAdmin);
router.post('/admin/salaries',             requireAuth, requireAdmin, EmployeeController.addSalary);
router.patch('/admin/salaries/:id/status', requireAuth, requireAdmin, EmployeeController.updateSalaryStatus);
router.put('/admin/salaries/:id',          requireAuth, requireAdmin, EmployeeController.updateSalary);
router.delete('/admin/salaries/:id',       requireAuth, requireAdmin, EmployeeController.deleteSalary);

// Leave management
router.get('/admin/leave',                 requireAuth, requireAdmin, EmployeeController.getAllLeaveRequestsAdmin);
router.patch('/admin/leave/:id/status',    requireAuth, requireAdmin, EmployeeController.updateLeaveStatus);

// ─────────────────────────────────────────────────────────────────────────────
//  EMPLOYEE ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// Profile
router.get('/profile',   requireAuth, requireEmployee, EmployeeController.getMyProfile);
router.patch('/profile', requireAuth, requireEmployee, EmployeeController.updateMyProfile);

// Salaries
router.get('/salaries', requireAuth, requireEmployee, EmployeeController.getMySalaries);

// Leave requests
router.get('/leave',  requireAuth, requireEmployee, EmployeeController.getMyLeaveRequests);
router.post('/leave', requireAuth, requireEmployee, EmployeeController.addLeaveRequest);

export const EmployeeRoutes = router;
