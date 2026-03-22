import mongoose from 'mongoose';
import dotenv from 'dotenv';
import env from '../config/env';
import { UserModel } from '../modules/User/user.model';
import { ProfileService } from '../modules/Profile/profile.service';

dotenv.config();

export const createProfilesForExistingUsers = async () => {
    try {
        await mongoose.connect(env.MONGO_URI);
        console.log('Connected to DB');

        // Find all users
        const users = await UserModel.find({}, '_id name email');
        console.log(`Found ${users.length} users`);

        let profilesCreated = 0;
        let profilesSkipped = 0;

        for (const user of users) {
            try {
                // Check if profile already exists
                const existingProfile = await ProfileService.getProfile(user._id.toString());

                if (!existingProfile) {
                    // Create profile for user
                    await ProfileService.createProfile(user._id.toString(), {
                        emailNotifications: true,
                        pushNotifications: true,
                        courseReminders: true,
                        profileVisibility: true,
                    });
                    profilesCreated++;
                    console.log(`Created profile for user: ${user.email}`);
                } else {
                    profilesSkipped++;
                }
            } catch (error) {
                console.error(`Failed to create profile for user ${user.email}:`, error);
            }
        }

        console.log(`✅ Profile creation completed:`);
        console.log(`   - Profiles created: ${profilesCreated}`);
        console.log(`   - Profiles skipped (already exist): ${profilesSkipped}`);
        console.log(`   - Total users processed: ${users.length}`);

        process.exit(0);
    } catch (error) {
        console.error('Failed to create profiles for existing users', error);
        process.exit(1);
    }
};

if (require.main === module) {
    createProfilesForExistingUsers();
}