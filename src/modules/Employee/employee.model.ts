import { Schema, model } from 'mongoose';
import {
    IEmployeeProfileDocument,
    ISalaryDocument,
    ILeaveRequestDocument,
} from './employee.interface.js';

// ─── Employee Profile Schema ──────────────────────────────────────────────────

const employeeProfileSchema = new Schema<IEmployeeProfileDocument>(
    {
        userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
        whatsapp:    { type: String, trim: true },
        bloodGroup:  { type: String, trim: true },
        nidNumber:   { type: String, trim: true },
        dateOfBirth: { type: Date },
        tshirtSize:  { type: String, trim: true },
        designation: { type: String, trim: true },
        nidPhotoFrontUrl: { type: String },
        nidPhotoBackUrl:  { type: String },
        nidPhotoUrl: { type: String },
    },
    { timestamps: true }
);

// ─── Salary Schema ────────────────────────────────────────────────────────────

const salarySchema = new Schema<ISalaryDocument>(
    {
        employeeId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
        employeeName: { type: String, required: true },
        jobTitle:     { type: String, required: true },
        month:        { type: String, required: true },
        year:         { type: Number, required: true },
        amount:       { type: Number, required: true, min: 0 },
        bonus:        { type: Number, default: 0, min: 0 },
        totalAmount:  { type: Number, required: true, min: 0 },
        paymentDate:  { type: Date },
        status: {
            type: String,
            enum: ['Paid', 'Pending'],
            default: 'Pending',
        },
    },
    { timestamps: true }
);

salarySchema.pre('save', function (next) {
    this.totalAmount = (this.amount ?? 0) + (this.bonus ?? 0);
    next();
});

// ─── Leave Request Schema ─────────────────────────────────────────────────────

const leaveRequestSchema = new Schema<ILeaveRequestDocument>(
    {
        employeeId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
        employeeName: { type: String, required: true },
        type: {
            type: String,
            enum: ['Paid Leave', 'Sick Leave', 'Vacation', 'Other'],
            required: true,
        },
        from:   { type: Date, required: true },
        to:     { type: Date, required: true },
        reason: { type: String, required: true, trim: true },
        status: {
            type: String,
            enum: ['Pending', 'Approved', 'Rejected'],
            default: 'Pending',
        },
    },
    { timestamps: true }
);

// ─── Exports ──────────────────────────────────────────────────────────────────

export const EmployeeProfileModel = model<IEmployeeProfileDocument>('EmployeeProfile', employeeProfileSchema);
export const SalaryModel          = model<ISalaryDocument>('Salary', salarySchema);
export const LeaveRequestModel    = model<ILeaveRequestDocument>('LeaveRequest', leaveRequestSchema);
