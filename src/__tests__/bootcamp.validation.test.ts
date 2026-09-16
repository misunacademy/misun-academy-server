import { describe, expect, it } from '@jest/globals';
import { registerBootcampValidationSchema } from '../modules/Bootcamp/bootcamp.validation.js';
import {
  addBootcampVideoSchema,
  updateBootcampVideoSchema,
  deleteBootcampVideoSchema,
  publishRecordingSchema,
} from '../modules/Bootcamp/bootcampCatalog.validation.js';

const objectId = '507f1f77bcf86cd799439011';

const basePayload = {
  name: 'Test User',
  address: 'Dhaka, Bangladesh',
  email: 'user@example.com',
  paymentLast4: '1234',
};

describe('bootcamp registration validation', () => {
  it.each<[string, string]>([
    ['Bangladesh', '01712345678'],
    ['India', '9876543210'],
    ['India with country code', '+919876543210'],
    ['United States', '+12125550123'],
    ['United Kingdom', '+442079460958'],
    ['Germany', '+4915123456789'],
    ['Egypt', '+201001234567'],
  ])('accepts a WhatsApp number from %s', (_country, whatsapp) => {
    const result = registerBootcampValidationSchema.safeParse({
      body: { ...basePayload, whatsapp },
    });

    expect(result.success).toBe(true);
  });

  it('accepts an empty whatsapp field', () => {
    const result = registerBootcampValidationSchema.safeParse({
      body: { ...basePayload, whatsapp: '' },
    });

    expect(result.success).toBe(true);
  });

  it('strips undeclared fields like status and adminNote from the body', () => {
    const result = registerBootcampValidationSchema.safeParse({
      body: {
        ...basePayload,
        status: 'verified',
        adminNote: 'self-verified',
        reviewedBy: '507f1f77bcf86cd799439011',
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data.body)).not.toContain('status');
    expect(Object.keys(result.data.body)).not.toContain('adminNote');
    expect(Object.keys(result.data.body)).not.toContain('reviewedBy');
  });
});

describe('bootcamp video validation', () => {
  const videoBody = {
    title: 'Session 1 — Introduction',
    videoSource: 'youtube',
    videoId: 'https://www.youtube.com/watch?v=abc123',
    duration: 3600,
  };

  it('accepts a valid add-video payload', () => {
    const result = addBootcampVideoSchema.safeParse({
      params: { id: objectId },
      body: videoBody,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.body.title).toBe('Session 1 — Introduction');
    expect(result.data.body.duration).toBe(3600);
  });

  it('rejects a video without videoId', () => {
    const result = addBootcampVideoSchema.safeParse({
      params: { id: objectId },
      body: { title: 'No video', videoSource: 'youtube' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported video source', () => {
    const result = addBootcampVideoSchema.safeParse({
      params: { id: objectId },
      body: { ...videoBody, videoSource: 'vimeo' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a partial update-video payload', () => {
    const result = updateBootcampVideoSchema.safeParse({
      params: { id: objectId, videoId: objectId },
      body: { isPublished: false },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.body.isPublished).toBe(false);
  });

  it('validates the video delete params', () => {
    const result = deleteBootcampVideoSchema.safeParse({
      params: { id: objectId, videoId: objectId },
    });
    expect(result.success).toBe(true);
  });
});

describe('bootcamp publish-recording validation', () => {
  it('accepts an empty body (publish uses the bootcamp own videos)', () => {
    const result = publishRecordingSchema.safeParse({
      params: { id: objectId },
      body: {},
    });
    expect(result.success).toBe(true);
  });

  it('accepts an optional recordedPrice override', () => {
    const result = publishRecordingSchema.safeParse({
      params: { id: objectId },
      body: { recordedPrice: 499 },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.body.recordedPrice).toBe(499);
  });

  it('rejects sourceBatchId — batch copying is no longer supported', () => {
    const result = publishRecordingSchema.safeParse({
      params: { id: objectId },
      body: { sourceBatchId: objectId },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data.body)).not.toContain('sourceBatchId');
  });
});
