import mongoose from 'mongoose';
import env from '../config/env.js';
import { PaymentModel } from '../modules/Payment/payment.model.js';

const INDEX_NAME = 'enrollmentId_1';

const migratePaymentEnrollmentIndex = async () => {
    await mongoose.connect(env.MONGO_URI);

    try {
        const duplicateGroups = await PaymentModel.aggregate([
            { $match: { enrollmentId: { $exists: true, $ne: null } } },
            {
                $group: {
                    _id: '$enrollmentId',
                    ids: { $push: '$_id' },
                    count: { $sum: 1 },
                },
            },
            { $match: { count: { $gt: 1 } } },
            { $limit: 20 },
        ]);

        if (duplicateGroups.length > 0) {
            throw new Error(
                `Cannot create payment enrollment index: duplicate enrollmentId values found. Resolve these records first: ${JSON.stringify(duplicateGroups)}`
            );
        }

        const indexes = await PaymentModel.collection.indexes();
        const currentIndex = indexes.find((index) => index.name === INDEX_NAME);

        if (currentIndex) {
            if (currentIndex.unique === true && currentIndex.sparse === true) {
                console.log('Payment enrollment index is already configured.');
                return;
            }
            await PaymentModel.collection.dropIndex(INDEX_NAME);
        }

        await PaymentModel.collection.createIndex(
            { enrollmentId: 1 },
            { name: INDEX_NAME, unique: true, sparse: true }
        );

        console.log('Payment enrollment index migration completed.');
    } finally {
        await mongoose.disconnect();
    }
};

migratePaymentEnrollmentIndex().catch((error) => {
    console.error('Payment enrollment index migration failed:', error);
    process.exitCode = 1;
});
