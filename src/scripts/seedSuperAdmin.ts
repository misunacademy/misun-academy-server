import 'dotenv/config.js';
import mongoose from 'mongoose';
import { UserModel } from '../modules/User/user.model.js';
import { Role } from '../types/role.js';
import env from '../config/env.js';
import { connectDB } from '../config/database.js';
import { getAuth } from '../config/betterAuth.js';
import ApiError from '../errors/ApiError.js';
import { StatusCodes } from 'http-status-codes';
import { UserStatus } from '../types/common.js';

export const seedSuperAdmin = async () => {
    try {
        await connectDB();

        const auth = getAuth();

        try {
            await auth.api.signUpEmail({
                body: {
                    name: 'Super Admin',
                    email: env.SUPER_ADMIN_EMAIL,
                    password: env.SUPER_ADMIN_PASSWORD,
                    asResponse: false,
                }
            });
        } catch (err: any) {
            const msg = err?.body?.message || err?.message || 'Failed to create user';
            if (msg.includes('User already exists')) {
                console.log('Super Admin already exists in Better Auth, proceeding to update metadata...');
            } else {
                throw new ApiError(StatusCodes.BAD_REQUEST, msg);
            }
        }

        const userPayload: Record<string, any> = {
            name: 'Super Admin',
            email: env.SUPER_ADMIN_EMAIL,
            emailVerified: true,
            status: UserStatus.Active,
            role: Role.SUPERADMIN,
        };

        // Persist local user metadata for the newly created auth account
        let localUser = await UserModel.findOne({ email: env.SUPER_ADMIN_EMAIL }).select('-password').lean();

        if (localUser) {
            localUser = await UserModel.findByIdAndUpdate(
                localUser._id,
                userPayload,
                { new: true, runValidators: true },
            )
                .select('-password')
                .lean();
        } else {
            const createdLocalUser = await UserModel.create(userPayload);
            localUser = await UserModel.findById(createdLocalUser._id).select('-password').lean();
        }

        if (!localUser) {
            throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'User creation failed after auth registration');
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
