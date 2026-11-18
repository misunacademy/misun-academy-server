import { FilterQuery, Types } from 'mongoose';
import crypto from 'crypto';
import path from 'path';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';
import config from '../../config/env.js';
import { logger } from '../../config/logger.js';
import cloudinary, { isCloudinaryConfigured } from '../../config/cloudinary.js';
import { paymentGatewayAdapter } from '../../services/paymentGatewayAdapter.js';
import { DigitalProductModel } from './digitalProduct.model.js';
import { DigitalProductOrderModel } from './digitalProductOrder.model.js';
import { IDigitalProduct } from './digitalProduct.interface.js';
import {
    IDigitalProductOrder,
    DigitalProductOrderStatus,
} from './digitalProductOrder.interface.js';
import {
    sendDigitalProductPurchasedEmail,
    sendDigitalProductManualSubmittedEmail,
} from '../../services/misunAcademyEmails.js';

const generateOrderNumber = (): string => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `DP-${timestamp}-${random}`;
};

const generateTransactionId = (): string => {
    return `DP_TRX_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
};

const getCallbackKey = (transactionId: string): string => {
    const secret = config.SSL_STORE_PASSWORD || 'secret-digital-key';
    return crypto.createHmac('sha256', secret).update(transactionId).digest('hex').slice(0, 16);
};

export class DigitalProductService {
    // --- Public Catalog ---

    static async getBootcampProducts(): Promise<IDigitalProduct[]> {
        return DigitalProductModel.find({
            isPublished: true,
        })
            .sort({ createdAt: -1 })
            .lean();
    }

    static async getProductBySlug(slug: string): Promise<IDigitalProduct> {
        const product = await DigitalProductModel.findOne({ slug: slug.toLowerCase() }).lean();
        if (!product) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Digital product not found');
        }
        return product;
    }

    // --- Admin Product CRUD ---

    static async getAllProductsAdmin(query: {
        search?: string;
        software?: string;
        isPublished?: boolean;
        page?: number;
        limit?: number;
    }) {
        const filter: FilterQuery<IDigitalProduct> = {};
        if (query.search) {
            filter.$or = [
                { title: { $regex: query.search, $options: 'i' } },
                { slug: { $regex: query.search, $options: 'i' } },
                { tagline: { $regex: query.search, $options: 'i' } },
            ];
        }
        if (query.software) {
            filter.software = query.software;
        }
        if (typeof query.isPublished === 'boolean') {
            filter.isPublished = query.isPublished;
        }

        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            DigitalProductModel.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            DigitalProductModel.countDocuments(filter),
        ]);

        return {
            data,
            meta: {
                page,
                limit,
                total,
                totalPage: Math.ceil(total / limit),
            },
        };
    }

    static async createProduct(payload: Partial<IDigitalProduct>, adminUserId?: string) {
        if (!payload.slug && payload.title) {
            let generated = payload.title
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9\s-]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-');
            if (!generated || generated.length < 2) {
                generated = `${payload.software || 'product'}-${Date.now().toString(36)}`;
            }
            payload.slug = generated;
        }

        const baseSlug = payload.slug?.toLowerCase() || `product-${Date.now().toString(36)}`;
        let uniqueSlug = baseSlug;
        let counter = 1;
        while (await DigitalProductModel.exists({ slug: uniqueSlug })) {
            uniqueSlug = `${baseSlug}-${counter++}`;
        }
        payload.slug = uniqueSlug;

        const product = await DigitalProductModel.create({
            ...payload,
            slug: payload.slug,
            createdBy: adminUserId ? new Types.ObjectId(adminUserId) : undefined,
        });
        return product;
    }

    static async updateProduct(id: string, payload: Partial<IDigitalProduct>) {
        if (payload.slug) {
            const existing = await DigitalProductModel.findOne({
                slug: payload.slug.toLowerCase(),
                _id: { $ne: new Types.ObjectId(id) },
            });
            if (existing) {
                throw new ApiError(StatusCodes.CONFLICT, 'Slug already taken by another product');
            }
            payload.slug = payload.slug.toLowerCase();
        }

        const updated = await DigitalProductModel.findByIdAndUpdate(id, payload, {
            new: true,
            runValidators: true,
        }).lean();

        if (!updated) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Digital product not found');
        }
        return updated;
    }

    static async deleteProduct(id: string) {
        const deleted = await DigitalProductModel.findByIdAndDelete(id).lean();
        if (!deleted) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Digital product not found');
        }
        return deleted;
    }

    // --- Purchases & Checkout ---

    /**
     * Initiate SSLCommerz online payment for Bangladeshi / international cards & MFS
     */
    static async initiateSSLCommerzPayment(
        productId: string,
        customerData: { name: string; email: string; phone: string; address?: string },
        userId?: string
    ) {
        const product = await DigitalProductModel.findById(productId).lean();
        if (!product || !product.isPublished) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found or not available');
        }

        const amount = product.discountPriceBDT ?? product.priceBDT;
        const orderNumber = generateOrderNumber();
        const transactionId = generateTransactionId();
        const callbackKey = getCallbackKey(transactionId);
        const downloadToken = crypto.randomBytes(24).toString('hex');

        const order = await DigitalProductOrderModel.create({
            orderNumber,
            product: product._id,
            productSnapshot: {
                title: product.title,
                slug: product.slug,
                software: product.software,
            },
            user: userId ? new Types.ObjectId(userId) : undefined,
            customer: {
                name: customerData.name,
                email: customerData.email.toLowerCase(),
                phone: customerData.phone,
                country: 'BD',
            },
            paymentMethod: 'SSLCommerz',
            currency: 'BDT',
            amount,
            transactionId,
            status: 'pending',
            downloadToken,
            gatewayResponse: { initiatedAt: new Date() },
        });

        const paymentData = {
            store_id: config.SSL_STORE_ID,
            store_passwd: config.SSL_STORE_PASSWORD,
            total_amount: Number(amount).toFixed(2),
            currency: 'BDT',
            tran_id: transactionId,
            success_url: `${config.SERVER_URL}/api/v1/digital-products/payments/status?t=${transactionId}&k=${callbackKey}`,
            fail_url: `${config.SERVER_URL}/api/v1/digital-products/payments/status?t=${transactionId}&status=failed&k=${callbackKey}`,
            cancel_url: `${config.SERVER_URL}/api/v1/digital-products/payments/status?t=${transactionId}&status=cancel&k=${callbackKey}`,
            ipn_url: `${config.SERVER_URL}/api/v1/digital-products/payments/webhook`,
            product_name: product.title.slice(0, 50),
            cus_name: customerData.name || 'Student',
            cus_email: customerData.email,
            cus_add1: customerData.address || 'Dhaka, Bangladesh',
            cus_phone: customerData.phone || '01700000000',
            shipping_method: 'NO',
            product_category: 'Digital Goods',
            product_profile: 'non-physical-goods',
        };

        const response = await paymentGatewayAdapter.initiate(paymentData);

        if (response?.status === 'SUCCESS' && response?.GatewayPageURL) {
            order.gatewayResponse = {
                ...order.gatewayResponse,
                paymentUrl: response.GatewayPageURL,
                sessionKey: response.sessionkey,
            };
            await order.save();
            return {
                paymentUrl: response.GatewayPageURL,
                orderNumber,
                transactionId,
            };
        }

        order.status = 'rejected';
        order.adminNote = response?.failedreason || 'Gateway initialization failed';
        await order.save();
        throw new ApiError(StatusCodes.BAD_GATEWAY, response?.failedreason || 'Failed to initiate payment gateway');
    }

    /**
     * Submit PhonePe manual payment exclusively for Indian customers
     */
    static async submitPhonePeManualOrder(
        productId: string,
        customerData: { name: string; email: string; phone: string },
        paymentData: { senderPhonePe: string; transactionId: string },
        userId?: string
    ) {
        const product = await DigitalProductModel.findById(productId).lean();
        if (!product || !product.isPublished) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Product not found or not available');
        }

        const amount = product.discountPriceINR ?? product.priceINR;
        const orderNumber = generateOrderNumber();
        const downloadToken = crypto.randomBytes(24).toString('hex');

        // Check for duplicate pending transaction ID
        const existingTx = await DigitalProductOrderModel.findOne({
            transactionId: paymentData.transactionId.trim(),
            status: { $ne: 'rejected' },
        });
        if (existingTx) {
            throw new ApiError(
                StatusCodes.CONFLICT,
                'This PhonePe Transaction ID has already been submitted'
            );
        }

        const order = await DigitalProductOrderModel.create({
            orderNumber,
            product: product._id,
            productSnapshot: {
                title: product.title,
                slug: product.slug,
                software: product.software,
            },
            user: userId ? new Types.ObjectId(userId) : undefined,
            customer: {
                name: customerData.name,
                email: customerData.email.toLowerCase(),
                phone: customerData.phone,
                country: 'IN',
            },
            paymentMethod: 'PhonePe_Manual',
            currency: 'INR',
            amount,
            transactionId: paymentData.transactionId.trim(),
            senderNumber: paymentData.senderPhonePe.trim(),
            status: 'pending',
            downloadToken,
        });

        // Trigger manual submission received email
        try {
            await sendDigitalProductManualSubmittedEmail(
                order.customer.email,
                order.customer.name,
                product.title,
                order.orderNumber
            );
        } catch (err) {
            logger.warn({ err }, 'Failed to queue manual order submission email');
        }

        return {
            orderNumber: order.orderNumber,
            status: 'pending',
            message: 'PhonePe manual payment submitted successfully. Your files will be unlocked upon verification.',
        };
    }

    /**
     * Finalize SSLCommerz payment callback/webhook
     */
    static async finalizeSSLCommerzPayment(
        transactionId: string,
        gatewayStatus: string,
        valId?: string
    ): Promise<IDigitalProductOrder | null> {
        const order = await DigitalProductOrderModel.findOne({ transactionId });
        if (!order) {
            logger.warn({ transactionId }, 'SSLCommerz payment callback for unknown order');
            return null;
        }

        if (order.status === 'paid') {
            return order;
        }

        const isSuccess = valId || gatewayStatus.toUpperCase() === 'VALID';

        if (isSuccess) {
            order.status = 'paid';
            if (valId) order.valId = valId;
            order.gatewayResponse = {
                ...order.gatewayResponse,
                valId,
                status: 'paid',
                paidAt: new Date(),
            };
            await order.save();

            // Increment sales count
            await DigitalProductModel.findByIdAndUpdate(order.product, {
                $inc: { salesCount: 1 },
            });

            // Trigger download links email
            const product = await DigitalProductModel.findById(order.product).lean();
            if (product) {
                try {
                    await sendDigitalProductPurchasedEmail({
                        email: order.customer.email,
                        name: order.customer.name,
                        productTitle: product.title,
                        orderNumber: order.orderNumber,
                        scriptDownloadUrl: `${config.SERVER_URL}/api/v1/digital-products/download/${order.downloadToken}/script`,
                        guideDownloadUrl: `${config.SERVER_URL}/api/v1/digital-products/download/${order.downloadToken}/guide`,
                    });
                } catch (err) {
                    logger.warn({ err }, 'Failed to send digital product purchase email');
                }
            }
        } else {
            order.status = 'rejected';
            order.adminNote = `SSLCommerz payment failed: ${gatewayStatus}`;
            await order.save();
        }

        return order;
    }

    // --- Admin Orders Review ---

    static async listOrdersAdmin(query: {
        status?: DigitalProductOrderStatus;
        paymentMethod?: string;
        search?: string;
        page?: number;
        limit?: number;
    }) {
        const filter: FilterQuery<IDigitalProductOrder> = {};
        if (query.status) {
            filter.status = query.status;
        }
        if (query.paymentMethod) {
            filter.paymentMethod = query.paymentMethod;
        }
        if (query.search) {
            filter.$or = [
                { orderNumber: { $regex: query.search, $options: 'i' } },
                { transactionId: { $regex: query.search, $options: 'i' } },
                { 'customer.name': { $regex: query.search, $options: 'i' } },
                { 'customer.email': { $regex: query.search, $options: 'i' } },
                { 'customer.phone': { $regex: query.search, $options: 'i' } },
            ];
        }

        const page = Math.max(1, Number(query.page) || 1);
        const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            DigitalProductOrderModel.find(filter)
                .populate('product', 'title slug software thumbnail')
                .populate('reviewedBy', 'name email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            DigitalProductOrderModel.countDocuments(filter),
        ]);

        return {
            data,
            meta: {
                page,
                limit,
                total,
                totalPage: Math.ceil(total / limit),
            },
        };
    }

    static async reviewOrderAdmin(
        orderId: string,
        status: 'paid' | 'rejected',
        adminNote?: string,
        adminUserId?: string
    ) {
        const order = await DigitalProductOrderModel.findById(orderId);
        if (!order) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Digital product order not found');
        }

        const wasAlreadyPaid = order.status === 'paid';
        order.status = status;
        if (adminNote) order.adminNote = adminNote;
        if (adminUserId) order.reviewedBy = new Types.ObjectId(adminUserId);
        order.reviewedAt = new Date();
        await order.save();

        if (status === 'paid' && !wasAlreadyPaid) {
            // Increment sales
            await DigitalProductModel.findByIdAndUpdate(order.product, {
                $inc: { salesCount: 1 },
            });

            // Trigger success email
            const product = await DigitalProductModel.findById(order.product).lean();
            if (product) {
                try {
                    await sendDigitalProductPurchasedEmail({
                        email: order.customer.email,
                        name: order.customer.name,
                        productTitle: product.title,
                        orderNumber: order.orderNumber,
                        scriptDownloadUrl: `${config.SERVER_URL}/api/v1/digital-products/download/${order.downloadToken}/script`,
                        guideDownloadUrl: `${config.SERVER_URL}/api/v1/digital-products/download/${order.downloadToken}/guide`,
                    });
                } catch (err) {
                    logger.warn({ err }, 'Failed to send order approval email');
                }
            }
        }

        return order;
    }

    static async getOrdersStatsAdmin() {
        const [totalRevenueBDTRes, totalRevenueINRRes, totalOrders, pendingManualOrders, paidOrders] =
            await Promise.all([
                DigitalProductOrderModel.aggregate([
                    { $match: { status: 'paid', currency: 'BDT' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } },
                ]),
                DigitalProductOrderModel.aggregate([
                    { $match: { status: 'paid', currency: 'INR' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } },
                ]),
                DigitalProductOrderModel.countDocuments(),
                DigitalProductOrderModel.countDocuments({ status: 'pending', paymentMethod: 'PhonePe_Manual' }),
                DigitalProductOrderModel.countDocuments({ status: 'paid' }),
            ]);

        return {
            totalRevenueBDT: totalRevenueBDTRes[0]?.total ?? 0,
            totalRevenueINR: totalRevenueINRRes[0]?.total ?? 0,
            totalOrders,
            pendingManualOrders,
            paidOrders,
        };
    }

    // --- Secure Downloads & Student Access ---

    static async verifyDownloadAccess(token: string, fileType: 'script' | 'guide') {
        const order = await DigitalProductOrderModel.findOne({ downloadToken: token });
        if (!order) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Invalid download link');
        }

        if (order.status !== 'paid') {
            throw new ApiError(StatusCodes.FORBIDDEN, 'Payment not confirmed yet. Access is locked.');
        }

        const product = await DigitalProductModel.findById(order.product).lean();
        if (!product) {
            throw new ApiError(StatusCodes.NOT_FOUND, 'Product file no longer exists');
        }

        // Increment download counter
        order.downloadCount += 1;
        await order.save();

        const file = fileType === 'script' ? product.scriptFile : product.guidePdf;
        return {
            url: file.url,
            fileName: file.fileName,
            productTitle: product.title,
        };
    }

    static async getMyPurchasedProducts(userEmail: string, userId?: string) {
        const filter: FilterQuery<IDigitalProductOrder> = {
            status: 'paid',
            $or: [{ 'customer.email': userEmail.toLowerCase() }],
        };
        if (userId) {
            filter.$or?.push({ user: new Types.ObjectId(userId) });
        }

        const orders = await DigitalProductOrderModel.find(filter)
            .populate('product')
            .sort({ createdAt: -1 })
            .lean();

        return orders.map((o) => {
            const prod = o.product as any;
            return {
                orderNumber: o.orderNumber,
                transactionId: o.transactionId,
                paymentMethod: o.paymentMethod,
                status: o.status,
                paidAt: o.reviewedAt || o.updatedAt,
                amount: o.amount,
                currency: o.currency,
                product: prod
                    ? {
                          title: prod.title,
                          slug: prod.slug,
                          software: prod.software,
                          thumbnail: prod.thumbnail,
                          features: prod.features,
                          scriptFileName: prod.scriptFile?.fileName,
                          guideFileName: prod.guidePdf?.fileName,
                      }
                    : o.productSnapshot,
                downloadToken: o.downloadToken,
                scriptDownloadUrl: `${config.SERVER_URL}/api/v1/digital-products/download/${o.downloadToken}/script`,
                guideDownloadUrl: `${config.SERVER_URL}/api/v1/digital-products/download/${o.downloadToken}/guide`,
            };
        });
    }

    static async uploadAsset(file: Express.Multer.File) {
        if (!file || !file.buffer) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'No file buffer provided for upload');
        }

        if (!isCloudinaryConfigured) {
            throw new ApiError(
                StatusCodes.INTERNAL_SERVER_ERROR,
                'Cloudinary storage is not configured on the server. Please check Cloudinary credentials.'
            );
        }

        const ext = path.extname(file.originalname).toLowerCase();
        const isImage = file.mimetype?.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext);

        const formatFileSize = (bytes: number): string => {
            if (!bytes || bytes <= 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
        };

        const uploadBufferToCloudinary = (options: Record<string, unknown>): Promise<any> =>
            new Promise<any>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new ApiError(StatusCodes.REQUEST_TIMEOUT, 'Cloudinary upload timeout - please try again'));
                }, 60000);

                const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
                    clearTimeout(timeout);
                    if (error) {
                        logger.error(error, 'Cloudinary digital asset upload error');
                        reject(
                            new ApiError(
                                StatusCodes.INTERNAL_SERVER_ERROR,
                                `Upload to Cloudinary failed: ${error.message || 'Unknown error'}`
                            )
                        );
                    } else {
                        resolve(result);
                    }
                });

                uploadStream.on('error', (err) => {
                    clearTimeout(timeout);
                    logger.error(err, 'Cloudinary upload stream error');
                    reject(new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Cloudinary upload stream failed'));
                });

                uploadStream.end(file.buffer);
            });

        let uploadOptions: Record<string, unknown>;
        if (isImage) {
            uploadOptions = {
                folder: 'misun-academy/digital-products/thumbnails',
                resource_type: 'image',
                allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'svg'],
            };
        } else {
            // raw file (.jsx, .js, .pdf, .zip, etc.)
            const sanitizedBase = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9_-]/g, '_');
            const safePublicId = `${sanitizedBase}-${Date.now()}${ext}`;
            uploadOptions = {
                folder: 'misun-academy/digital-products/files',
                resource_type: 'raw',
                type: 'upload',          // explicitly public — prevents 'authenticated' default
                access_mode: 'public',   // ensure public access
                public_id: safePublicId,
            };
        }

        const result = await uploadBufferToCloudinary(uploadOptions);

        return {
            url: result.secure_url,
            publicId: result.public_id,
            fileName: file.originalname,
            fileSize: formatFileSize(file.size),
            fileSizeBytes: file.size,
            format: result.format || ext.replace('.', ''),
            resourceType: result.resource_type || (isImage ? 'image' : 'raw'),
        };
    }

    static getCallbackKey(transactionId: string): string {
        return getCallbackKey(transactionId);
    }
}
