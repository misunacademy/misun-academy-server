import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';
import { SettingsService } from './settings.service.js';
import { recordAudit } from '../../models/auditLog.model.js';

const getSettings = catchAsync(async (req: Request, res: Response) => {
  const result = await SettingsService.getSettings();
  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Settings retrieved successfully',
    data: result,
  });
});

const updateSettings = catchAsync(async (req: Request, res: Response) => {
  const result = await SettingsService.updateSettings(req.body);

  const { id: actorId } = req.user as any;
  await recordAudit({
    actor: actorId,
    action: 'settings.update',
    targetType: 'Settings',
    targetId: (result as any)?._id?.toString(),
    metadata: { fields: Object.keys(req.body ?? {}) },
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Settings updated successfully',
    data: result,
  });
});

export const SettingsController = {
  getSettings,
  updateSettings,
};