import { v2 as cloudinary } from 'cloudinary';
import env from './env.js';

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
        console.warn('⚠️  Cloudinary credentials not configured. Image uploads will fail.');
        console.warn('   Missing environment variables:', missing.join(', '));
        console.warn('   Please set these in your .env file');
        return false;
    }

    // Test the configuration
    try {
        cloudinary.api.ping((error, result) => {
            if (error) {
                console.error('❌ Cloudinary configuration test failed:', error.message);
            } else {
                console.log('✅ Cloudinary configuration is valid');
            }
        });
    } catch (error) {
        console.error('❌ Cloudinary configuration error:', error);
    }

    return true;
};

const isCloudinaryConfigured = validateCloudinaryConfig();

export { isCloudinaryConfigured };
export default cloudinary;
