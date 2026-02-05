import { Schema, model } from 'mongoose';

interface IEnrollmentCounter {
    _id: string; // batch ID
    count: number;
}

const enrollmentCounterSchema = new Schema<IEnrollmentCounter>(
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

export const EnrollmentCounterModel = model<IEnrollmentCounter>(
    'EnrollmentCounter',
    enrollmentCounterSchema
);
