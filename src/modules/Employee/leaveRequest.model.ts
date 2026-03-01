import { Schema, model, Document } from 'mongoose';

export type LeaveType = 'Paid Leave' | 'Sick Leave' | 'Vacation' | 'Other';
export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected';

export interface ILeaveRequest extends Document {
    employeeId: string;
    employeeName: string;
    type: LeaveType;
    from: Date;
    to: Date;
    reason: string;
    status: LeaveStatus;
}

const leaveRequestSchema = new Schema<ILeaveRequest>(
    {
        employeeId: { type: String, required: true, index: true },
        employeeName: { type: String, required: true },
        type: {
            type: String,
            enum: ['Paid Leave', 'Sick Leave', 'Vacation', 'Other'],
            required: true,
        },
        from: { type: Date, required: true },
        to: { type: Date, required: true },
        reason: { type: String, required: true },
        status: {
            type: String,
            enum: ['Pending', 'Approved', 'Rejected'],
            default: 'Pending',
        },
    },
    { timestamps: true }
);

export const LeaveRequestModel = model<ILeaveRequest>('LeaveRequest', leaveRequestSchema);
