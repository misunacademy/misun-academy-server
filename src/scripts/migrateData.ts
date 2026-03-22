import mongoose from 'mongoose';
import dotenv from 'dotenv';
import env from '../config/env';
import { CourseModel } from '../modules/Course/course.model';
import { BatchModel } from '../modules/Batch/batch.model';
import { EnrollmentModel } from '../modules/Enrollment/enrollment.model';

dotenv.config();

export const migrateData = async () => {
    try {
        await mongoose.connect(env.MONGO_URI);
        console.log('Connected to DB');

        // 1. Find or create a default course for existing data
        let defaultCourse = await CourseModel.findOne({ title: 'Complete Graphic Design With Freelancing' });

        if (!defaultCourse) {
            defaultCourse = await CourseModel.create({
                title: 'Complete Graphic Design With Freelancing',
                slug: 'complete-graphic-design-with-freelancing',
                courseCode: 'CGD-001',
                subtitle: 'From Beginner to Professional Designer',
                description: 'Complete course on graphic design and freelancing',
                shortDescription: 'Learn graphic design from basics to advanced',
                instructor: {
                    name: 'Mithun Sarkar',
                    email: 'instructor@misunacademy.com'
                },
                category: 'Design',
                level: 'Beginner',
                language: 'English',
                duration: {
                    hours: 50,
                    weeks: 12
                },
                pricing: {
                    amount: 4000,
                    currency: 'BDT'
                },
                enrollment: {
                    capacity: 50,
                    status: 'open'
                },
                isPublished: true,
                isFeatured: true
            });
            console.log('Created default course');
        }

        // 2. Update all existing batches to reference the default course
        const batchUpdateResult = await BatchModel.updateMany(
            { course: { $exists: false } }, // Only update batches without course reference
            { $set: { course: defaultCourse._id } }
        );
        console.log(`Updated ${batchUpdateResult.modifiedCount} batches with course reference`);

        // 3. Update all existing enrollments to reference the default course
        const enrollmentUpdateResult = await EnrollmentModel.updateMany(
            { course: { $exists: false } }, // Only update enrollments without course reference
            { $set: { course: defaultCourse._id } }
        );
        console.log(`Updated ${enrollmentUpdateResult.modifiedCount} enrollments with course reference`);

        console.log('✅ Data migration completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Failed to migrate data', error);
        process.exit(1);
    }
};

if (require.main === module) {
    migrateData();
}