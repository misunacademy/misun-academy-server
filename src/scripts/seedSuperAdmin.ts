import 'dotenv/config';
import mongoose from 'mongoose';
import { AdminModel } from '../modules/Admin/admin.model';
import { UserModel } from '../modules/User/user.model';
import { Role } from '../types/role';
import env from '../config/env';
import { connectDB } from '../config/database';

export const seedSuperAdmin = async () => {
    try {
        await connectDB();

        // Ensure Admin collection has the super admin
        const existingAdmin = await AdminModel.findOne({ email: env.SUPER_ADMIN_EMAIL });
        if (!existingAdmin) {
            await AdminModel.create({
                name: 'Super Admin',
                email: env.SUPER_ADMIN_EMAIL,
                password: env.SUPER_ADMIN_PASSWORD, // hashed in pre-save hook
                emailVerified:true,
                role: Role.SUPERADMIN,
            });
            console.log('✅ Super Admin created in Admin collection');
        } else {
            console.log('Super Admin already exists in Admin collection');
        }

        // Also ensure a matching User document exists so normal /auth/login works
        const existingUser = await UserModel.findOne({ email: env.SUPER_ADMIN_EMAIL });
        if (!existingUser) {
            await UserModel.create({
                name: 'Super Admin',
                email: env.SUPER_ADMIN_EMAIL,
                password: env.SUPER_ADMIN_PASSWORD,
                role: Role.SUPERADMIN,
                status: 'active',
                emailVerified: true,
            });
            console.log('✅ Super Admin created in User collection');
        } else {
            console.log('Super Admin already exists in User collection');
        }

        console.log('✅ Seeding complete');
        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('❌ Failed to seed Super Admin:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
};

// Allow running directly with ts-node
seedSuperAdmin();
