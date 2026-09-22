import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import env from '../../config/env.js';
import { BootcampCatalogService } from './bootcampCatalog.service.js';
import { BootcampPurchaseStatus } from './bootcampCatalog.interface.js';

const redirectFrontend = (res: Response, path: string) => {
    res.redirect(`${env.MA_FRONTEND_URL}${path}`);
};

const getCurrentBootcamp = catchAsync(async (_req: Request, res: Response) => {
    const result = await BootcampCatalogService.getCurrentBootcamp();
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: result ? 'Current bootcamp retrieved' : 'No upcoming bootcamp',
        data: result,
    });
});

const getPastBootcamps = catchAsync(async (_req: Request, res: Response) => {
    const result = await BootcampCatalogService.getPastBootcamps();
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Past bootcamps retrieved',
        data: result,
    });
});

const getBootcampBySlug = catchAsync(async (req: Request, res: Response) => {
    const { slug } = req.params as { slug: string };
    const userId = (req.user as { id?: string } | undefined)?.id;
    const result = await BootcampCatalogService.getBootcampBySlug(slug, userId);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Bootcamp retrieved',
        data: result,
    });
});

const listBootcampsAdmin = catchAsync(async (req: Request, res: Response) => {
    const { status, search, page, limit } = req.query as {
        status?: string;
        search?: string;
        page?: string;
        limit?: string;
    };
    const result = await BootcampCatalogService.listBootcampsAdmin({
        status,
        search,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
    });
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Bootcamps retrieved',
        data: result.data,
        meta: result.meta,
    });
});

const createBootcamp = catchAsync(async (req: Request, res: Response) => {
    const { id, role } = req.user as { id: string; role?: string };
    const result = await BootcampCatalogService.createBootcamp(req.body, { id, role });
    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Bootcamp created',
        data: result,
    });
});

const updateBootcamp = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { id: actorId, role } = req.user as { id: string; role?: string };
    const result = await BootcampCatalogService.updateBootcamp(id, req.body, {
        id: actorId,
        role,
    });
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Bootcamp updated',
        data: result,
    });
});

const setRecordedPrice = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { id: actorId, role } = req.user as { id: string; role?: string };
    const result = await BootcampCatalogService.setRecordedPrice(
        id,
        req.body.recordedPrice,
        { id: actorId, role }
    );
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Recorded price updated',
        data: result,
    });
});

const publishRecording = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { id: actorId, role } = req.user as { id: string; role?: string };
    const result = await BootcampCatalogService.publishRecording(
        id,
        { id: actorId, role },
        req.body ?? {}
    );
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Recording published',
        data: result,
    });
});

const addBootcampVideo = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { id: actorId, role } = req.user as { id: string; role?: string };
    const result = await BootcampCatalogService.addBootcampVideo(id, req.body, {
        id: actorId,
        role,
    });
    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        success: true,
        message: 'Video added to bootcamp',
        data: result,
    });
});

const updateBootcampVideo = catchAsync(async (req: Request, res: Response) => {
    const { id, videoId } = req.params as { id: string; videoId: string };
    const { id: actorId, role } = req.user as { id: string; role?: string };
    const result = await BootcampCatalogService.updateBootcampVideo(id, videoId, req.body, {
        id: actorId,
        role,
    });
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Bootcamp video updated',
        data: result,
    });
});

const deleteBootcampVideo = catchAsync(async (req: Request, res: Response) => {
    const { id, videoId } = req.params as { id: string; videoId: string };
    const { id: actorId, role } = req.user as { id: string; role?: string };
    const result = await BootcampCatalogService.deleteBootcampVideo(id, videoId, {
        id: actorId,
        role,
    });
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Bootcamp video deleted',
        data: result,
    });
});

const listBootcampVideos = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const result = await BootcampCatalogService.listBootcampVideos(id);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Bootcamp videos retrieved',
        data: result,
    });
});

const getMyBootcampPurchases = catchAsync(async (req: Request, res: Response) => {
    const { id: userId } = req.user as { id: string };
    const result = await BootcampCatalogService.getMyBootcampPurchases(userId);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Your bootcamp purchases retrieved',
        data: result,
    });
});

const getMyBootcampVideos = catchAsync(async (req: Request, res: Response) => {
    const { slug } = req.params as { slug: string };
    const { id: userId } = req.user as { id: string };
    const result = await BootcampCatalogService.getMyBootcampVideos(slug, userId);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Bootcamp videos retrieved',
        data: result,
    });
});

// --- Admin: recording purchases (who bought a recorded bootcamp) ---

const listBootcampPurchases = catchAsync(async (req: Request, res: Response) => {
    const { bootcampId, status, search, from, to, page, limit } = req.query as {
        bootcampId?: string;
        status?: BootcampPurchaseStatus;
        search?: string;
        from?: string;
        to?: string;
        page?: string;
        limit?: string;
    };

    const result = await BootcampCatalogService.listBootcampPurchasesAdmin({
        bootcampId,
        status,
        search,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
    });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Bootcamp purchases retrieved',
        data: result.data,
        meta: result.meta,
    });
});

const getBootcampPurchaseStats = catchAsync(async (req: Request, res: Response) => {
    const { bootcampId } = req.query as { bootcampId?: string };
    const result = await BootcampCatalogService.getBootcampPurchaseStats({ bootcampId });

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Bootcamp purchase stats retrieved',
        data: result,
    });
});

// --- SSLCommerz payment controllers ---

const initiateBootcampSSLCommerz = catchAsync(async (req: Request, res: Response) => {
    const { slug } = req.params as { slug: string };
    const userId = (req.user as { id: string }).id;
    const result = await BootcampCatalogService.initiateBootcampSSLCommerz(slug, userId);
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Payment initiated',
        data: result,
    });
});

const bootcampPaymentStatus = catchAsync(async (req: Request, res: Response) => {
    // SSLCommerz hits success/fail/cancel URLs with a form POST (also reachable
    // via browser GET on retry), so accept both query and body params.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = req.query as Record<string, string | undefined>;
    const transactionId =
        (query.t as string | undefined) ??
        (body.tran_id as string | undefined) ??
        (body.t as string | undefined);
    const gatewayStatus =
        (query.status as string | undefined) ?? (body.status as string | undefined);
    const valId =
        (query.val_id as string | undefined) ??
        (body.val_id as string | undefined) ??
        (body.valId as string | undefined);
    const callbackKey =
        (query.k as string | undefined) ?? (body.k as string | undefined);

    if (!transactionId) {
        redirectFrontend(res, '/bootcamp?payment=failed');
        return;
    }

    // Verify the HMAC callback key — the gateway cannot hold a user session, so
    // this (not requireAuth) is what authenticates the status callback.
    const expectedKey = BootcampCatalogService.getBootcampCallbackKey(transactionId);
    if (!callbackKey || callbackKey !== expectedKey) {
        redirectFrontend(res, '/bootcamp?payment=failed');
        return;
    }

    try {
        // val_id present = successful gateway POST (regardless of status string)
        if (valId) {
            await BootcampCatalogService.finalizeBootcampSSLCommerz(transactionId, 'VALID', valId);
        } else if (gatewayStatus && ['failed', 'cancel'].includes(gatewayStatus.toLowerCase())) {
            await BootcampCatalogService.finalizeBootcampSSLCommerz(transactionId, gatewayStatus.toLowerCase());
        } else if (gatewayStatus) {
            await BootcampCatalogService.finalizeBootcampSSLCommerz(transactionId, gatewayStatus);
        }
        const status = await BootcampCatalogService.checkBootcampPaymentStatus(transactionId);
        const slug = status.bootcampSlug || '';
        redirectFrontend(res, `/bootcamp/${slug}?payment=${status.status === 'paid' ? 'success' : 'failed'}`);
    } catch {
        redirectFrontend(res, '/bootcamp?payment=failed');
    }
});

const bootcampPaymentWebhook = catchAsync(async (req: Request, res: Response) => {
    const { tran_id: transactionId, status: gatewayStatus, val_id: valId } = req.body as {
        tran_id?: string;
        status?: string;
        val_id?: string;
    };

    if (!transactionId || !gatewayStatus) {
        sendResponse(res, {
            statusCode: StatusCodes.BAD_REQUEST,
            success: false,
            message: 'Invalid webhook payload',
            data: null,
        });
        return;
    }

    await BootcampCatalogService.finalizeBootcampSSLCommerz(
        transactionId,
        gatewayStatus,
        valId
    );

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        success: true,
        message: 'Webhook processed',
        data: null,
    });
});
export const BootcampCatalogController = {
    getCurrentBootcamp,
    getPastBootcamps,
    getBootcampBySlug,
    listBootcampsAdmin,
    createBootcamp,
    updateBootcamp,
    setRecordedPrice,
    addBootcampVideo,
    updateBootcampVideo,
    deleteBootcampVideo,
    listBootcampVideos,
    getMyBootcampVideos,
    getMyBootcampPurchases,
    listBootcampPurchases,
    getBootcampPurchaseStats,
    initiateBootcampSSLCommerz,
    bootcampPaymentStatus,
    bootcampPaymentWebhook,
    publishRecording,
};

