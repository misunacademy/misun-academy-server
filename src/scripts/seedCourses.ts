import mongoose from 'mongoose';
import dotenv from 'dotenv';
import env from '../config/env.js';
import { CourseModel } from '../modules/Course/course.model.js';

dotenv.config();

export const seedCourses = async () => {
    try {
        await mongoose.connect(env.MONGO_URI);
        console.log('Connected to DB');

        // Try to require the client mock file
        // Note: this file is TypeScript but our dev environment uses ts-node so `require` should work.
        // Fallback: if not found, skip.
        let courses: any[] = [];
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            // courses = require('D:/projects/misun academy/misun-academy-client/src/data/mockCourse.ts').default || require('D:/projects/misun academy/misun-academy-client/src/data/mockCourse.ts');
        } catch (err) {
            console.warn('Could not load mockCourse from client; please provide data or copy it to server:', err);
        }

        if (!courses || !courses.length) {
            console.warn('No courses to seed');
            process.exit(0);
        }

        for (const c of courses) {
            const exists = await CourseModel.findOne({ slug: c.courseCode || c.id || c.title });
            if (!exists) {
                await CourseModel.create({
                    title: c.title,
                    slug: (c.courseCode || c.id || c.title).toString().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                    courseCode: c.courseCode,
                    subtitle: c.subtitle,
                    description: c.description,
                    shortDescription: c.shortDescription,
                    instructor: c.instructor,
                    category: c.category,
                    subcategory: c.subcategory,
                    level: c.level,
                    language: c.language,
                    duration: c.duration,
                    pricing: c.pricing,
                    enrollment: c.enrollment,
                    curriculum: c.curriculum,
                    tags: c.tags,
                    thumbnailImage: c.media?.thumbnail || c.thumbnail,
                    coverImage: c.media?.coverImage || c.coverImage,
                    // Map client mock fields to server schema
                    status: (c.status?.isPublished ?? true) ? 'published' : 'draft',
                    featured: c.status?.isFeatured || false,
                });
                console.log('Seeded course:', c.title);
            }
        }

        console.log('✅ Courses seeded');
        process.exit(0);
    } catch (error) {
        console.error('Failed to seed courses', error);
        process.exit(1);
    }
};

if (require.main === module) {
    seedCourses();
}
