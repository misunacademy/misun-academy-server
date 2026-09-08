import { FilterQuery, Types } from 'mongoose';
import ApiError from '../../errors/ApiError.js';
import { StatusCodes } from 'http-status-codes';
import { BootcampCatalogModel } from './bootcampCatalog.model.js';
import {
    BootcampStatus,
    RecordedStatus,
    IBootcampCatalog,
} from './bootcampCatalog.interface.js';
import { CourseModel } from '../Course/course.model.js';
import { BatchModel } from '../Batch/batch.model.js';
import { ModuleModel } from '../Module/module.model.js';
import { LessonModel } from '../Lesson/lesson.model.js';
import { RecordingModel } from '../Recording/recording.model.js';
import { BatchStatus } from '../../types/common.js';
import { recordAudit } from '../../models/auditLog.model.js';

const slugify = (value: string): string =>
    value
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');

const toCard = (b: any) => ({
    _id: b._id,
    title: b.title,
    season: b.season,
    slug: b.slug,
    tagline: b.tagline,
    thumbnail: b.thumbnail,
    posterImage: b.posterImage,
    recordedPrice: b.recordedPrice,
    lessonsCount: b.lessonsCount ?? 0,
    durationMinutes: b.durationMinutes ?? 0,
    status: b.status,
});

const getCurrentBootcamp = async () => {
    const current = await BootcampCatalogModel.findOne({
        status: { $in: [BootcampStatus.Upcoming, BootcampStatus.Live] },
    })
        .sort({ startDate: 1, createdAt: -1 })
        .lean();
    return current;
};

const getPastBootcamps = async () => {
    const past = await BootcampCatalogModel.find({
        status: { $in: [BootcampStatus.Completed, BootcampStatus.Archived] },
        recordedStatus: RecordedStatus.Published,
    })
        .sort({ endDate: -1, createdAt: -1 })
        .lean();
    return past.map(toCard);
};

const getBootcampBySlug = async (slug: string) => {
    const bootcamp = await BootcampCatalogModel.findOne({ slug: slug.toLowerCase() })
        .populate('recordedCourseId', 'title slug thumbnailImage shortDescription')
        .lean();
    if (
        !bootcamp ||
        bootcamp.status === BootcampStatus.Draft ||
        bootcamp.status === BootcampStatus.Archived ||
        bootcamp.recordedStatus !== RecordedStatus.Published
    ) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp not found');
    }
    return bootcamp;
};

const createBootcamp = async (
    payload: Partial<IBootcampCatalog>,
    actor: { id: string; role?: string }
) => {
    if (!payload.title || !payload.season) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Title and season are required');
    }
    const slug = payload.slug ? slugify(payload.slug) : slugify(`${payload.title} ${payload.season}`);
    const existing = await BootcampCatalogModel.findOne({ slug }).lean();
    if (existing) {
        throw new ApiError(StatusCodes.CONFLICT, 'A bootcamp with this slug already exists');
    }
    const created = await BootcampCatalogModel.create({
        ...payload,
        slug,
        createdBy: new Types.ObjectId(actor.id),
    });
    await recordAudit({
        actor: actor.id,
        actorRole: actor.role,
        action: 'bootcamp.create',
        targetType: 'Bootcamp',
        targetId: created._id.toString(),
        metadata: { slug, title: created.title },
    });
    return created;
};

const updateBootcamp = async (
    id: string,
    payload: Partial<IBootcampCatalog>,
    actor: { id: string; role?: string }
) => {
    const bootcamp: any = await BootcampCatalogModel.findById(id);
    if (!bootcamp) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp not found');
    }
    if (payload.slug && payload.slug !== bootcamp.slug) {
        const slug = slugify(payload.slug);
        const clash = await BootcampCatalogModel.findOne({ slug, _id: { $ne: id } }).lean();
        if (clash) {
            throw new ApiError(StatusCodes.CONFLICT, 'A bootcamp with this slug already exists');
        }
        payload.slug = slug;
    }
    Object.assign(bootcamp, payload);
    await bootcamp.save();

    if (
        typeof payload.recordedPrice === 'number' &&
        bootcamp.recordedBatchId
    ) {
        await BatchModel.findByIdAndUpdate(bootcamp.recordedBatchId, {
            price: payload.recordedPrice,
            manualPaymentPrice: payload.recordedPrice,
        });
    }

    await recordAudit({
        actor: actor.id,
        actorRole: actor.role,
        action: 'bootcamp.update',
        targetType: 'Bootcamp',
        targetId: id,
        metadata: { slug: bootcamp.slug },
    });
    return bootcamp;
};

const setRecordedPrice = async (
    id: string,
    recordedPrice: number,
    actor: { id: string; role?: string }
) => {
    if (typeof recordedPrice !== 'number' || recordedPrice < 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Recorded price must be a non-negative number');
    }
    const bootcamp: any = await BootcampCatalogModel.findById(id);
    if (!bootcamp) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp not found');
    }
    bootcamp.recordedPrice = recordedPrice;
    await bootcamp.save();

    if (bootcamp.recordedBatchId) {
        await BatchModel.findByIdAndUpdate(bootcamp.recordedBatchId, {
            price: recordedPrice,
            manualPaymentPrice: recordedPrice,
        });
    }

    await recordAudit({
        actor: actor.id,
        actorRole: actor.role,
        action: 'bootcamp.price_change',
        targetType: 'Bootcamp',
        targetId: id,
        metadata: { recordedPrice },
    });
    return bootcamp;
};

const publishRecording = async (
    id: string,
    actor: { id: string; role?: string },
    opts: { sourceBatchId?: string; recordedPrice?: number } = {}
) => {
    const bootcamp: any = await BootcampCatalogModel.findById(id);
    if (!bootcamp) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp not found');
    }

    const price =
        typeof opts.recordedPrice === 'number' ? opts.recordedPrice : bootcamp.recordedPrice ?? 0;

    let course: any = null;
    if (bootcamp.recordedCourseId) {
        course = await CourseModel.findById(bootcamp.recordedCourseId);
    }
    if (!course) {
        course = await CourseModel.create({
            title: `${bootcamp.title} ${bootcamp.season} (Recorded)`,
            slug: `${bootcamp.slug}-recorded`,
            shortDescription: bootcamp.tagline || `${bootcamp.title} ${bootcamp.season} recorded edition`,
            fullDescription: bootcamp.description || bootcamp.tagline || bootcamp.title,
            learningOutcomes: ['Watch all recorded sessions with lifetime access'],
            targetAudience: 'Anyone who missed the live bootcamp',
            thumbnailImage: bootcamp.thumbnail || bootcamp.posterImage || '',
            durationEstimate: bootcamp.durationMinutes
                ? `${Math.round(bootcamp.durationMinutes / 60)} hours`
                : 'Self-paced',
            level: 'beginner',
            category: 'bootcamp',
            tags: ['bootcamp', 'recorded'],
            status: 'published',
            isCertificateAvailable: false,
            createdBy: new Types.ObjectId(actor.id),
        } as any);
        bootcamp.recordedCourseId = course._id;
    }

    let batch: any = null;
    if (bootcamp.recordedBatchId) {
        batch = await BatchModel.findById(bootcamp.recordedBatchId);
    }
    if (!batch) {
        const farFuture = new Date();
        farFuture.setFullYear(farFuture.getFullYear() + 10);
        const lastBatch = await BatchModel.findOne({ courseId: course._id })
            .sort({ batchNumber: -1 })
            .select('batchNumber')
            .lean();
        batch = await BatchModel.create({
            courseId: course._id,
            title: `${bootcamp.title} ${bootcamp.season} - Recorded`,
            batchNumber: lastBatch ? lastBatch.batchNumber + 1 : 1,
            description: 'Lifetime recorded access. Same videos for everyone.',
            startDate: new Date(),
            endDate: farFuture,
            enrollmentStartDate: new Date(),
            enrollmentEndDate: farFuture,
            price: price,
            manualPaymentPrice: price,
            currency: 'BDT',
            currentEnrollment: 0,
            status: BatchStatus.Upcoming,
            deliveryMode: 'recorded',
            isEvergreen: true,
            isHidden: true,
        } as any);
        bootcamp.recordedBatchId = batch._id;
    } else {
        batch.price = price;
        batch.manualPaymentPrice = price;
        batch.enrollmentEndDate = (() => {
            const d = new Date();
            d.setFullYear(d.getFullYear() + 10);
            return d;
        })();
        if (batch.status === BatchStatus.Completed) {
            batch.status = BatchStatus.Upcoming;
        }
        await batch.save();
    }

    if (opts.sourceBatchId) {
        const sourceModules = await ModuleModel.find({ batchId: opts.sourceBatchId })
            .sort({ orderIndex: 1 })
            .lean();
        let lessonsCount = 0;
        let durationMinutes = 0;
        for (const mod of sourceModules) {
            const created = await ModuleModel.create({
                courseId: course._id,
                batchId: batch._id,
                title: mod.title,
                description: mod.description,
                orderIndex: mod.orderIndex,
                estimatedDuration: mod.estimatedDuration,
                learningObjectives: mod.learningObjectives ?? [],
                status: 'published',
            } as any);
            const lessons = await LessonModel.find({ moduleId: mod._id })
                .sort({ orderIndex: 1 })
                .lean();
            for (const lesson of lessons) {
                await LessonModel.create({
                    moduleId: created._id,
                    title: lesson.title,
                    description: lesson.description,
                    type: lesson.type,
                    orderIndex: lesson.orderIndex,
                    videoSource: lesson.videoSource,
                    videoId: lesson.videoId,
                    videoUrl: lesson.videoUrl,
                    videoDuration: lesson.videoDuration,
                    content: lesson.content,
                    isMandatory: false,
                    isPublished: true,
                    resources: lesson.resources ?? [],
                } as any);
                lessonsCount += 1;
                durationMinutes += Math.round((lesson.videoDuration ?? 0) / 60);
            }
        }
        if (lessonsCount > 0) {
            bootcamp.lessonsCount = lessonsCount;
            bootcamp.durationMinutes = durationMinutes;
        }

        if (lessonsCount === 0) {
            const recordings = await RecordingModel.find({
                batchId: opts.sourceBatchId,
                isPublished: true,
            })
                .sort({ sessionDate: 1 })
                .lean();
            if (recordings.length > 0) {
                const created = await ModuleModel.create({
                    courseId: course._id,
                    batchId: batch._id,
                    title: 'Recorded Sessions',
                    description: 'All live sessions, unlocked for everyone',
                    orderIndex: 0,
                    estimatedDuration: 'Self-paced',
                    learningObjectives: [],
                    status: 'published',
                } as any);
                let order = 0;
                for (const rec of recordings) {
                    await LessonModel.create({
                        moduleId: created._id,
                        title: rec.title,
                        description: rec.description,
                        type: 'video',
                        orderIndex: order++,
                        videoSource: rec.videoSource,
                        videoId: rec.videoId,
                        videoUrl: rec.videoUrl,
                        videoDuration: rec.duration,
                        isMandatory: false,
                        isPublished: true,
                        resources: [],
                    } as any);
                    durationMinutes += Math.round((rec.duration ?? 0) / 60);
                }
                bootcamp.lessonsCount = recordings.length;
                bootcamp.durationMinutes = durationMinutes;
            }
        }
    }

    bootcamp.recordedPrice = price;
    bootcamp.status =
        bootcamp.status === BootcampStatus.Upcoming || bootcamp.status === BootcampStatus.Live
            ? bootcamp.status
            : BootcampStatus.Completed;
    bootcamp.recordedStatus = RecordedStatus.Published;
    await bootcamp.save();

    await recordAudit({
        actor: actor.id,
        actorRole: actor.role,
        action: 'bootcamp.publish_recording',
        targetType: 'Bootcamp',
        targetId: id,
        metadata: { recordedPrice: price, lessonsCount: bootcamp.lessonsCount },
    });

    return bootcamp;
};

const listBootcampsAdmin = async (params?: { status?: string; search?: string; page?: number; limit?: number }) => {
    const query: FilterQuery<IBootcampCatalog> = {};
    if (params?.status) query.status = params.status as any;
    if (params?.search) {
        const rx = new RegExp(params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = [{ title: rx }, { season: rx }, { slug: rx }];
    }
    const page = Math.max(1, params?.page || 1);
    const limit = Math.max(1, Math.min(100, params?.limit || 20));
    const [data, total] = await Promise.all([
        BootcampCatalogModel.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        BootcampCatalogModel.countDocuments(query),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
};

export const BootcampCatalogService = {
    getCurrentBootcamp,
    getPastBootcamps,
    getBootcampBySlug,
    createBootcamp,
    updateBootcamp,
    setRecordedPrice,
    publishRecording,
    listBootcampsAdmin,
};
