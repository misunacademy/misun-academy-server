import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import ApiError from '../../errors/ApiError.js';
import env from '../../config/env.js';
import { DigitalProductService } from './digitalProduct.service.js';

const redirectFrontend = (res: Response, path: string) => {
    res.redirect(`${env.MA_FRONTEND_URL}${path}`);
};

export class DigitalProductController {
    // --- Public Endpoints ---

    static getBootcampProducts = catchAsync(async (_req: Request, res: Response) => {
        const result = await DigitalProductService.getBootcampProducts();
        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Bootcamp digital products retrieved successfully',
            data: result,
        });
    });

    static getProductBySlug = catchAsync(async (req: Request, res: Response) => {
        const { slug } = req.params as { slug: string };
        const result = await DigitalProductService.getProductBySlug(slug);
        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Product retrieved successfully',
            data: result,
        });
    });

    static initiateSSLCommerz = catchAsync(async (req: Request, res: Response) => {
        const { productId, address, redirectPath } = req.body;
        const user = req.user as { id: string; name?: string; email?: string; phone?: string };
        const name = req.body.name || user?.name || 'Student';
        const email = req.body.email || user?.email || '';
        const phone = req.body.phone || (user as any)?.phone || '01700000000';

        const result = await DigitalProductService.initiateSSLCommerzPayment(
            productId,
            { name, email, phone, address, redirectPath },
            user.id
        );

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Payment initiated successfully',
            data: result,
        });
    });

    static submitPhonePeManual = catchAsync(async (req: Request, res: Response) => {
        const { productId, senderPhonePe, transactionId } = req.body;
        const user = req.user as { id: string; name?: string; email?: string; phone?: string };
        const name = req.body.name || user?.name || 'Student';
        const email = req.body.email || user?.email || '';
        const phone = req.body.phone || (user as any)?.phone || 'N/A';

        const result = await DigitalProductService.submitPhonePeManualOrder(
            productId,
            { name, email, phone },
            { senderPhonePe, transactionId },
            user.id
        );

        sendResponse(res, {
            statusCode: StatusCodes.CREATED,
            success: true,
            message: result.message,
            data: result,
        });
    });

    static paymentStatusCallback = catchAsync(async (req: Request, res: Response) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const query = req.query as Record<string, string | undefined>;
        const transactionId =
            (query.t as string | undefined) ??
            (body.tran_id as string | undefined) ??
            (body.t as string | undefined);
        const gatewayStatus =
            (query.status as string | undefined) ?? (body.status as string | undefined) ?? 'VALID';
        const valId =
            (query.val_id as string | undefined) ??
            (body.val_id as string | undefined) ??
            (body.valId as string | undefined);
        const callbackKey = (query.k as string | undefined) ?? (body.k as string | undefined);

        if (!transactionId) {
            redirectFrontend(res, '/digital-products?digitalPayment=failed');
            return;
        }

        const expectedKey = DigitalProductService.getCallbackKey(transactionId);
        if (!callbackKey || callbackKey !== expectedKey) {
            redirectFrontend(res, '/digital-products?digitalPayment=failed');
            return;
        }

        try {
            const order = await DigitalProductService.finalizeSSLCommerzPayment(
                transactionId,
                gatewayStatus,
                valId
            );

            const targetPath =
                (order?.gatewayResponse as any)?.redirectPath &&
                typeof (order?.gatewayResponse as any)?.redirectPath === 'string' &&
                (order?.gatewayResponse as any).redirectPath.startsWith('/')
                    ? (order?.gatewayResponse as any).redirectPath
                    : '/digital-products';

            const separator = targetPath.includes('?') ? '&' : '?';

            if (order && order.status === 'paid') {
                redirectFrontend(
                    res,
                    `${targetPath}${separator}digitalPayment=success&orderId=${order.orderNumber}&token=${order.downloadToken}`
                );
            } else {
                redirectFrontend(res, `${targetPath}${separator}digitalPayment=failed`);
            }
        } catch {
            redirectFrontend(res, '/digital-products?digitalPayment=failed');
        }
    });

    static paymentWebhook = catchAsync(async (req: Request, res: Response) => {
        const { tran_id: transactionId, status: gatewayStatus, val_id: valId } = req.body as {
            tran_id?: string;
            status?: string;
            val_id?: string;
        };

        if (transactionId) {
            await DigitalProductService.finalizeSSLCommerzPayment(
                transactionId,
                gatewayStatus || 'VALID',
                valId
            );
        }

        res.status(StatusCodes.OK).json({ received: true });
    });

    static downloadFile = catchAsync(async (req: Request, res: Response) => {
        const { token, fileType } = req.params as { token: string; fileType: 'script' | 'guide' };
        if (fileType !== 'script' && fileType !== 'guide') {
            res.status(StatusCodes.BAD_REQUEST).json({ message: 'Invalid file type' });
            return;
        }

        const file = await DigitalProductService.verifyDownloadAccess(token, fileType);
        // Redirect browser directly to Cloudinary URL
        res.redirect(302, file.url);
    });

    static getMyPurchasedProducts = catchAsync(async (req: Request, res: Response) => {
        const user = req.user as { id: string; email?: string };
        const result = await DigitalProductService.getMyPurchasedProducts(user.email || '', user.id);
        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Purchased products retrieved',
            data: result,
        });
    });

    // --- Admin Endpoints ---

    static getAllProductsAdmin = catchAsync(async (req: Request, res: Response) => {
        const { search, software, isPublished, page, limit } = req.query as Record<string, string>;
        const result = await DigitalProductService.getAllProductsAdmin({
            search,
            software,
            isPublished: isPublished !== undefined ? isPublished === 'true' : undefined,
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
        });

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Admin products retrieved',
            data: result.data,
            meta: result.meta,
        });
    });

    static createProductAdmin = catchAsync(async (req: Request, res: Response) => {
        const adminUserId = (req.user as { id?: string })?.id;
        const result = await DigitalProductService.createProduct(req.body, adminUserId);
        sendResponse(res, {
            statusCode: StatusCodes.CREATED,
            success: true,
            message: 'Digital product created successfully',
            data: result,
        });
    });

    static updateProductAdmin = catchAsync(async (req: Request, res: Response) => {
        const { id } = req.params as { id: string };
        const result = await DigitalProductService.updateProduct(id, req.body);
        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Digital product updated successfully',
            data: result,
        });
    });

    static deleteProductAdmin = catchAsync(async (req: Request, res: Response) => {
        const { id } = req.params as { id: string };
        const result = await DigitalProductService.deleteProduct(id);
        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Digital product deleted successfully',
            data: result,
        });
    });

    static listOrdersAdmin = catchAsync(async (req: Request, res: Response) => {
        const { status, paymentMethod, search, page, limit } = req.query as Record<string, string>;
        const result = await DigitalProductService.listOrdersAdmin({
            status: status as any,
            paymentMethod,
            search,
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
        });

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Digital product orders retrieved',
            data: result.data,
            meta: result.meta,
        });
    });

    static reviewOrderAdmin = catchAsync(async (req: Request, res: Response) => {
        const { id } = req.params as { id: string };
        const { status, adminNote } = req.body;
        const adminUserId = (req.user as { id?: string })?.id;

        const result = await DigitalProductService.reviewOrderAdmin(
            id,
            status,
            adminNote,
            adminUserId
        );

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: `Order marked as ${status}`,
            data: result,
        });
    });

    static getOrdersStatsAdmin = catchAsync(async (_req: Request, res: Response) => {
        const result = await DigitalProductService.getOrdersStatsAdmin();
        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Digital product order stats retrieved',
            data: result,
        });
    });

    static uploadAssetAdmin = catchAsync(async (req: Request, res: Response) => {
        const file = req.file;
        if (!file) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'কোনো ফাইল নির্বাচন করা হয়নি');
        }

        const result = await DigitalProductService.uploadAsset(file);
        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'ফাইল ক্লাউডিনারি-তে সফলভাবে আপলোড হয়েছে',
            data: result,
        });
    });
}
