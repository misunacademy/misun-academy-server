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
    const missing = (
        [
            ['CLOUDINARY_CLOUD_NAME', env.CLOUDINARY_CLOUD_NAME],
            ['CLOUDINARY_API_KEY', env.CLOUDINARY_API_KEY],
            ['CLOUDINARY_API_SECRET', env.CLOUDINARY_API_SECRET],
        ] as const
    )
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (missing.length > 0) {
        logger.warn('Cloudinary credentials not configured. Image uploads will fail.');
        logger.warn({ missing }, 'Missing Cloudinary environment variables');
        return false;
    }

    // Test the configuration (skip in tests: no network in unit runs).
    if (env.NODE_ENV === 'test') {
        return true;
    }
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
