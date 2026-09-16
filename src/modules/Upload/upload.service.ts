import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError.js';
import cloudinary, { isCloudinaryConfigured } from '../../config/cloudinary.js';
import { IUploadResult, IMultipleUploadResult } from './upload.interface.js';

const RESTRICTED_NID_FOLDER = 'misun-academy/employees/nid';

const uploadBufferToCloudinary = (
    file: Express.Multer.File,
    options: Record<string, unknown>
): Promise<any> =>
    new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new ApiError(StatusCodes.REQUEST_TIMEOUT, 'Upload timeout - please try again'));
        }, 30000);

        const uploadStream = cloudinary.uploader.upload_stream(
            options as Record<string, unknown>,
            (error, result) => {
                clearTimeout(timeout);
                if (error) {
                    console.error('Cloudinary upload error:', error);
                    reject(new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to upload image to Cloudinary'));
                } else {
                    resolve(result);
                }
            }
        );

        uploadStream.on('error', (error) => {
            clearTimeout(timeout);
            console.error('Upload stream error:', error);
            reject(new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Upload stream failed'));
        });

        uploadStream.end(file.buffer);
    });

/**
 * Process single uploaded file from Multer buffer to Cloudinary
 */
const processSingleUpload = async (file: Express.Multer.File): Promise<IUploadResult> => {
    if (!file) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'No file uploaded');
    }

    if (!file.buffer) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'File buffer not available');
    }

    if (!isCloudinaryConfigured) {
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Image upload service is not configured. Please check Cloudinary credentials.');
    }

    try {
        const result = await uploadBufferToCloudinary(file, {
            folder: 'misun-academy',
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
            transformation: [
                { width: 1000, height: 1000, crop: 'limit' },
                { quality: 'auto' }
            ],
            resource_type: 'image',
        });

        return {
            url: result.secure_url,
            publicId: result.public_id,
            fileName: file.originalname,
            format: result.format,
            width: result.width || 0,
            height: result.height || 0,
            size: file.size,
            uploadedAt: new Date(),
        };
    } catch (error: any) {
        console.error('Upload service error:', error);
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            error.message || 'Failed to process image upload'
        );
    }
};

/**
 * Process a restricted (authenticated-delivery) upload for sensitive documents.
 * Assets are stored with type 'authenticated' so the CDN refuses unsigned requests;
 * access goes through generateSignedAssetUrl only.
 */
const processRestrictedUpload = async (file: Express.Multer.File): Promise<IUploadResult> => {
    if (!file) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'No file uploaded');
    }

    if (!file.buffer) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'File buffer not available');
    }

    if (!isCloudinaryConfigured) {
        throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Image upload service is not configured. Please check Cloudinary credentials.');
    }

    try {
        const result = await uploadBufferToCloudinary(file, {
            folder: RESTRICTED_NID_FOLDER,
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
            transformation: [
                { width: 1400, height: 1400, crop: 'limit' },
                { quality: 'auto' }
            ],
            resource_type: 'image',
            type: 'authenticated',
        });

        return {
            url: result.secure_url,
            publicId: result.public_id,
            fileName: file.originalname,
            format: result.format,
            width: result.width || 0,
            height: result.height || 0,
            size: file.size,
            uploadedAt: new Date(),
        };
    } catch (error: any) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            error.message || 'Failed to process restricted image upload'
        );
    }
};

/**
 * Build a signed delivery URL for an authenticated asset.
 */
const generateSignedAssetUrl = (publicId: string): string => {
    if (!publicId) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'Asset reference is required');
    }
    return cloudinary.url(publicId, {
        type: 'authenticated',
        sign_url: true,
        secure: true,
    });
};

/**
 * Process multiple uploaded files
 */
const processMultipleUploads = async (files: Express.Multer.File[]): Promise<IMultipleUploadResult> => {
    if (!files || files.length === 0) {
        throw new ApiError(StatusCodes.BAD_REQUEST, 'No files uploaded');
    }

    try {
        const processedFiles = await Promise.all(
            files.map(async (file) => {
                try {
                    return await processSingleUpload(file);
                } catch (error) {
                    console.error(`Failed to process file ${file.originalname}:`, error);
                    throw error;
                }
            })
        );

        return {
            files: processedFiles,
            totalFiles: processedFiles.length,
        };
    } catch {
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            'Failed to process multiple image uploads'
        );
    }
};

/**
 * Delete image from Cloudinary
 */
const deleteImage = async (publicId: string): Promise<void> => {
    try {
        if (!publicId) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Public ID is required');
        }

        const result = await cloudinary.uploader.destroy(publicId);

        if (result.result !== 'ok') {
            throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Failed to delete image from Cloudinary');
        }
    } catch (error: any) {
        console.error('Delete image error:', error);
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            error.message || 'Failed to delete image from Cloudinary'
        );
    }
};

/**
 * Delete multiple images from Cloudinary
 */
const deleteMultipleImages = async (publicIds: string[]): Promise<void> => {
    try {
        if (!publicIds || publicIds.length === 0) {
            throw new ApiError(StatusCodes.BAD_REQUEST, 'Public IDs are required');
        }

        const result = await cloudinary.api.delete_resources(publicIds);

        // Check if any deletions failed
        const failedDeletions = publicIds.filter(id => result.deleted[id] !== 'deleted');
        if (failedDeletions.length > 0) {
            console.warn('Some images failed to delete:', failedDeletions);
        }
    } catch (error: any) {
        console.error('Delete multiple images error:', error);
        throw new ApiError(
            StatusCodes.INTERNAL_SERVER_ERROR,
            error.message || 'Failed to delete images from Cloudinary'
        );
    }
};

export const UploadService = {
    processSingleUpload,
    processRestrictedUpload,
    generateSignedAssetUrl,
    processMultipleUploads,
    deleteImage,
    deleteMultipleImages,
};
