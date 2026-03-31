import express from 'express';
import { CertificateController } from './certificate.controller.js';
import { requireAuth, requireAdmin } from '../../middlewares/betterAuth.js';

const router = express.Router();

// Public route - verify certificate
router.get('/verify/:certificateId', CertificateController.verifyCertificate);

// Student routes - request certificate
router.post(
    '/request/:enrollmentId',
    requireAuth,
    CertificateController.requestCertificate
);

// Authenticated routes - view certificates
router.get(
    '/my-certificates',
    requireAuth,
    CertificateController.getMyCertificates
);

router.get(
    '/enrollment/:enrollmentId',
    requireAuth,
    CertificateController.getCertificate
);

router.get(
    '/enrollment/:enrollmentId/eligibility',
    requireAuth,
    CertificateController.checkEligibility
);

// Admin routes - manage certificates
router.get(
    '/',
    requireAuth,
    requireAdmin,
    CertificateController.getCertificates
);

router.get(
    '/pending',
    requireAuth,
    requireAdmin,
    CertificateController.getPendingCertificates
);

router.post(
    '/approve/:certificateId',
    requireAuth,
    requireAdmin,
    CertificateController.approveCertificate
);

router.post(
    '/issue/:enrollmentId',
    requireAuth,
    requireAdmin,
    CertificateController.issueCertificate
);

router.put(
    '/:certificateId',
    requireAuth,
    requireAdmin,
    CertificateController.updateCertificate
);

router.put(
    '/revoke/:certificateId',
    requireAuth,
    requireAdmin,
    CertificateController.revokeCertificate
);

export const CertificateRoutes = router;
