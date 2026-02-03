import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError';
import { ProfileModel } from './profile.model';
import { EnrollmentModel } from '../Enrollment/enrollment.model';
import { EnrollmentStatus } from '../../types/common';
import { IProfile } from './profile.interface';
import mongoose from 'mongoose';
import { UserModel } from '../User/user.model';

const createProfile = async (userId: string, profileData: Partial<IProfile>) => {
  const profile = await ProfileModel.create({
    user: userId,
    ...profileData,
  });
  return profile;
};

const getProfile = async (userId: string) => {
  const profile = await ProfileModel.findOne({ user: userId });
  return profile;
};

const updateProfile = async (userId: string, updateData: any) => {
  const { avatar, name, ...profileData } = updateData;

  // Update user model if avatar or name is provided
  if (avatar || name) {
    await UserModel.findOneAndUpdate(
      { _id: userId },
      { $set: { ...(avatar && { image: avatar }), ...(name && { name }) } },
      { new: true, runValidators: true }
    );
  }

  // Update or create profile with remaining data
  const profile = await ProfileModel.findOneAndUpdate(
    { user: userId },
    { $set: profileData },
    { new: true, upsert: true, runValidators: true }
  );

  return profile;
};

const deleteProfile = async (userId: string) => {
  const result = await ProfileModel.findOneAndDelete({ user: userId });
  return result;
};

const updateInterests = async (userId: string, interests: string[]) => {
  const profile = await ProfileModel.findOneAndUpdate(
    { user: userId },
    { $set: { areasOfInterest: interests } },
    { new: true, upsert: true }
  );
  return profile;
};

const addInterest = async (userId: string, interest: string) => {
  const profile = await ProfileModel.findOneAndUpdate(
    { user: userId },
    { $addToSet: { areasOfInterest: interest } },
    { new: true, upsert: true }
  );
  return profile;
};

const removeInterest = async (userId: string, interest: string) => {
  const profile = await ProfileModel.findOneAndUpdate(
    { user: userId },
    { $pull: { areasOfInterest: interest } },
    { new: true }
  );
  return profile;
};

/**
 * CENTRALIZED STUDENT PROFILE SERVICE
 * Handles automatic profile creation and updates after enrollment
 * Ensures single source of truth for all student-related data
 */

/**
 * Create or update student profile after enrollment confirmation
 * Idempotent - can be called multiple times safely
 */
const createOrUpdateProfileAfterEnrollment = async (
  userId: string,
  enrollmentId: string
): Promise<void> => {
  const session = await mongoose.startSession();

  try {
    await session.startTransaction();

    // Get enrollment details with batch and course info
    const enrollment = await EnrollmentModel.findOne({ enrollmentId })
      .populate({
        path: 'batchId',
        populate: {
          path: 'courseId',
          select: '_id title'
        }
      })
      .session(session);

    if (!enrollment) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
    }

    if (!enrollment.batchId || !(enrollment.batchId as any).courseId) {
      throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'Enrollment missing batch or course data');
    }

    // Find existing profile or create new one
    let profile = await ProfileModel.findOne({ user: userId }).session(session);

    if (!profile) {
      // Create new profile with basic enrollment data
      const profiles = await ProfileModel.create([{
        user: userId,
        areasOfInterest: [],
        enrollments: [{
          enrollmentId: enrollment.enrollmentId!,
          courseId: (enrollment.batchId as any).courseId._id,
          batchId: enrollment.batchId._id,
          status: enrollment.status,
          enrolledAt: enrollment.enrolledAt,
          completedAt: enrollment.completedAt,
          certificateIssued: enrollment.certificateIssued,
          certificateId: enrollment.certificateId,
        }],
      }], { session });

      profile = profiles[0];
    } else {
      // Update existing profile - add or update enrollment
      const existingEnrollmentIndex = profile.enrollments.findIndex(
        (e) => e.enrollmentId === enrollment.enrollmentId
      );

      const enrollmentData = {
        enrollmentId: enrollment.enrollmentId!,
        courseId: (enrollment.batchId as any).courseId._id,
        batchId: enrollment.batchId._id,
        status: enrollment.status,
        enrolledAt: enrollment.enrolledAt,
        completedAt: enrollment.completedAt,
        certificateIssued: enrollment.certificateIssued,
        certificateId: enrollment.certificateId,
      };

      if (existingEnrollmentIndex >= 0) {
        // Update existing enrollment
        profile.enrollments[existingEnrollmentIndex] = enrollmentData;
      } else {
        // Add new enrollment
        profile.enrollments.push(enrollmentData);
      }

      await profile.save({ session });
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Update enrollment status in profile when enrollment status changes
 * Idempotent - handles status updates, completions, cancellations
 */
const updateProfileEnrollmentStatus = async (
  enrollmentId: string,
  newStatus: EnrollmentStatus,
  additionalData?: {
    completedAt?: Date;
    certificateIssued?: boolean;
    certificateId?: string;
  }
): Promise<void> => {
  const session = await mongoose.startSession();

  try {
    await session.startTransaction();

    // Find enrollment to get user ID
    const enrollment = await EnrollmentModel.findOne({ enrollmentId }).session(session);
    if (!enrollment) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
    }

    // Update profile enrollment status
    const profile = await ProfileModel.findOne({ user: enrollment.userId }).session(session);
    if (!profile) {
      // If no profile exists, create one (fallback)
      await createOrUpdateProfileAfterEnrollment(enrollment.userId.toString(), enrollmentId);
      return;
    }

    const enrollmentIndex = profile.enrollments.findIndex(
      (e) => e.enrollmentId === enrollmentId
    );

    if (enrollmentIndex >= 0) {
      profile.enrollments[enrollmentIndex].status = newStatus;

      if (additionalData?.completedAt) {
        profile.enrollments[enrollmentIndex].completedAt = additionalData.completedAt;
      }

      if (additionalData?.certificateIssued !== undefined) {
        profile.enrollments[enrollmentIndex].certificateIssued = additionalData.certificateIssued;
      }

      if (additionalData?.certificateId) {
        profile.enrollments[enrollmentIndex].certificateId = additionalData.certificateId;
      }

      await profile.save({ session });
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Get complete student profile with all enrollment data
 * Single source of truth for student information
 */
const getCompleteStudentProfile = async (userId: string) => {
  const profile = await ProfileModel.findOne({ user: userId })
    .populate({
      path: 'enrollments.courseId',
      select: 'title shortDescription category level thumbnailImage',
    })
    .populate({
      path: 'enrollments.batchId',
      select: 'title batchNumber startDate endDate status',
      populate: {
        path: 'courseId',
        select: 'title',
      },
    })
    .lean();

  if (!profile) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Student profile not found');
  }

  // Calculate enrollment statistics
  const enrollmentStats = {
    totalEnrollments: profile.enrollments.length,
    activeEnrollments: profile.enrollments.filter(e => e.status === EnrollmentStatus.Active).length,
    completedEnrollments: profile.enrollments.filter(e => e.status === EnrollmentStatus.Completed).length,
    certificatesEarned: profile.enrollments.filter(e => e.certificateIssued).length,
  };

  return {
    ...profile,
    enrollmentStats,
  };
};

/**
 * Sync all user enrollments to profile (for data consistency)
 * Useful for migration or fixing data inconsistencies
 */
const syncAllUserEnrollmentsToProfile = async (userId: string): Promise<void> => {
  const session = await mongoose.startSession();

  try {
    await session.startTransaction();

    // Get all user enrollments
    const enrollments = await EnrollmentModel.find({ userId })
      .populate({
        path: 'batchId',
        populate: {
          path: 'courseId',
          select: '_id'
        }
      })
      .session(session);

    // Find or create profile
    let profile = await ProfileModel.findOne({ user: userId }).session(session);

    if (!profile) {
      const profiles = await ProfileModel.create([{
        user: userId,
        areasOfInterest: [],
        enrollments: [],
      }], { session });

      profile = profiles[0];
    }

    // Update enrollments in profile
    const updatedEnrollments = enrollments.map(enrollment => ({
      enrollmentId: enrollment.enrollmentId!,
      courseId: (enrollment.batchId as any).courseId._id,
      batchId: enrollment.batchId._id,
      status: enrollment.status,
      enrolledAt: enrollment.enrolledAt,
      completedAt: enrollment.completedAt,
      certificateIssued: enrollment.certificateIssued,
      certificateId: enrollment.certificateId,
    }));

    if (profile) {
      profile.enrollments = updatedEnrollments;
      await profile.save({ session });
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Remove enrollment from profile (for cancellations or deletions)
 */
const removeEnrollmentFromProfile = async (enrollmentId: string): Promise<void> => {
  const enrollment = await EnrollmentModel.findOne({ enrollmentId });
  if (!enrollment) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
  }

  await ProfileModel.updateOne(
    { user: enrollment.userId },
    { $pull: { enrollments: { enrollmentId } } }
  );
};

export const ProfileService = {
  createProfile,
  getProfile,
  updateProfile,
  deleteProfile,
  updateInterests,
  addInterest,
  removeInterest,
  // Centralized Profile Methods
  createOrUpdateProfileAfterEnrollment,
  updateProfileEnrollmentStatus,
  getCompleteStudentProfile,
  syncAllUserEnrollmentsToProfile,
  removeEnrollmentFromProfile,
};