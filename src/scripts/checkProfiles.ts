import mongoose from 'mongoose';
import dotenv from 'dotenv';
import env from '../config/env.js';
import { ProfileModel } from '../modules/Profile/profile.model.js';

dotenv.config();

async function checkProfiles() {
  try {
    await mongoose.connect(env.MONGO_URI);
    console.log('Connected to DB');

    const profiles = await ProfileModel.find({}).populate('user', 'name email');
    console.log(`Found ${profiles.length} profiles:`);

    profiles.forEach((profile, index) => {
      const user = profile.user as any; // Type assertion for populated user
      console.log(`${index + 1}. User: ${user?.name} (${user?.email})`);
      console.log(`   Profile ID: ${profile._id}`);
      console.log(`   Created: ${profile.createdAt}`);
      console.log(`   Email notifications: ${profile.emailNotifications}`);
      console.log('');
    });

    await mongoose.disconnect();
    console.log('✅ Profile check completed');
  } catch (error) {
    console.error('Error:', error);
  }
}

checkProfiles();