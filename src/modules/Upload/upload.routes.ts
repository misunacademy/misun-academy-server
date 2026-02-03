import express from 'express';
import { UploadController } from './upload.controller';
import { upload, handleMulterError } from '../../middlewares/upload';
import { requireAuth } from '../../middlewares/betterAuth';

const router = express.Router();

/**
 * @route   POST /api/v1/upload/single
 * @desc    Upload single image
 * @access  Protected (all authenticated users can upload based on role)
 */
router.post(
    '/single',
    requireAuth,  // All authenticated users can upload
    upload.single('image'), // Field name must be 'image'
    handleMulterError,
    UploadController.uploadSingle
);

/**
 * @route   POST /api/v1/upload/multiple
 * @desc    Upload multiple images (max 10)
 * @access  Protected
 */
router.post(
    '/multiple',
    requireAuth,
    upload.array('images', 10), // Field name must be 'images', max 10 files
    handleMulterError,
    UploadController.uploadMultiple
);

/**
 * @route   POST /api/v1/upload/with-data
 * @desc    Upload image with additional form data
 * @access  Protected
 */
router.post(
    '/with-data',
    requireAuth,
    upload.single('image'),
    handleMulterError,
    UploadController.uploadWithData
);

/**
 * @route   DELETE /api/v1/upload/:publicId
 * @desc    Delete image from Cloudinary
 * @access  Protected (only owner or admin can delete)
 */
router.delete(
    '/:publicId',
    requireAuth,
    UploadController.deleteImage
);

export const UploadRoutes = router;
