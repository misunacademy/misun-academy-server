import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { AnnouncementService } from './announcement.service.js';
import { AnnouncementAudience, AnnouncementStatus, AnnouncementType } from './announcement.interface.js';

const createAnnouncement = catchAsync(async (req: Request, res: Response) => {
  const { id: actorId } = req.user as any;
  const result = await AnnouncementService.createAnnouncement(req.body, { id: actorId }, req.ip);
  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Announcement created successfully',
    data: result,
  });
});

const listAnnouncements = catchAsync(async (req: Request, res: Response) => {
  const { status, audience, search, page, limit } = req.query as {
    status?: AnnouncementStatus;
    audience?: AnnouncementAudience;
    search?: string;
    page?: string;
    limit?: string;
  };
  const result = await AnnouncementService.listAnnouncements({
    status,
    audience,
    search,
    page: page ? Number(page) : undefined,
    limit: limit ? Number(limit) : undefined,
  });
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Announcements retrieved successfully',
    data: result.data,
    meta: result.meta,
  });
});

const getAnnouncementById = catchAsync(async (req: Request, res: Response) => {
  const a = await AnnouncementService.getAnnouncementById(req.params.id as string);
  if (!a) {
    return sendResponse(res, {
      statusCode: StatusCodes.NOT_FOUND,
      success: false,
      message: 'Announcement not found',
      data: null,
    });
  }
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Announcement retrieved successfully',
    data: a,
  });
});

const updateAnnouncement = catchAsync(async (req: Request, res: Response) => {
  const { id: actorId } = req.user as any;
  const updated = await AnnouncementService.updateAnnouncement(
    req.params.id as string,
    req.body,
    { id: actorId },
    req.ip
  );
  if (!updated) {
    return sendResponse(res, {
      statusCode: StatusCodes.NOT_FOUND,
      success: false,
      message: 'Announcement not found',
      data: null,
    });
  }
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Announcement updated successfully',
    data: updated,
  });
});

const deleteAnnouncement = catchAsync(async (req: Request, res: Response) => {
  const { id: actorId } = req.user as any;
  const deleted = await AnnouncementService.deleteAnnouncement(req.params.id as string, { id: actorId }, req.ip);
  if (!deleted) {
    return sendResponse(res, {
      statusCode: StatusCodes.NOT_FOUND,
      success: false,
      message: 'Announcement not found',
      data: null,
    });
  }
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Announcement deleted successfully',
    data: null,
  });
});

const publishAnnouncement = catchAsync(async (req: Request, res: Response) => {
  const { id: actorId } = req.user as any;
  const published = await AnnouncementService.publishAnnouncement(req.params.id as string, { id: actorId }, req.ip);
  if (!published) {
    return sendResponse(res, {
      statusCode: StatusCodes.NOT_FOUND,
      success: false,
      message: 'Announcement not found',
      data: null,
    });
  }
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Announcement published and notifications queued',
    data: published,
  });
});

const getAnnouncementStats = catchAsync(async (_req: Request, res: Response) => {
  const stats = await AnnouncementService.getAnnouncementStats();
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Announcement stats retrieved successfully',
    data: stats,
  });
});

const getLiveAnnouncements = catchAsync(async (req: Request, res: Response) => {
  const role = ((req.user as any)?.role as string) || AnnouncementAudience.All;
  const audience = (req.query.audience as string) || role;
  const limit = req.query.limit ? Number(req.query.limit) : 5;
  const items = await AnnouncementService.getLiveAnnouncements(audience, limit);
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Live announcements retrieved successfully',
    data: items,
  });
});

const announcementTypeValues = Object.values(AnnouncementType);
const announcementAudienceValues = Object.values(AnnouncementAudience);
const announcementStatusValues = Object.values(AnnouncementStatus);

const getAnnouncementMeta = catchAsync(async (_req: Request, res: Response) => {
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Announcement metadata retrieved',
    data: {
      types: announcementTypeValues,
      audiences: announcementAudienceValues,
      statuses: announcementStatusValues,
    },
  });
});

export const AnnouncementController = {
  createAnnouncement,
  listAnnouncements,
  getAnnouncementById,
  updateAnnouncement,
  deleteAnnouncement,
  publishAnnouncement,
  getAnnouncementStats,
  getLiveAnnouncements,
  getAnnouncementMeta,
};
