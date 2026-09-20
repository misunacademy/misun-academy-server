import { FilterQuery, Types } from 'mongoose';
import ApiError from '../../errors/ApiError.js';
import { StatusCodes } from 'http-status-codes';
import SSLCommerzPayment from 'sslcommerz-lts';
import axios from 'axios';
import crypto from 'crypto';
import config from '../../config/env.js';
import { BootcampCatalogModel } from './bootcampCatalog.model.js';
import { BootcampPurchaseModel } from './bootcampPurchase.model.js';
import {
    BootcampStatus,
    RecordedStatus,
    IBootcampCatalog,
    IBootcampVideo,
    BootcampPurchaseStatus,
} from './bootcampCatalog.interface.js';
import { recordAudit } from '../../models/auditLog.model.js';
import { normalizeVideoId } from '../../utils/video.utils.js';
import { UserModel } from '../User/user.model.js';
import { logger } from '../../config/logger.js';

const slugify = (value: string): string =>
    value
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');

const syncRecordingStats = (bootcamp: any) => {
    const published = (bootcamp.videos ?? []).filter((v: IBootcampVideo) => v.isPublished);
    bootcamp.lessonsCount = published.length;
    bootcamp.durationMinutes = Math.round(
        published.reduce((sum: number, v: IBootcampVideo) => sum + (v.duration ?? 0), 0) / 60
    );
};

const toCard = (b: any) => ({
    _id: b._id,
    title: b.title,
    season: b.season,
    slug: b.slug,
    tagline: b.tagline,
    thumbnail: b.thumbnail,
    posterImage: b.posterImage,
    liveFee: b.liveFee,
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

const hasPaidPurchase = async (userId: string | undefined, bootcampId: Types.ObjectId) => {
    if (!userId) return false;
    const purchase = await BootcampPurchaseModel.findOne({
        user: new Types.ObjectId(userId),
        bootcamp: bootcampId,
        status: BootcampPurchaseStatus.Paid,
    })
        .select('_id')
        .lean();
    return Boolean(purchase);
};

const getBootcampBySlug = async (slug: string, userId?: string) => {
    const bootcamp: any = await BootcampCatalogModel.findOne({ slug: slug.toLowerCase() }).lean();
    if (
        !bootcamp ||
        bootcamp.status === BootcampStatus.Draft ||
        bootcamp.status === BootcampStatus.Archived ||
        bootcamp.recordedStatus !== RecordedStatus.Published
    ) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp not found');
    }
    // Bootcamps are fully separate from courses/batches — videos live on the
    // bootcamp itself and are only exposed to users with a paid purchase.
    const purchased = await hasPaidPurchase(userId, bootcamp._id);
    delete bootcamp.recordedCourseId;
    delete bootcamp.recordedBatchId;
    delete bootcamp.certificateNote;
    delete bootcamp.videos;
    return { ...bootcamp, hasPurchased: purchased };
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

// ---------- Bootcamp videos (fully separate from Course/Batch/Lessons) ----------

const addBootcampVideo = async (
    id: string,
    payload: Partial<IBootcampVideo>,
    actor: { id: string; role?: string }
) => {
    const bootcamp: any = await BootcampCatalogModel.findById(id);
    if (!bootcamp) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp not found');
    }
    const lastOrder = bootcamp.videos.reduce(
        (max: number, v: IBootcampVideo) => Math.max(max, (v.orderIndex ?? 0) + 1),
        0
    );
    bootcamp.videos.push({
        title: payload.title!,
        description: payload.description,
        videoSource: payload.videoSource ?? 'youtube',
        videoId: normalizeVideoId(payload.videoSource ?? 'youtube', payload.videoId) || payload.videoId!,
        videoUrl: payload.videoUrl,
        duration: payload.duration ?? 0,
        orderIndex: lastOrder,
        isPublished: payload.isPublished ?? true,
        resources: payload.resources ?? [],
    });
    syncRecordingStats(bootcamp);
    await bootcamp.save();

    await recordAudit({
        actor: actor.id,
        actorRole: actor.role,
        action: 'bootcamp.video.add',
        targetType: 'Bootcamp',
        targetId: id,
        metadata: { title: payload.title },
    });
    return bootcamp;
};

const updateBootcampVideo = async (
    id: string,
    videoId: string,
    payload: Partial<IBootcampVideo>,
    actor: { id: string; role?: string }
) => {
    const bootcamp: any = await BootcampCatalogModel.findById(id);
    if (!bootcamp) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp not found');
    }
    const video = bootcamp.videos.id(videoId);
    if (!video) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Video not found');
    }
    if (typeof (payload as any).videoId === 'string' && (payload as any).videoId) {
        (payload as any).videoId = normalizeVideoId(
            (payload as any).videoSource ?? (video as any).videoSource,
            (payload as any).videoId
        ) || (payload as any).videoId;
        // A fresh id invalidates any previously stored embed URL.
        if (!(payload as any).videoUrl) (video as any).videoUrl = undefined;
    }
    Object.assign(video, payload);
    syncRecordingStats(bootcamp);
    await bootcamp.save();

    await recordAudit({
        actor: actor.id,
        actorRole: actor.role,
        action: 'bootcamp.video.update',
        targetType: 'Bootcamp',
        targetId: id,
        metadata: { videoId, title: video.title },
    });
    return bootcamp;
};

const deleteBootcampVideo = async (
    id: string,
    videoId: string,
    actor: { id: string; role?: string }
) => {
    const bootcamp: any = await BootcampCatalogModel.findById(id);
    if (!bootcamp) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp not found');
    }
    const video = bootcamp.videos.id(videoId);
    if (!video) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Video not found');
    }
    video.deleteOne();
    syncRecordingStats(bootcamp);
    await bootcamp.save();

    await recordAudit({
        actor: actor.id,
        actorRole: actor.role,
        action: 'bootcamp.video.delete',
        targetType: 'Bootcamp',
        targetId: id,
        metadata: { videoId },
    });
    return bootcamp;
};

const listBootcampVideos = async (id: string) => {
    const bootcamp = await BootcampCatalogModel.findById(id).select('videos title season').lean();
    if (!bootcamp) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp not found');
    }
    return bootcamp;
};

const getMyBootcampVideos = async (slug: string, userId: string) => {
    const bootcamp: any = await BootcampCatalogModel.findOne({ slug: slug.toLowerCase() })
        .select('videos title season slug recordedStatus recordedPrice status')
        .lean();
    if (
        !bootcamp ||
        bootcamp.recordedStatus !== RecordedStatus.Published ||
        bootcamp.status === BootcampStatus.Draft ||
        bootcamp.status === BootcampStatus.Archived
    ) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp not found');
    }
    const purchased = await hasPaidPurchase(userId, bootcamp._id);
    if (!purchased) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'You have not purchased this bootcamp recording');
    }
    return {
        _id: bootcamp._id,
        title: bootcamp.title,
        season: bootcamp.season,
        slug: bootcamp.slug,
        videos: (bootcamp.videos ?? [])
            .filter((v: IBootcampVideo) => v.isPublished)
            .sort((a: IBootcampVideo, b: IBootcampVideo) => a.orderIndex - b.orderIndex),
    };
};

const publishRecording = async (
    id: string,
    actor: { id: string; role?: string },
    opts: { recordedPrice?: number } = {}
) => {
    const bootcamp: any = await BootcampCatalogModel.findById(id);
    if (!bootcamp) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp not found');
    }

    const publishedVideos = (bootcamp.videos ?? []).filter((v: IBootcampVideo) => v.isPublished);
    if (publishedVideos.length === 0) {
        throw new ApiError(
            StatusCodes.BAD_REQUEST,
            'Add at least one published video before publishing the recording'
        );
    }

    if (typeof opts.recordedPrice === 'number') {
        bootcamp.recordedPrice = opts.recordedPrice;
    }
    syncRecordingStats(bootcamp);
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
        metadata: { recordedPrice: bootcamp.recordedPrice, lessonsCount: bootcamp.lessonsCount },
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

// ---------- Bootcamp purchases (SSLCommerz only) ----------

const getMyBootcampPurchases = async (userId: string) => {
    return BootcampPurchaseModel.find({ user: new Types.ObjectId(userId) })
        .populate('bootcamp', 'title season slug thumbnail posterImage recordedPrice')
        .sort({ createdAt: -1 })
        .lean();
};

// ---------- SSLCommerz helpers for bootcamp purchases ----------
// ---------- SSLCommerz helpers for bootcamp purchases ----------

const generateBootcampTransactionId = (): string => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(8).toString('hex').toUpperCase();
    return `BC${timestamp}${random}`;
};

const getBootcampCallbackKey = (transactionId: string): string =>
    crypto
        .createHmac('sha256', config.SSL_STORE_PASSWORD || config.BETTER_AUTH_SECRET || 'fallback')
        .update(transactionId)
        .digest('hex')
        .slice(0, 32);

const validateBootcampSSLCommerzPayment = async (valId: string): Promise<any> => {
    const { data } = await axios.get<any>(config.SSL_VALIDATION_API, {
        params: {
            val_id: valId,
            store_id: config.SSL_STORE_ID,
            store_passwd: config.SSL_STORE_PASSWORD,
            format: 'json',
        },
    });
    return data;
};

const initiateBootcampSSLCommerz = async (slug: string, userId: string) => {
    const bootcamp = await BootcampCatalogModel.findOne({ slug: slug.toLowerCase() }).lean();
    if (!bootcamp || bootcamp.recordedStatus !== RecordedStatus.Published) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp recording not found or not published');
    }

    const existingPaid = await BootcampPurchaseModel.findOne({
        user: new Types.ObjectId(userId),
        bootcamp: bootcamp._id,
        status: BootcampPurchaseStatus.Paid,
    }).lean();
    if (existingPaid) {
        throw new ApiError(StatusCodes.CONFLICT, 'You already own this bootcamp recording');
    }

    // Gateway sessions expire — reopening an old GatewayPageURL lands the user
    // on SSLCommerz warning.php ("missed the duration of the payment"). Only
    // reuse a pending payment URL while it is still fresh; otherwise supersede
    // stale pendings so a new tran_id is issued below.
    const PENDING_REUSE_WINDOW_MS = 15 * 60 * 1000;
    const pendingFilter = {
        user: new Types.ObjectId(userId),
        bootcamp: bootcamp._id,
        status: BootcampPurchaseStatus.Pending,
        method: 'SSLCommerz',
    };

    const existingPending = await BootcampPurchaseModel.findOne(pendingFilter)
        .sort({ createdAt: -1 })
        .lean();

    if (existingPending) {
        const gateway = (existingPending.gatewayResponse ?? {}) as {
            paymentUrl?: string;
            initiatedAt?: string | Date;
        };
        const initiatedAt = gateway.initiatedAt ? new Date(gateway.initiatedAt).getTime() : NaN;
        const ageMs = Number.isNaN(initiatedAt) ? Number.POSITIVE_INFINITY : Date.now() - initiatedAt;
        if (gateway.paymentUrl && ageMs < PENDING_REUSE_WINDOW_MS) {
            return { paymentUrl: gateway.paymentUrl, transactionId: existingPending.transactionId };
        }
        await BootcampPurchaseModel.updateMany(pendingFilter, {
            $set: {
                status: BootcampPurchaseStatus.Rejected,
                'gatewayResponse.status': 'superseded',
                'gatewayResponse.supersededAt': new Date(),
            },
        });
    }

    const user = await UserModel.findById(userId).lean();
    if (!user) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
    }

    const store_id = config.SSL_STORE_ID;
    const store_passwd = config.SSL_STORE_PASSWORD;
    const is_live = config.SSL_IS_LIVE === 'true';

    if (!store_id || !store_passwd) {
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Payment gateway not configured');
    }

    const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
    const transactionId = generateBootcampTransactionId();
    const callbackKey = getBootcampCallbackKey(transactionId);
    const amount = bootcamp.recordedPrice ?? 0;

    const paymentData = {
        store_id: config.SSL_STORE_ID,
        store_passwd: config.SSL_STORE_PASSWORD,
        total_amount: Number(amount).toFixed(2),
        currency: 'BDT',
        tran_id: transactionId,
        success_url: `${config.SERVER_URL}/api/v1/bootcamp/payments/status?t=${transactionId}&k=${callbackKey}`,
        fail_url: `${config.SERVER_URL}/api/v1/bootcamp/payments/status?t=${transactionId}&status=failed&k=${callbackKey}`,
        cancel_url: `${config.SERVER_URL}/api/v1/bootcamp/payments/status?t=${transactionId}&status=cancel&k=${callbackKey}`,
        ipn_url: `${config.SERVER_URL}/api/v1/bootcamp/payments/webhook`,
        product_name: `${bootcamp.title} ${bootcamp.season}`.slice(0, 50),
        cus_name: user.name || 'Customer',
        cus_email: user.email,
        cus_add1: (user as any).address || 'N/A',
        cus_phone: (user as any).phone || 'N/A',
        shipping_method: 'N/A',
        product_category: 'Online Course',
        product_profile: 'general',
        cus_add2: 'N/A',
        cus_city: 'N/A',
        cus_state: 'N/A',
        cus_postcode: 'N/A',
        cus_country: 'Bangladesh',
        cus_fax: 'N/A',
        ship_name: 'N/A',
        ship_add1: 'N/A',
        ship_add2: 'N/A',
        ship_city: 'N/A',
        ship_state: 'N/A',
        ship_postcode: 1000,
        ship_country: 'Bangladesh',
        value_a: bootcamp.slug,
        value_b: userId,
        value_c: bootcamp._id.toString(),
    };

    const created = await BootcampPurchaseModel.create({
        user: new Types.ObjectId(userId),
        bootcamp: bootcamp._id,
        amount,
        method: 'SSLCommerz',
        transactionId,
        status: BootcampPurchaseStatus.Pending,
        gatewayResponse: { initiatedAt: new Date() },
    });

    try {
        const response = await sslcz.init(paymentData);
        if (response?.GatewayPageURL) {
            await BootcampPurchaseModel.findByIdAndUpdate(created._id, {
                $set: {
                    gatewayResponse: {
                        ...(created.gatewayResponse as object),
                        paymentUrl: response.GatewayPageURL,
                    },
                },
            });
            return { paymentUrl: response.GatewayPageURL, transactionId };
        } else {
            logger.error({ response }, 'SSLCommerz init failed for bootcamp');
            await BootcampPurchaseModel.findByIdAndUpdate(created._id, {
                $set: { status: BootcampPurchaseStatus.Rejected },
            });
            throw new ApiError(
                StatusCodes.INTERNAL_SERVER_ERROR,
                response?.failedreason || 'Failed to initiate payment gateway.'
            );
        }
    } catch (error: any) {
        logger.error(error, 'SSLCommerz error for bootcamp purchase');
        await BootcampPurchaseModel.findByIdAndUpdate(created._id, {
            $set: { status: BootcampPurchaseStatus.Rejected },
        });
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            error?.message || 'Payment gateway initialization failed.'
        );
    }
};

const finalizeBootcampSSLCommerz = async (transactionId: string, status: string, valId?: string) => {
    const purchase = await BootcampPurchaseModel.findOne({ transactionId });
    if (!purchase) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp purchase not found');
    }

    if (purchase.status === BootcampPurchaseStatus.Paid) {
        return purchase;
    }

    if (status === 'failed' || status === 'cancel') {
        await BootcampPurchaseModel.findByIdAndUpdate(purchase._id, {
            $set: {
                status:
                    status === 'cancel'
                        ? BootcampPurchaseStatus.Rejected
                        : BootcampPurchaseStatus.Rejected,
                gatewayResponse: {
                    ...(purchase.gatewayResponse as object),
                    failedAt: new Date(),
                    status,
                },
            },
        });
        return purchase;
    }

    if (!valId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Validation ID missing');
    }

    const validation = await validateBootcampSSLCommerzPayment(valId);
    if (validation?.status !== 'VALID' && validation?.status !== 'VALIDATED') {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Payment validation failed');
    }

    if (Number(validation.amount) < purchase.amount) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Payment amount mismatch');
    }

    const updated = await BootcampPurchaseModel.findByIdAndUpdate(
        purchase._id,
        {
            $set: {
                status: BootcampPurchaseStatus.Paid,
                gatewayResponse: {
                    ...(purchase.gatewayResponse as object),
                    validatedAt: new Date(),
                    valId,
                    gatewayStatus: validation.status,
                    bankTranId: validation.bank_tran_id,
                    cardType: validation.card_type,
                },
            },
        },
        { new: true }
    );

    return updated;
};

const checkBootcampPaymentStatus = async (transactionId: string, userId?: string) => {
    const query: FilterQuery<any> = { transactionId };
    if (userId) query.user = new Types.ObjectId(userId);
    const purchase = await BootcampPurchaseModel.findOne(query)
        .populate('bootcamp', 'slug title season')
        .lean();

    if (!purchase) {
        throw new ApiError(StatusCodes.NOT_FOUND, 'Bootcamp purchase not found');
    }

    return {
        status: purchase.status,
        bootcampSlug: (purchase.bootcamp as any)?.slug,
    };
};

export const BootcampCatalogService = {
    getCurrentBootcamp,
    getPastBootcamps,
    getBootcampBySlug,
    listBootcampsAdmin,
    createBootcamp,
    updateBootcamp,
    setRecordedPrice,
    publishRecording,
    addBootcampVideo,
    updateBootcampVideo,
    deleteBootcampVideo,
    listBootcampVideos,
    getMyBootcampVideos,
    getMyBootcampPurchases,
    initiateBootcampSSLCommerz,
    finalizeBootcampSSLCommerz,
    checkBootcampPaymentStatus,
    getBootcampCallbackKey,
};
