import { v2 as cloudinary } from 'cloudinary';
import env from './env.js';
import { logger } from './logger.js';

cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
});

// Validate Cloudinary configuration
const validateCloudinaryConfig = () => {
    const required = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        logger.warn('Cloudinary credentials not configured. Image uploads will fail.');
        logger.warn({ missing }, 'Missing Cloudinary environment variables');
        return false;
    }

    // Test the configuration
    try {
        cloudinary.api.ping((error) => {
            if (error) {
                logger.error(error, 'Cloudinary configuration test failed');
            } else {
                logger.info('Cloudinary configuration is valid');
            }
        });
    } catch (error) {
        logger.error(error, 'Cloudinary configuration error');
    }

    return true;
};

const isCloudinaryConfigured = validateCloudinaryConfig();

export { isCloudinaryConfigured };
export default cloudinary;
