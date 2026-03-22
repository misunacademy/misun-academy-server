import { Schema, model } from 'mongoose';

interface IStudentIdCounter {
    _id: string; // Year
    count: number;
}

const studentIdCounterSchema = new Schema<IStudentIdCounter>(
    {
        _id: {
            type: String,
            required: true,
        },
        count: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    }
);

export const StudentIdCounterModel = model<IStudentIdCounter>(
    'StudentIdCounter',
    studentIdCounterSchema
);
