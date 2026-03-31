import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { UploadService } from './upload.service.js';
import ApiError from '../../errors/ApiError.js';

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

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Image uploaded successfully',
            data: result,
        });
    } catch (error: any) {
        console.error('Single upload error:', error);
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

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: `${result.totalFiles} image(s) uploaded successfully`,
            data: result,
        });
    } catch (error: any) {
        console.error('Multiple upload error:', error);
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to upload multiple images');
    }
});

/**
 * Delete image from Cloudinary
 * @route DELETE /api/v1/upload/:publicId
 * @access Public (add auth middleware for production)
 */
const deleteImage = catchAsync(async (req: Request, res: Response) => {
    const { publicId } = req.params as { publicId: string };

    if (!publicId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Public ID is required');
    }

    try {
        await UploadService.deleteImage(publicId);

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            success: true,
            message: 'Image deleted successfully',
            data: null,
        });
    } catch (error: any) {
        console.error('Delete image error:', error);
        throw error; // Re-throw the ApiError from service
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
        console.error('Upload with data error:', error);
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to upload image with data');
    }
});

export const UploadController = {
    uploadSingle,
    uploadMultiple,
    deleteImage,
    uploadWithData,
};
