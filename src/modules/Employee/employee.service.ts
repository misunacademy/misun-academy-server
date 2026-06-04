import { StatusCodes } from 'http-status-codes';
import mongoose from 'mongoose';
import ApiError from '../../errors/ApiError.js';
import { UserModel } from '../User/user.model.js';
import { EmployeeProfileModel, SalaryModel, LeaveRequestModel } from './employee.model.js';
import { ISalary, ILeaveRequest } from './employee.interface.js';
import { Role } from '../../types/role.js';
import { logger } from '../../config/logger.js';
import { sendEmployeeSalaryPaidEmail } from '../../services/misunAcademyEmails.js';

// ─────────────────────────────────────────────────────────────────────────────
//  EMPLOYEE PROFILE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the employee's own profile (merged User base + EmployeeProfile extension)
 */
const getMyProfile = async (userId: string) => {
    const user = await UserModel.findById(userId)
        .select('name email phone address image avatar role status createdAt')
        .lean();
    if (!user) throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');

    const profile = await EmployeeProfileModel
        .findOne({ userId: new mongoose.Types.ObjectId(userId) })
        .lean();

    return {
        ...user,
        whatsapp:    profile?.whatsapp    ?? null,
        bloodGroup:  profile?.bloodGroup  ?? null,
        nidNumber:   profile?.nidNumber   ?? null,
        dateOfBirth: profile?.dateOfBirth ?? null,
        tshirtSize:  profile?.tshirtSize  ?? null,
        designation: profile?.designation ?? null,
        nidPhotoFrontUrl: profile?.nidPhotoFrontUrl ?? profile?.nidPhotoUrl ?? null,
        nidPhotoBackUrl:  profile?.nidPhotoBackUrl  ?? null,
        nidPhotoUrl: profile?.nidPhotoUrl ?? null,
    };
};

/**
 * Update the employee's own profile.
 * Base fields (name, phone, address) update the User document.
 * Extended fields (whatsapp, bloodGroup, nidNumber, dateOfBirth, tshirtSize, designation, nid photos) upsert EmployeeProfile.
 */
const updateMyProfile = async (
    userId: string,
    payload: {
        name?: string;
        phone?: string;
        address?: string;
        whatsapp?: string;
        bloodGroup?: string;
        nidNumber?: string;
        dateOfBirth?: string | Date | null;
        tshirtSize?: string | null;
        designation?: string | null;
        nidPhotoFrontUrl?: string | null;
        nidPhotoBackUrl?: string | null;
        nidPhotoUrl?: string;
    }
) => {
    const {
        name, phone, address, whatsapp, bloodGroup, nidNumber, nidPhotoUrl,
        dateOfBirth, tshirtSize, designation, nidPhotoFrontUrl, nidPhotoBackUrl,
    } = payload;

    // Update core User fields
    const userUpdate: Record<string, unknown> = {};
    if (name    !== undefined) userUpdate.name    = name;
    if (phone   !== undefined) userUpdate.phone   = phone;
    if (address !== undefined) userUpdate.address = address;

    if (Object.keys(userUpdate).length > 0) {
        await UserModel.findByIdAndUpdate(userId, userUpdate);
    }

    // Upsert EmployeeProfile extended fields
    const extUpdate: Record<string, unknown> = {};
    if (whatsapp    !== undefined) extUpdate.whatsapp    = whatsapp;
    if (bloodGroup  !== undefined) extUpdate.bloodGroup  = bloodGroup;
    if (nidNumber   !== undefined) extUpdate.nidNumber   = nidNumber;
    if (dateOfBirth !== undefined) extUpdate.dateOfBirth = dateOfBirth;
    if (tshirtSize  !== undefined) extUpdate.tshirtSize  = tshirtSize;
    if (designation !== undefined) extUpdate.designation = designation;
    if (nidPhotoFrontUrl !== undefined) extUpdate.nidPhotoFrontUrl = nidPhotoFrontUrl;
    if (nidPhotoBackUrl  !== undefined) extUpdate.nidPhotoBackUrl  = nidPhotoBackUrl;
    if (nidPhotoUrl !== undefined) extUpdate.nidPhotoUrl = nidPhotoUrl;

    if (Object.keys(extUpdate).length > 0) {
        await EmployeeProfileModel.findOneAndUpdate(
            { userId: new mongoose.Types.ObjectId(userId) },
            { $set: extUpdate },
            { upsert: true, new: true }
        );
    }

    return getMyProfile(userId);
};

// ─────────────────────────────────────────────────────────────────────────────
//  EMPLOYEE-FACING: SALARIES
// ─────────────────────────────────────────────────────────────────────────────

const getMySalaries = async (
    employeeId: string,
    query: { page?: number; limit?: number }
) => {
    const page  = Math.max(1, Number(query.page  ?? 1));
    const limit = Math.max(1, Number(query.limit ?? 10));
    const skip  = (page - 1) * limit;

    const filter = { employeeId: new mongoose.Types.ObjectId(employeeId) };

    const [salaries, total] = await Promise.all([
        SalaryModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        SalaryModel.countDocuments(filter),
    ]);

    return { salaries, total, page, totalPages: Math.ceil(total / limit) };
};

// ─────────────────────────────────────────────────────────────────────────────
//  EMPLOYEE-FACING: LEAVE REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

const getMyLeaveRequests = async (
    employeeId: string,
    query: { page?: number; limit?: number; status?: string }
) => {
    const page  = Math.max(1, Number(query.page  ?? 1));
    const limit = Math.max(1, Number(query.limit ?? 10));
    const skip  = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: any = { employeeId: new mongoose.Types.ObjectId(employeeId) };
    if (query.status && ['Pending', 'Approved', 'Rejected'].includes(query.status)) {
        filter.status = query.status;
    }

    const [requests, total] = await Promise.all([
        LeaveRequestModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        LeaveRequestModel.countDocuments(filter),
    ]);

    return { requests, total, page, totalPages: Math.ceil(total / limit) };
};

const addLeaveRequest = async (
    employeeId: string,
    payload: Pick<ILeaveRequest, 'type' | 'from' | 'to' | 'reason'>
) => {
    const employee = await UserModel.findById(employeeId).select('name').lean();
    if (!employee) throw new ApiError(StatusCodes.NOT_FOUND, 'Employee not found');

    if (new Date(payload.to) < new Date(payload.from)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'End date must be on or after start date');
    }

    return LeaveRequestModel.create({
        employeeId:   new mongoose.Types.ObjectId(employeeId),
        employeeName: employee.name,
        type:         payload.type,
        from:         payload.from,
        to:           payload.to,
        reason:       payload.reason,
    });
};

// ─────────────────────────────────────────────────────────────────────────────
//  ADMIN-FACING SERVICES
// ─────────────────────────────────────────────────────────────────────────────

const getAllEmployees = async (query: {
    page?: number; limit?: number; search?: string;
}) => {
    const page  = Math.max(1, Number(query.page  ?? 1));
    const limit = Math.max(1, Number(query.limit ?? 10));
    const skip  = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: any = { role: Role.EMPLOYEE };
    if (query.search) {
        const re = new RegExp(query.search, 'i');
        filter.$or = [{ name: re }, { email: re }];
    }

    const [users, total] = await Promise.all([
        UserModel.find(filter)
            .select('name email role status image phone address createdAt')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        UserModel.countDocuments(filter),
    ]);

    // Fetch corresponding extended profiles
    const userIds = users.map(u => u._id);
    const profiles = await EmployeeProfileModel.find({ userId: { $in: userIds } }).lean();

    // Merge base user data with extended profile
    const employees = users.map((u) => {
        const profile = profiles.find(p => p.userId.toString() === u._id.toString());
        return {
            ...u,
            whatsapp:    profile?.whatsapp    ?? null,
            bloodGroup:  profile?.bloodGroup  ?? null,
            nidNumber:   profile?.nidNumber   ?? null,
            dateOfBirth: profile?.dateOfBirth ?? null,
            tshirtSize:  profile?.tshirtSize  ?? null,
            designation: profile?.designation ?? null,
            nidPhotoFrontUrl: profile?.nidPhotoFrontUrl ?? profile?.nidPhotoUrl ?? null,
            nidPhotoBackUrl:  profile?.nidPhotoBackUrl  ?? null,
            nidPhotoUrl: profile?.nidPhotoUrl ?? null,
        };
    });

    return { employees, total, page, totalPages: Math.ceil(total / limit) };
};

const getAllSalariesAdmin = async (query: {
    page?: number; limit?: number; employeeId?: string; status?: string;
}) => {
    const page  = Math.max(1, Number(query.page  ?? 1));
    const limit = Math.max(1, Number(query.limit ?? 10));
    const skip  = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: any = {};
    if (query.employeeId) filter.employeeId = new mongoose.Types.ObjectId(query.employeeId);
    if (query.status && ['Paid', 'Pending'].includes(query.status)) filter.status = query.status;

    const [salaries, total] = await Promise.all([
        SalaryModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        SalaryModel.countDocuments(filter),
    ]);

    return { salaries, total, page, totalPages: Math.ceil(total / limit) };
};

const addSalary = async (payload: Omit<ISalary, 'totalAmount'>) => {
    const totalAmount = (payload.amount ?? 0) + (payload.bonus ?? 0);
    return SalaryModel.create({ ...payload, totalAmount });
};

const updateSalaryStatus = async (id: string, status: 'Paid' | 'Pending') => {
    const existing = await SalaryModel.findById(id).lean();
    if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, 'Salary record not found');

    if (existing.status === status) return existing;

    const salary = await SalaryModel.findByIdAndUpdate(id, { status }, { new: true }).lean();
    if (!salary) throw new ApiError(StatusCodes.NOT_FOUND, 'Salary record not found');

    if (status === 'Paid' && existing.status !== 'Paid') {
        try {
            const employee = await UserModel.findById(existing.employeeId)
                .select('name email')
                .lean();
            if (employee?.email) {
                await sendEmployeeSalaryPaidEmail({
                    email: employee.email,
                    name: employee.name || existing.employeeName || 'Employee',
                    salaryId: salary._id.toString(),
                    month: salary.month,
                    year: salary.year,
                    amount: salary.amount,
                    bonus: salary.bonus,
                    totalAmount: salary.totalAmount,
                    paymentDate: salary.paymentDate ?? null,
                    jobTitle: salary.jobTitle,
                });
            }
        } catch (error: unknown) {
            logger.error(`Failed to send salary paid email: ${(error as Error).message}`);
        }
    }

    return salary;
};

const updateSalary = async (
    id: string,
    payload: {
        jobTitle?: string;
        month?: string;
        year?: number;
        amount?: number;
        bonus?: number;
        paymentDate?: string;
        status?: 'Paid' | 'Pending';
    }
) => {
    // Use find + save so the pre('save') hook recalculates totalAmount
    const salary = await SalaryModel.findById(id);
    if (!salary) throw new ApiError(StatusCodes.NOT_FOUND, 'Salary record not found');

    const previousStatus = salary.status;

    if (payload.jobTitle    !== undefined) salary.jobTitle    = payload.jobTitle;
    if (payload.month       !== undefined) salary.month       = payload.month;
    if (payload.year        !== undefined) salary.year        = payload.year;
    if (payload.amount      !== undefined) salary.amount      = payload.amount;
    if (payload.bonus       !== undefined) salary.bonus       = payload.bonus;
    if (payload.status      !== undefined) salary.status      = payload.status;
    if (payload.paymentDate !== undefined) {
        salary.paymentDate = payload.paymentDate ? new Date(payload.paymentDate) : undefined;
    }

    const updated = await salary.save();

    // Send email if status flipped to Paid
    if (payload.status === 'Paid' && previousStatus !== 'Paid') {
        try {
            const employee = await UserModel.findById(salary.employeeId).select('name email').lean();
            if (employee?.email) {
                await sendEmployeeSalaryPaidEmail({
                    email:       employee.email,
                    name:        employee.name || salary.employeeName || 'Employee',
                    salaryId:    updated._id.toString(),
                    month:       updated.month,
                    year:        updated.year,
                    amount:      updated.amount,
                    bonus:       updated.bonus,
                    totalAmount: updated.totalAmount,
                    paymentDate: updated.paymentDate ?? null,
                    jobTitle:    updated.jobTitle,
                });
            }
        } catch (error: unknown) {
            logger.error(`Failed to send salary paid email: ${(error as Error).message}`);
        }
    }

    return updated;
};

const deleteSalary = async (id: string) => {
    const salary = await SalaryModel.findByIdAndDelete(id).lean();
    if (!salary) throw new ApiError(StatusCodes.NOT_FOUND, 'Salary record not found');
    return salary;
};

const getAllLeaveRequestsAdmin = async (query: {
    page?: number; limit?: number; status?: string;
}) => {
    const page  = Math.max(1, Number(query.page  ?? 1));
    const limit = Math.max(1, Number(query.limit ?? 10));
    const skip  = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: any = {};
    if (query.status && ['Pending', 'Approved', 'Rejected'].includes(query.status)) {
        filter.status = query.status;
    }

    const [requests, total] = await Promise.all([
        LeaveRequestModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        LeaveRequestModel.countDocuments(filter),
    ]);

    return { requests, total, page, totalPages: Math.ceil(total / limit) };
};

const updateLeaveStatus = async (id: string, status: 'Approved' | 'Rejected') => {
    const leave = await LeaveRequestModel.findByIdAndUpdate(id, { status }, { new: true }).lean();
    if (!leave) throw new ApiError(StatusCodes.NOT_FOUND, 'Leave request not found');
    return leave;
};

// ─────────────────────────────────────────────────────────────────────────────
export const EmployeeService = {
    // Profile
    getMyProfile,
    updateMyProfile,
    // Salaries (employee)
    getMySalaries,
    // Leave (employee)
    getMyLeaveRequests,
    addLeaveRequest,
    // Admin
    getAllEmployees,
    getAllSalariesAdmin,
    addSalary,
    updateSalaryStatus,
    updateSalary,
    deleteSalary,
    getAllLeaveRequestsAdmin,
    updateLeaveStatus,
};
