import { Schema, model, Document } from 'mongoose';

export interface ISalary extends Document {
    employeeId: string;
    employeeName: string;
    jobTitle: string;
    month: string;
    year: number;
    amount: number;
    bonus: number;
    totalAmount: number;
    paymentDate?: Date;
    status: 'Paid' | 'Pending';
}

const salarySchema = new Schema<ISalary>(
    {
        employeeId: { type: String, required: true, index: true },
        employeeName: { type: String, required: true },
        jobTitle: { type: String, default: '' },
        month: { type: String, required: true },
        year: { type: Number, required: true },
        amount: { type: Number, required: true, default: 0 },
        bonus: { type: Number, default: 0 },
        totalAmount: { type: Number, required: true },
        paymentDate: { type: Date },
        status: { type: String, enum: ['Paid', 'Pending'], default: 'Pending' },
    },
    { timestamps: true }
);

export const SalaryModel = model<ISalary>('Salary', salarySchema);
