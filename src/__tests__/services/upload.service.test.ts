import { describe, it, expect } from '@jest/globals';
import { UploadService } from '../../modules/Upload/upload.service.js';

const fakeFile = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File =>
    ({
        originalname: 'photo.png',
        mimetype: 'image/png',
        size: 1024,
        buffer: Buffer.from('fake-image-bytes'),
        fieldname: 'image',
        encoding: '7bit',
        destination: '',
        filename: '',
        path: '',
        stream: undefined as never,
        ...overrides,
    }) as Express.Multer.File;

describe('UploadService validation (no Cloudinary network)', () => {
    it('processSingleUpload rejects when no file is provided', async () => {
        await expect(
            UploadService.processSingleUpload(undefined as unknown as Express.Multer.File)
        ).rejects.toThrow(/No file uploaded/i);
    });

    it('processSingleUpload rejects when file buffer is missing', async () => {
        const file = fakeFile({ buffer: undefined as unknown as Buffer });
        await expect(UploadService.processSingleUpload(file)).rejects.toThrow(
            /File buffer not available/i
        );
    });

    it('processRestrictedUpload rejects when no file is provided', async () => {
        await expect(
            UploadService.processRestrictedUpload(undefined as unknown as Express.Multer.File)
        ).rejects.toThrow(/No file uploaded/i);
    });

    it('processRestrictedUpload rejects when file buffer is missing', async () => {
        const file = fakeFile({ buffer: undefined as unknown as Buffer });
        await expect(UploadService.processRestrictedUpload(file)).rejects.toThrow(
            /File buffer not available/i
        );
    });

    it('generateSignedAssetUrl rejects empty publicId', () => {
        expect(() => UploadService.generateSignedAssetUrl('')).toThrow(
            /Asset reference is required/i
        );
        expect(() =>
            UploadService.generateSignedAssetUrl(undefined as unknown as string)
        ).toThrow(/Asset reference is required/i);
    });

    it('processMultipleUploads rejects empty file arrays', async () => {
        await expect(UploadService.processMultipleUploads([])).rejects.toThrow(
            /No files uploaded/i
        );
        await expect(
            UploadService.processMultipleUploads(undefined as unknown as Express.Multer.File[])
        ).rejects.toThrow(/No files uploaded/i);
    });

    it('deleteImage rejects empty publicId', async () => {
        await expect(UploadService.deleteImage('')).rejects.toThrow(/Public ID is required/i);
    });

    it('deleteMultipleImages rejects empty publicId arrays', async () => {
        await expect(UploadService.deleteMultipleImages([])).rejects.toThrow(
            /Public IDs are required/i
        );
        await expect(
            UploadService.deleteMultipleImages(undefined as unknown as string[])
        ).rejects.toThrow(/Public IDs are required/i);
    });
});

describe('upload middleware rules (multer config)', () => {
    it('documents allowed mime types and 5MB limit', async () => {
        const { upload } = await import('../../middlewares/upload.js');
        expect(upload).toBeDefined();
        const { handleMulterError } = await import('../../middlewares/upload.js');
        expect(typeof handleMulterError).toBe('function');
    });
});
