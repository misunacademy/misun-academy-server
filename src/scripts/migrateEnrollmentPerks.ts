import mongoose from 'mongoose';
import env from '../config/env.js';
import { EnrollmentPerkRuleModel } from '../modules/EnrollmentPerk/enrollmentPerkRule.model.js';
import { PerkGrantModel } from '../modules/EnrollmentPerk/perkGrant.model.js';
import { EnrollmentModel } from '../modules/Enrollment/enrollment.model.js';

const migrateEnrollmentPerks = async () => {
    console.log('Connecting to MongoDB for Enrollment Perks migration...');
    await mongoose.connect(env.MONGO_URI);

    try {
        console.log('Creating collections and syncing indexes for Enrollment Perks...');
        await Promise.all([
            EnrollmentPerkRuleModel.createCollection().catch(() => {}),
            PerkGrantModel.createCollection().catch(() => {}),
        ]);

        await Promise.all([
            EnrollmentPerkRuleModel.syncIndexes(),
            PerkGrantModel.syncIndexes(),
            EnrollmentModel.syncIndexes(),
        ]);

        console.log('Enrollment Perks migration completed successfully.');
    } finally {
        await mongoose.disconnect();
    }
};

migrateEnrollmentPerks().catch((error) => {
    console.error('Enrollment Perks migration failed:', error);
    process.exitCode = 1;
});
