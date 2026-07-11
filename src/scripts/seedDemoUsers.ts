import 'dotenv/config.js';
import mongoose from 'mongoose';
import { UserModel } from '../modules/User/user.model.js';
import { Role } from '../types/role.js';
import { UserStatus } from '../types/common.js';
import { connectDB } from '../config/database.js';
import { getAuth } from '../config/betterAuth.js';

const DEMO_USERS = [
    { name: 'Rafiq Hasan', email: 'rafiq.hasan23@gmail.com', password: 'demo123456', role: Role.ADMIN },
    { name: 'Nusrat Jahan', email: 'nusrat.jahan23@gmail.com', password: 'demo123456', role: Role.ADMIN },
    { name: 'Tanvir Ahmed', email: 'tanvir.ahmed.instructor@gmail.com', password: 'demo123456', role: Role.INSTRUCTOR },
    { name: 'Farzana Akter', email: 'farzana.akter.instructor@gmail.com', password: 'demo123456', role: Role.INSTRUCTOR },
    { name: 'Hasan Mahmud', email: 'hasan.mahmud.instructor@gmail.com', password: 'demo123456', role: Role.INSTRUCTOR },
    { name: 'Shamima Sultana', email: 'shamima.sultana.instructor@gmail.com', password: 'demo123456', role: Role.INSTRUCTOR },
    { name: 'Rakib Hossain', email: 'rakib.hossain.emp@gmail.com', password: 'demo123456', role: Role.EMPLOYEE },
    { name: 'Sabina Yasmin', email: 'sabina.yasmin.emp@gmail.com', password: 'demo123456', role: Role.EMPLOYEE },
    { name: 'Abdur Rahman', email: 'abdur.rahman01@gmail.com', password: 'demo123456', role: Role.LEARNER },
    { name: 'Fatima Begum', email: 'fatima.begum02@gmail.com', password: 'demo123456', role: Role.LEARNER },
    { name: 'Jahidul Islam', email: 'jahidul.islam03@gmail.com', password: 'demo123456', role: Role.LEARNER },
    { name: 'Shahnaz Parvin', email: 'shahnaz.parvin04@gmail.com', password: 'demo123456', role: Role.LEARNER },
    { name: 'Mehedi Hasan', email: 'mehedi.hasan05@gmail.com', password: 'demo123456', role: Role.LEARNER },
    { name: 'Nasrin Akter', email: 'nasrin.akter06@gmail.com', password: 'demo123456', role: Role.LEARNER },
    { name: 'Sabbir Khan', email: 'sabbir.khan07@gmail.com', password: 'demo123456', role: Role.LEARNER },
    { name: 'Tahmina Begum', email: 'tahmina.begum08@gmail.com', password: 'demo123456', role: Role.LEARNER },
    { name: 'Shahidul Alam', email: 'shahidul.alam09@gmail.com', password: 'demo123456', role: Role.LEARNER },
    { name: 'Rokeya Khatun', email: 'rokeya.khatun10@gmail.com', password: 'demo123456', role: Role.LEARNER },
    { name: 'Mizanur Rahman', email: 'mizanur.rahman11@gmail.com', password: 'demo123456', role: Role.LEARNER },
    { name: 'Sharmin Akhter', email: 'sharmin.akhter12@gmail.com', password: 'demo123456', role: Role.LEARNER },
];

const seedDemoUsers = async () => {
    try {
        await connectDB();

        const auth = getAuth();

        for (const user of DEMO_USERS) {
            try {
                await auth.api.signUpEmail({
                    body: {
                        name: user.name,
                        email: user.email,
                        password: user.password,
                        asResponse: false,
                    },
                });
            } catch (err: any) {
                const msg = err?.body?.message || err?.message || '';
                if (msg.includes('User already exists')) {
                    console.log(`  ↪ ${user.email} already exists`);
                } else {
                    throw err;
                }
            }

            await UserModel.findOneAndUpdate(
                { email: user.email },
                {
                    role: user.role,
                    status: UserStatus.Active,
                    emailVerified: true,
                },
            );

            console.log(`  ✓ ${user.email} (${user.role})`);
        }

        console.log('\n✅ 20 demo users seeded successfully');
        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Failed to seed demo users:', error);
        await mongoose.disconnect();
        process.exit(1);
    }
};

seedDemoUsers();
