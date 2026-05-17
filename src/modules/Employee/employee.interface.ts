import { Document, Types } from 'mongoose';

// ─── Employee Profile ─────────────────────────────────────────────────────────
// Stores employee-specific information in its own collection, linked by userId.

export interface IEmployeeProfile {
    userId: Types.ObjectId;    // reference to User._id
    whatsapp?: string;         // WhatsApp contact number
    bloodGroup?: string;       // e.g. "A+", "O-"
    nidNumber?: string;        // National ID card number
    nidPhotoUrl?: string;      // Cloudinary URL of the uploaded NID photo
}

export interface IEmployeeProfileDocument extends IEmployeeProfile, Document {}

// ─── Salary ───────────────────────────────────────────────────────────────────

export type SalaryStatus = 'Paid' | 'Pending';

export interface ISalary {
    employeeId: Types.ObjectId;
    employeeName: string;
    jobTitle: string;
    month: string;
    year: number;
    amount: number;          // gross salary
    bonus: number;           // bonus amount (default 0)
    totalAmount: number;     // amount + bonus (computed)
    paymentDate?: Date;
    status: SalaryStatus;
}

export interface ISalaryDocument extends ISalary, Document {}

// ─── Leave Request ────────────────────────────────────────────────────────────

export type LeaveType = 'Paid Leave' | 'Sick Leave' | 'Vacation' | 'Other';
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected';

export interface ILeaveRequest {
    employeeId: Types.ObjectId;
    employeeName: string;
    type: LeaveType;
    from: Date;
    to: Date;
    reason: string;
    status: LeaveStatus;
}

export interface ILeaveRequestDocument extends ILeaveRequest, Document {}
