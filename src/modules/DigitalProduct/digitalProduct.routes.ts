import express from 'express';
import path from 'path';
import multer from 'multer';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';
import { DigitalProductController } from './digitalProduct.controller.js';
import {
    createDigitalProductSchema,
    updateDigitalProductSchema,
    initiateSSLCommerzOrderSchema,
    submitPhonePeManualOrderSchema,
    reviewDigitalProductOrderSchema,
} from './digitalProduct.validation.js';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';
import validateRequest from '../../middlewares/validateRequest.js';
import { createRateLimiter } from '../../middlewares/rateLimit.js';

const router = express.Router();

const assetUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
    },
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const allowedExtensions = [
            '.jsx',
            '.js',
            '.zip',
            '.rar',
            '.pdf',
            '.png',
            '.jpg',
            '.jpeg',
            '.webp',
            '.svg',
            '.json',
            '.txt',
        ];
        if (allowedExtensions.includes(ext) || file.mimetype?.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(
                new ApiError(
                    StatusCodes.BAD_REQUEST,
                    `অননুমোদিত ফাইল ফরম্যাট (${ext})। স্ক্রিপ্ট (.jsx, .js, .zip), গাইড (.pdf) ও ছবি আপলোড করতে পারবেন।`
                )
            );
        }
    },
});

const handleAssetUploadMiddleware = (req: any, res: any, next: any) => {
    assetUpload.single('file')(req, res, (err: any) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(StatusCodes.BAD_REQUEST).json({
                        success: false,
                        message: 'ফাইলের আকার ৫০ মেগাবাইট (50MB) এর চেয়ে বেশি হতে পারবে না',
                    });
                }
                return res.status(StatusCodes.BAD_REQUEST).json({
                    success: false,
                    message: err.message,
                });
            }
            return res.status(err.statusCode || StatusCodes.BAD_REQUEST).json({
                success: false,
                message: err.message || 'ফাইল আপলোড ব্যর্থ হয়েছে',
            });
        }
        next();
    });
};

const orderLimiter = createRateLimiter({
    prefix: 'digital-product-order',
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'Too many order attempts, please try again later',
});

// --- Public Endpoints ---
router.get('/bootcamp', DigitalProductController.getBootcampProducts);
router.get('/products/:slug', DigitalProductController.getProductBySlug);

router.post(
    '/checkout/sslcommerz',
    orderLimiter,
    requireAuth,
    validateRequest(initiateSSLCommerzOrderSchema),
    DigitalProductController.initiateSSLCommerz
);

router.post(
    '/checkout/phonepe-manual',
    orderLimiter,
    requireAuth,
    validateRequest(submitPhonePeManualOrderSchema),
    DigitalProductController.submitPhonePeManual
);

// SSLCommerz payment callback & webhook
router.get('/payments/status', DigitalProductController.paymentStatusCallback);
router.post('/payments/status', DigitalProductController.paymentStatusCallback);
router.post(
    '/payments/webhook',
    express.urlencoded({ extended: true }),
    express.json(),
    DigitalProductController.paymentWebhook
);

// Secure file downloads
router.get('/download/:token/:fileType', DigitalProductController.downloadFile);

// Student dashboard
router.get('/my-purchases', requireAuth, DigitalProductController.getMyPurchasedProducts);

// --- Admin Endpoints ---
router.use('/admin', requireAuth, requireAdmin);

router.post(
    '/admin/upload-asset',
    handleAssetUploadMiddleware,
    DigitalProductController.uploadAssetAdmin
);

router.get('/admin/products', DigitalProductController.getAllProductsAdmin);
router.post(
    '/admin/products',
    validateRequest(createDigitalProductSchema),
    DigitalProductController.createProductAdmin
);
router.patch(
    '/admin/products/:id',
    validateRequest(updateDigitalProductSchema),
    DigitalProductController.updateProductAdmin
);
router.delete('/admin/products/:id', DigitalProductController.deleteProductAdmin);

router.get('/admin/orders', DigitalProductController.listOrdersAdmin);
router.get('/admin/orders/stats', DigitalProductController.getOrdersStatsAdmin);
router.patch(
    '/admin/orders/:id/review',
    validateRequest(reviewDigitalProductOrderSchema),
    DigitalProductController.reviewOrderAdmin
);

export const DigitalProductRoutes = router;
