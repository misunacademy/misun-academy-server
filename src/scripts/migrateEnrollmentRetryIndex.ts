import mongoose from 'mongoose';
import env from '../config/env.js';
import { EnrollmentModel } from '../modules/Enrollment/enrollment.model.js';
import { EnrollmentStatus } from '../types/common.js';

const INDEX_NAME = 'userId_1_batchId_1';
const RETRYABLE_UNIQUE_STATUSES = [
    EnrollmentStatus.Pending,
    EnrollmentStatus.PaymentPending,
    EnrollmentStatus.Active,
    EnrollmentStatus.Completed,
    EnrollmentStatus.Suspended,
];

const migrateEnrollmentRetryIndex = async () => {
    await mongoose.connect(env.MONGO_URI);

    try {
        const duplicateGroups = await EnrollmentModel.aggregate([
            {
                $match: {
                    status: { $in: RETRYABLE_UNIQUE_STATUSES },
                },
            },
            {
                $group: {
                    _id: { userId: '$userId', batchId: '$batchId' },
                    ids: { $push: '$_id' },
                    count: { $sum: 1 },
                },
            },
            { $match: { count: { $gt: 1 } } },
            { $limit: 20 },
        ]);

        if (duplicateGroups.length > 0) {
            throw new Error(
                `Cannot create retry index: ${duplicateGroups.length} duplicate active user/batch groups found. Resolve these records first: ${JSON.stringify(duplicateGroups)}`
            );
        }

        const indexes = await EnrollmentModel.collection.indexes();
        const currentIndex = indexes.find((index) => index.name === INDEX_NAME);
        if (currentIndex) {
            const isAlreadyPartial = JSON.stringify(currentIndex.partialFilterExpression) ===
                JSON.stringify({ status: { $in: RETRYABLE_UNIQUE_STATUSES } });

            if (!isAlreadyPartial) {
                await EnrollmentModel.collection.dropIndex(INDEX_NAME);
            } else {
                console.log('Enrollment retry index is already configured.');
                return;
            }
        }

        await EnrollmentModel.collection.createIndex(
            { userId: 1, batchId: 1 },
            {
                name: INDEX_NAME,
                unique: true,
                partialFilterExpression: {
                    status: { $in: RETRYABLE_UNIQUE_STATUSES },
                },
            }
        );

        console.log('Enrollment retry index migration completed.');
    } finally {
        await mongoose.disconnect();
    }
};

migrateEnrollmentRetryIndex().catch((error) => {
    console.error('Enrollment retry index migration failed:', error);
    process.exitCode = 1;
});
