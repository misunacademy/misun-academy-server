import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../helpers/db.js';
import { createUser } from '../helpers/factories.js';
import { EmployeeService } from '../../modules/Employee/employee.service.js';
import { SalaryModel, LeaveRequestModel, EmployeeProfileModel } from '../../modules/Employee/employee.model.js';
import { Role } from '../../types/role.js';

const uniq = () => `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

beforeAll(async () => {
    await connectTestDB();
});

afterAll(async () => {
    await disconnectTestDB();
});

beforeEach(async () => {
    await clearTestDB();
});

const createEmployee = (overrides: Record<string, unknown> = {}) =>
    createUser({ email: `emp-${uniq()}@example.com`, role: Role.EMPLOYEE, ...overrides });

describe('EmployeeService.getMyProfile / updateMyProfile', () => {
    it('returns merged user + extended profile with null defaults', async () => {
        const emp = await createEmployee();
        const profile: any = await EmployeeService.getMyProfile(emp._id.toString());
        expect(profile.email).toBe(emp.email);
        expect(profile.whatsapp).toBeNull();
        expect(profile.designation).toBeNull();
    });

    it('throws NOT_FOUND for unknown user', async () => {
        await expect(
            EmployeeService.getMyProfile(new mongoose.Types.ObjectId().toString())
        ).rejects.toThrow(/User not found/i);
    });

    it('updateMyProfile writes base fields to User and extended fields to EmployeeProfile', async () => {
        const emp = await createEmployee();
        const uid = emp._id.toString();

        const merged: any = await EmployeeService.updateMyProfile(uid, {
            name: 'Updated Employee',
            phone: '01800000000',
            whatsapp: '01900000000',
            bloodGroup: 'O+',
            designation: 'Designer',
        });

        expect(merged.name).toBe('Updated Employee');
        expect(merged.whatsapp).toBe('01900000000');
        expect(merged.bloodGroup).toBe('O+');
        expect(merged.designation).toBe('Designer');

        const { UserModel } = await import('../../modules/User/user.model.js');
        const user = await UserModel.findById(uid).lean();
        expect(user?.phone).toBe('01800000000');

        const ext = await EmployeeProfileModel.findOne({ userId: uid }).lean();
        expect(ext?.designation).toBe('Designer');
    });

    it('updateMyProfile with empty payload leaves data untouched', async () => {
        const emp = await createEmployee({ name: 'Keep Me' });
        const merged: any = await EmployeeService.updateMyProfile(emp._id.toString(), {});
        expect(merged.name).toBe('Keep Me');
    });
});

describe('EmployeeService salaries', () => {
    const addSalaryPayload = (employeeId: any, overrides: Record<string, unknown> = {}) => ({
        employeeId,
        employeeName: 'Test Employee',
        jobTitle: 'Designer',
        month: 'January',
        year: 2025,
        amount: 30000,
        bonus: 5000,
        ...overrides,
    });

    it('addSalary computes totalAmount = amount + bonus', async () => {
        const emp = await createEmployee();
        const salary: any = await EmployeeService.addSalary(addSalaryPayload(emp._id) as any);
        expect(salary.totalAmount).toBe(35000);
    });

    it('getMySalaries paginates', async () => {
        const emp = await createEmployee();
        await EmployeeService.addSalary(addSalaryPayload(emp._id, { month: 'January' }) as any);
        await EmployeeService.addSalary(addSalaryPayload(emp._id, { month: 'February' }) as any);
        await EmployeeService.addSalary(addSalaryPayload(emp._id, { month: 'March' }) as any);

        const page1: any = await EmployeeService.getMySalaries(emp._id.toString(), { page: 1, limit: 2 });
        expect(page1.salaries).toHaveLength(2);
        expect(page1.total).toBe(3);
        expect(page1.totalPages).toBe(2);

        const page2: any = await EmployeeService.getMySalaries(emp._id.toString(), { page: 2, limit: 2 });
        expect(page2.salaries).toHaveLength(1);
    });

    it('updateSalaryStatus flips status and returns existing when unchanged', async () => {
        const emp = await createEmployee();
        const salary: any = await EmployeeService.addSalary(addSalaryPayload(emp._id) as any);
        expect(salary.status).toBe('Pending');

        const paid: any = await EmployeeService.updateSalaryStatus(salary._id.toString(), 'Paid');
        expect(paid.status).toBe('Paid');

        const same: any = await EmployeeService.updateSalaryStatus(salary._id.toString(), 'Paid');
        expect(same.status).toBe('Paid');
    });

    it('updateSalaryStatus throws for unknown id', async () => {
        await expect(
            EmployeeService.updateSalaryStatus(new mongoose.Types.ObjectId().toString(), 'Paid')
        ).rejects.toThrow(/Salary record not found/i);
    });

    it('updateSalary recalculates totalAmount via pre-save hook', async () => {
        const emp = await createEmployee();
        const salary: any = await EmployeeService.addSalary(addSalaryPayload(emp._id) as any);
        const updated: any = await EmployeeService.updateSalary(salary._id.toString(), {
            amount: 40000,
            bonus: 10000,
        });
        expect(updated.totalAmount).toBe(50000);
    });

    it('updateSalary throws for unknown id', async () => {
        await expect(
            EmployeeService.updateSalary(new mongoose.Types.ObjectId().toString(), { amount: 1 })
        ).rejects.toThrow(/Salary record not found/i);
    });

    it('deleteSalary removes the record and throws when missing', async () => {
        const emp = await createEmployee();
        const salary: any = await EmployeeService.addSalary(addSalaryPayload(emp._id) as any);
        await EmployeeService.deleteSalary(salary._id.toString());
        expect(await SalaryModel.countDocuments({ _id: salary._id })).toBe(0);

        await expect(
            EmployeeService.deleteSalary(salary._id.toString())
        ).rejects.toThrow(/Salary record not found/i);
    });

    it('getAllSalariesAdmin filters by status', async () => {
        const emp = await createEmployee();
        const s: any = await EmployeeService.addSalary(addSalaryPayload(emp._id) as any);
        await EmployeeService.updateSalaryStatus(s._id.toString(), 'Paid');

        const paid: any = await EmployeeService.getAllSalariesAdmin({ status: 'Paid' });
        expect(paid.total).toBe(1);
        const pending: any = await EmployeeService.getAllSalariesAdmin({ status: 'Pending' });
        expect(pending.total).toBe(0);
    });
});

describe('EmployeeService leave requests', () => {
    it('addLeaveRequest creates a pending request', async () => {
        const emp = await createEmployee();
        const leave: any = await EmployeeService.addLeaveRequest(emp._id.toString(), {
            type: 'Sick Leave',
            from: new Date('2025-03-01'),
            to: new Date('2025-03-02'),
            reason: 'Flu',
        } as any);
        expect(leave.status).toBe('Pending');
        expect(leave.employeeName).toBe(emp.name);
    });

    it('addLeaveRequest rejects end date before start date', async () => {
        const emp = await createEmployee();
        await expect(
            EmployeeService.addLeaveRequest(emp._id.toString(), {
                type: 'Sick Leave',
                from: new Date('2025-03-05'),
                to: new Date('2025-03-01'),
                reason: 'Backwards',
            } as any)
        ).rejects.toThrow(/End date must be on or after start date/i);
    });

    it('addLeaveRequest throws for unknown employee', async () => {
        await expect(
            EmployeeService.addLeaveRequest(new mongoose.Types.ObjectId().toString(), {
                type: 'Sick Leave',
                from: new Date('2025-03-01'),
                to: new Date('2025-03-02'),
                reason: 'x',
            } as any)
        ).rejects.toThrow(/Employee not found/i);
    });

    it('getMyLeaveRequests filters by status', async () => {
        const emp = await createEmployee();
        await EmployeeService.addLeaveRequest(emp._id.toString(), {
            type: 'Vacation',
            from: new Date('2025-04-01'),
            to: new Date('2025-04-03'),
            reason: 'Trip',
        } as any);

        const all: any = await EmployeeService.getMyLeaveRequests(emp._id.toString(), {});
        expect(all.total).toBe(1);
        const approved: any = await EmployeeService.getMyLeaveRequests(emp._id.toString(), {
            status: 'Approved',
        });
        expect(approved.total).toBe(0);
    });

    it('updateLeaveStatus approves and admin list filters', async () => {
        const emp = await createEmployee();
        const leave: any = await EmployeeService.addLeaveRequest(emp._id.toString(), {
            type: 'Paid Leave',
            from: new Date('2025-05-01'),
            to: new Date('2025-05-02'),
            reason: 'Rest',
        } as any);

        const updated: any = await EmployeeService.updateLeaveStatus(leave._id.toString(), 'Approved');
        expect(updated.status).toBe('Approved');

        const adminList: any = await EmployeeService.getAllLeaveRequestsAdmin({ status: 'Approved' });
        expect(adminList.total).toBe(1);
    });

    it('updateLeaveStatus throws for unknown id', async () => {
        await expect(
            EmployeeService.updateLeaveStatus(new mongoose.Types.ObjectId().toString(), 'Approved')
        ).rejects.toThrow(/Leave request not found/i);
    });
});

describe('EmployeeService.getAllEmployees', () => {
    it('lists only employees and supports search', async () => {
        await createEmployee({ name: 'Sara Designer', email: `sara-${uniq()}@example.com` });
        await createEmployee({ name: 'Karim Dev', email: `karim-${uniq()}@example.com` });
        await createUser({ email: `learner-${uniq()}@example.com`, role: 'learner' });

        const all: any = await EmployeeService.getAllEmployees({});
        expect(all.total).toBe(2);

        const searched: any = await EmployeeService.getAllEmployees({ search: 'sara' });
        expect(searched.total).toBe(1);
        expect(searched.employees[0].name).toBe('Sara Designer');
    });

    it('merges extended profile fields', async () => {
        const emp = await createEmployee();
        await EmployeeService.updateMyProfile(emp._id.toString(), { designation: 'Mentor' });
        const all: any = await EmployeeService.getAllEmployees({});
        const found = all.employees.find((e: any) => e._id.toString() === emp._id.toString());
        expect(found.designation).toBe('Mentor');
    });
});

describe('EmployeeService.resolveNidPhotoUrl', () => {
    it('forbids employees from accessing documents they do not own', async () => {
        const emp = await createEmployee();
        await expect(
            EmployeeService.resolveNidPhotoUrl(
                { id: emp._id.toString(), role: Role.EMPLOYEE },
                'misun-academy/employees/nid/someone-else'
            )
        ).rejects.toThrow(/do not have access/i);
    });

    it('rejects empty publicId even for admins', async () => {
        const adminUser = await createUser({ email: `adm-${uniq()}@example.com`, role: 'admin' });
        await expect(
            EmployeeService.resolveNidPhotoUrl(
                { id: adminUser._id.toString(), role: Role.ADMIN },
                ''
            )
        ).rejects.toThrow();
    });

    it('lets an employee resolve their own NID photo ref', async () => {
        const emp = await createEmployee();
        const publicId = `misun-academy/employees/nid/nid-${uniq()}`;
        await EmployeeService.updateMyProfile(emp._id.toString(), {
            nidPhotoFrontUrl: publicId,
        } as any);
        const result = await EmployeeService.resolveNidPhotoUrl(
            { id: emp._id.toString(), role: Role.EMPLOYEE },
            publicId
        );
        expect(typeof result.url).toBe('string');
        expect(result.url.length).toBeGreaterThan(0);
    });

    void LeaveRequestModel;
});
