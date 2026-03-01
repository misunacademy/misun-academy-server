import { SalaryModel } from './salary.model';
import { LeaveRequestModel } from './leaveRequest.model';
import { UserModel } from '../User/user.model';
import { Role } from '../../types/role';

// ─── EMPLOYEE-SIDE SERVICES ────────────────────────────────────────────────

/** Get paginated salary records for the logged-in employee */
const getMySalaries = async (employeeId: string, page: number, limit: number) => {
    const skip = (page - 1) * limit;
    const [salaries, total] = await Promise.all([
        SalaryModel.find({ employeeId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        SalaryModel.countDocuments({ employeeId }),
    ]);
    return { salaries, total, totalPages: Math.ceil(total / limit), page };
};

/** Get paginated leave requests for the logged-in employee */
const getMyLeaveRequests = async (employeeId: string, page: number, limit: number) => {
    const skip = (page - 1) * limit;
    const [requests, total] = await Promise.all([
        LeaveRequestModel.find({ employeeId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        LeaveRequestModel.countDocuments({ employeeId }),
    ]);
    return { requests, total, totalPages: Math.ceil(total / limit), page };
};

/** Submit a new leave request */
const addLeaveRequest = async (employeeId: string, employeeName: string, data: {
    type: string; from: string; to: string; reason: string;
}) => {
    const request = await LeaveRequestModel.create({
        employeeId,
        employeeName,
        type: data.type,
        from: new Date(data.from),
        to: new Date(data.to),
        reason: data.reason,
        status: 'Pending',
    });
    return request;
};

// ─── ADMIN-SIDE SERVICES ───────────────────────────────────────────────────

/** Get all employees (users with role=employee), paginated */
const getAllEmployees = async (page: number, limit: number, search?: string) => {
    const query: Record<string, unknown> = { role: Role.EMPLOYEE };
    if (search) {
        query.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
        ];
    }
    const skip = (page - 1) * limit;
    const [employees, total] = await Promise.all([
        UserModel.find(query).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        UserModel.countDocuments(query),
    ]);
    return { employees, total, totalPages: Math.ceil(total / limit), page };
};

/** Get all salary records across all employees (admin view), paginated */
const getAllSalaries = async (page: number, limit: number, employeeId?: string, status?: string) => {
    const query: Record<string, unknown> = {};
    if (employeeId) query.employeeId = employeeId;
    if (status) query.status = status;
    const skip = (page - 1) * limit;
    const [salaries, total] = await Promise.all([
        SalaryModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        SalaryModel.countDocuments(query),
    ]);
    return { salaries, total, totalPages: Math.ceil(total / limit), page };
};

/** Create a salary record (admin only) */
const createSalary = async (data: {
    employeeId: string; employeeName: string; jobTitle: string;
    month: string; year: number; amount: number; bonus: number; paymentDate?: string;
}) => {
    const totalAmount = data.amount + (data.bonus ?? 0);
    const salary = await SalaryModel.create({
        ...data,
        totalAmount,
        paymentDate: data.paymentDate ? new Date(data.paymentDate) : undefined,
        status: 'Pending',
    });
    return salary;
};

/** Mark salary as Paid or Pending (admin only) */
const updateSalaryStatus = async (id: string, status: 'Paid' | 'Pending') => {
    const salary = await SalaryModel.findByIdAndUpdate(
        id,
        { status, ...(status === 'Paid' ? { paymentDate: new Date() } : {}) },
        { new: true }
    );
    return salary;
};

/** Get all leave requests (admin view), paginated with filters */
const getAllLeaveRequests = async (page: number, limit: number, status?: string) => {
    const query: Record<string, unknown> = {};
    if (status) query.status = status;
    const skip = (page - 1) * limit;
    const [requests, total] = await Promise.all([
        LeaveRequestModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        LeaveRequestModel.countDocuments(query),
    ]);
    return { requests, total, totalPages: Math.ceil(total / limit), page };
};

/** Approve or reject a leave request (admin only) */
const updateLeaveStatus = async (id: string, status: 'Approved' | 'Rejected') => {
    const request = await LeaveRequestModel.findByIdAndUpdate(id, { status }, { new: true });
    return request;
};

export const EmployeeService = {
    getMySalaries,
    getMyLeaveRequests,
    addLeaveRequest,
    getAllEmployees,
    getAllSalaries,
    createSalary,
    updateSalaryStatus,
    getAllLeaveRequests,
    updateLeaveStatus,
};
