import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ProfileService } from './profile.service.js';
import  ApiError  from '../../errors/ApiError.js';
import  catchAsync  from '../../utils/catchAsync.js';
import sendResponse from '../../utils/sendResponse.js';

const createProfile = catchAsync(async (req: Request, res: Response) => {
  if (!req.user?.id) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');
  }

  const userId = req.user.id;
  const profileData = req.body;

  const result = await ProfileService.createProfile(userId, profileData);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Profile created successfully!',
    data: result,
  });
});

const getProfile = catchAsync(async (req: Request, res: Response) => {
  if (!req.user?.id) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');
  }

  const userId = req.user.id;
  const result = await ProfileService.getProfile(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Profile retrieved successfully!',
    data: result,
  });
});

const updateProfile = catchAsync(async (req: Request, res: Response) => {
  if (!req.user?.id) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');
  }

  const userId = req.user.id;
  const updateData = req.body;

  const result = await ProfileService.updateProfile(userId, updateData);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Profile updated successfully!',
    data: result,
  });
});

const deleteProfile = catchAsync(async (req: Request, res: Response) => {
  if (!req.user?.id) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');
  }

  const userId = req.user.id;
  const result = await ProfileService.deleteProfile(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Profile deleted successfully!',
    data: result,
  });
});

const updateInterests = catchAsync(async (req: Request, res: Response) => {
  if (!req.user?.id) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');
  }

  const userId = req.user.id;
  const { interests } = req.body;

  if (!Array.isArray(interests)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Interests must be an array');
  }

  const result = await ProfileService.updateInterests(userId, interests);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Interests updated successfully!',
    data: result,
  });
});

const addInterest = catchAsync(async (req: Request, res: Response) => {
  if (!req.user?.id) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');
  }

  const userId = req.user.id;
  const { interest } = req.body;

  if (!interest || typeof interest !== 'string') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Interest must be a non-empty string');
  }

  const result = await ProfileService.addInterest(userId, interest);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Interest added successfully!',
    data: result,
  });
});

const removeInterest = catchAsync(async (req: Request, res: Response) => {
  if (!req.user?.id) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');
  }

  const userId = req.user.id;
  const { interest } = req.body;

  if (!interest || typeof interest !== 'string') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Interest must be a non-empty string');
  }

  const result = await ProfileService.removeInterest(userId, interest);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Interest removed successfully!',
    data: result,
  });
});

const getCompleteStudentProfile = catchAsync(async (req: Request, res: Response) => {
  if (!req.user?.id) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');
  }

  const userId = req.user.id;
  const result = await ProfileService.getCompleteStudentProfile(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Complete student profile retrieved successfully!',
    data: result,
  });
});

const syncAllUserEnrollmentsToProfile = catchAsync(async (req: Request, res: Response) => {
  if (!req.user?.id) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, 'User not authenticated');
  }

  const userId = req.user.id;
  await ProfileService.syncAllUserEnrollmentsToProfile(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Profile synchronized with all enrollments successfully!',
    data: null,
  });
});

export const ProfileController = {
  createProfile,
  getProfile,
  updateProfile,
  deleteProfile,
  updateInterests,
  addInterest,
  removeInterest,
  // Centralized Profile Controllers
  getCompleteStudentProfile,
  syncAllUserEnrollmentsToProfile,
};