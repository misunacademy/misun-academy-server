import mongoose from 'mongoose';
import { UserModel } from '../modules/User/user.model.js';
import config from '../config/env.js';

const migrateEmailVerification = async () => {
    try {
        await mongoose.connect(config.MONGO_URI);
        console.log('Connected to database');

        // Update all users to set emailVerified to true
        const result = await UserModel.updateMany(
            { emailVerified: { $ne: true } }, // Only update if not already true
            { $set: { emailVerified: true } }
        );

        console.log(`Migration completed. Updated ${result.modifiedCount} users.`);

        await mongoose.disconnect();
        console.log('Disconnected from database');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrateEmailVerification();