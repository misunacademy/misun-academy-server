import mongoose from 'mongoose';
import { LessonModel } from '../modules/Lesson/lesson.model.js';
import { normalizeVideoId } from '../utils/video.utils.js';
import config from '../config/env.js';

/**
 * One-off repair for lessons created before video-id normalization:
 * strips full/pasted URLs (and double-wrapped watch?v=<url>) in `videoId`
 * down to raw ids and drops stale `videoUrl`s built from the wrapped value.
 */
const backfillVideoIds = async () => {
    try {
        await mongoose.connect(config.MONGO_URI);
        console.log('Connected to database');

        const lessons = await LessonModel.find({ videoId: { $exists: true, $ne: '' } }).lean();
        let fixed = 0;
        for (const lesson of lessons) {
            const raw = (lesson as any).videoId;
            if (typeof raw !== 'string' || !raw) continue;
            const normalized = normalizeVideoId((lesson as any).videoSource, raw);
            if (normalized && normalized !== raw) {
                await LessonModel.findByIdAndUpdate((lesson as any)._id, {
                    $set: { videoId: normalized },
                    $unset: { videoUrl: '' },
                });
                fixed++;
                console.log(`Fixed lesson ${(lesson as any)._id} (${(lesson as any).title})`);
            }
        }

        console.log(`Backfill completed. Repaired ${fixed}/${lessons.length} lessons.`);
        await mongoose.disconnect();
    } catch (error) {
        console.error('Backfill failed:', error);
        process.exit(1);
    }
};

backfillVideoIds();
