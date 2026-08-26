import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { UploadService } from './upload.service.js';
import { UploadAssetModel } from '../../models/uploadAsset.model.js';
import ApiError from '../../errors/ApiError.js';
import { logger } from '../../config/logger.js';

const recordUploadAsset = async (
    publicId: string | undefined,
    uploadedBy: string | undefined,
    delivery: 'public' | 'authenticated'
) => {
    if (!publicId || !uploadedBy) return;
    try {
        await UploadAssetModel.updateOne(
            { publicId },
            { $setOnInsert: { publicId, uploadedBy, delivery } },
            { upsert: true }
        );
    } catch (error) {
        logger.error(error, 'Failed to record upload asset ownership');
    }
};

/**
 * Upload single image
 * @route POST /api/v1/upload/single
 * @access Public (can add auth middleware if needed)
 */
const uploadSingle = catchAsync(async (req: Request, res: Response) => {
    if (!req.file) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'No file uploaded. Please select an image file.');
    }

    try {
        const result = await UploadService.processSingleUpload(req.file);
        await recordUploadAsset(result.publicId, (req as any).user?.id, 'public');

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Image uploaded successfully',
            data: result,
        });
    } catch (error: any) {
        logger.error(error, 'Single upload error');
        const errorMessage = error?.message || 'Failed to upload image. Please check Cloudinary configuration.';
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, errorMessage);
    }
});

/**
 * Upload multiple images
 * @route POST /api/v1/upload/multiple
 * @access Public (can add auth middleware if needed)
 */
const uploadMultiple = catchAsync(async (req: Request, res: Response) => {
    if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'No files uploaded');
    }

    try {
        const result = await UploadService.processMultipleUploads(req.files as Express.Multer.File[]);
        await Promise.all(
            result.files.map((f) => recordUploadAsset(f.publicId, (req as any).user?.id, 'public'))
        );

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: `${result.totalFiles} image(s) uploaded successfully`,
            data: result,
        });
    } catch (error: any) {
        logger.error(error, 'Multiple upload error');
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to upload multiple images');
    }
});

/**
 * Upload restricted (authenticated-delivery) asset for sensitive documents
 * Returns publicId — the stored value; delivery only via signed endpoint
 */
const uploadRestricted = catchAsync(async (req: Request, res: Response) => {
    if (!req.file) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'No file uploaded. Please select an image file.');
    }

    try {
        const result = await UploadService.processRestrictedUpload(req.file);
        await recordUploadAsset(result.publicId, (req as any).user?.id, 'authenticated');

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Document uploaded successfully',
            data: { ...result, uploadedBy: (req as any).user?.id },
        });
    } catch (error: any) {
        logger.error(error, 'Restricted upload error');
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            error?.message || 'Failed to upload document'
        );
    }
});

/**
 * Delete image from Cloudinary
 * Allowed for the uploader or an admin. Legacy assets with no ownership
 * record can only be removed by admins.
 */
const deleteImage = catchAsync(async (req: Request, res: Response) => {
    const { publicId } = req.params as { publicId: string };
    const user = (req as any).user as { id: string; role: string } | undefined;

    if (!publicId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Public ID is required');
    }

    const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

    if (!isAdmin) {
        const asset = await UploadAssetModel.findOne({ publicId }).lean();
        if (!asset || asset.uploadedBy?.toString() !== user?.id) {
            throw new ApiError(
                StatusCodes.FORBIDDEN,
                'You do not have permission to delete this asset'
            );
        }
    }

    try {
        await UploadService.deleteImage(publicId);
        await UploadAssetModel.deleteOne({ publicId });

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Image deleted successfully',
            data: null,
        });
    } catch (error: any) {
        logger.error(error, 'Delete image error');
        throw error;
    }
});

/**
 * Upload with additional data (e.g., student submission)
 * @route POST /api/v1/upload/with-data
 * @access Public
 */
const uploadWithData = catchAsync(async (req: Request, res: Response) => {
    if (!req.file) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'No file uploaded');
    }

    try {
        const imageResult = await UploadService.processSingleUpload(req.file);
        await recordUploadAsset(imageResult.publicId, (req as any).user?.id, 'public');

        // Extract additional form data
        const { title, description, category } = req.body;

        // You can save this data to your database here
        const responseData = {
            image: imageResult,
            metadata: {
                title: title || 'Untitled',
                description: description || '',
                category: category || 'general',
            },
            uploadedBy: (req as any).user?.id || 'anonymous', // If auth is implemented
        };

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Image and data uploaded successfully',
            data: responseData,
        });
    } catch (error: any) {
        logger.error(error, 'Upload with data error');
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to upload image with data');
    }
});

export const UploadController = {
    uploadSingle,
    uploadRestricted,
    uploadMultiple,
    deleteImage,
    uploadWithData,
};
