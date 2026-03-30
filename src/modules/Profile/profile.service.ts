import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError';
import { ProfileModel } from './profile.model';
import { EnrollmentModel } from '../Enrollment/enrollment.model';
import { EnrollmentStatus } from '../../types/common';
import { IProfile } from './profile.interface';
import mongoose from 'mongoose';
import { UserModel } from '../User/user.model';

const toEnrollmentRefs = (enrollments: any): Array<{ enrollmentId: string }> => {
  if (!Array.isArray(enrollments)) {
    return [];
  }

  const seen = new Set<string>();

  return enrollments
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry.trim();
      }

      if (entry && typeof entry.enrollmentId === 'string') {
        return entry.enrollmentId.trim();
      }

      return '';
    })
    .filter((id) => id.length > 0)
    .filter((id) => {
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    })
    .map((enrollmentId) => ({ enrollmentId }));
};

const hydrateProfileWithEnrollmentDetails = async (profileDoc: any) => {
  if (!profileDoc) {
    return profileDoc;
  }

  const profile = profileDoc.toObject ? profileDoc.toObject() : profileDoc;
  const enrollmentRefs = toEnrollmentRefs(profile.enrollments || []);
  const enrollmentIds = enrollmentRefs.map((entry) => entry.enrollmentId);

  if (!enrollmentIds.length) {
    profile.enrollments = [];
    return profile;
  }

  const enrollments = await EnrollmentModel.find({
    enrollmentId: { $in: enrollmentIds },
  })
    .populate({
      path: 'batchId',
      select: 'title batchNumber price startDate endDate status manualPaymentPrice',
      populate: {
        path: 'courseId',
        select: 'title slug shortDescription category level thumbnailImage',
      },
    })
    .populate({
      path: 'paymentId',
      select: 'transactionId status method amount currency',
    })
    .lean();

  const enrollmentMap = new Map(
    enrollments.map((enrollment: any) => [enrollment.enrollmentId, enrollment])
  );

  profile.enrollments = enrollmentIds
    .map((id: string) => enrollmentMap.get(id))
    .filter(Boolean);

  return profile;
};

const createProfile = async (userId: string, profileData: Partial<IProfile>) => {
  const enrollmentRefs = toEnrollmentRefs((profileData as any).enrollments);

  const profile = await ProfileModel.create({
    user: userId,
    ...profileData,
    ...(enrollmentRefs.length > 0 && { enrollments: enrollmentRefs }),
  });
  return profile;
};

const getProfile = async (userId: string) => {
  const profile = await ProfileModel.findOne({ user: userId })
    .populate({ path: 'user' });

  return hydrateProfileWithEnrollmentDetails(profile);
};

const updateProfile = async (userId: string, updateData: any) => {
  const { avatar, name, enrollments, ...profileData } = updateData;
  const enrollmentRefs = toEnrollmentRefs(enrollments);

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
    {
      $set: {
        ...profileData,
        ...(enrollments !== undefined && { enrollments: enrollmentRefs }),
      },
    },
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
  enrollmentId: string,
  providedSession?: mongoose.ClientSession
): Promise<void> => {
  const session = providedSession || await mongoose.startSession();

  try {
    if (!providedSession) {
      session.startTransaction();
    }

    // Validate enrollment existence
    const enrollment = await EnrollmentModel.findOne({ enrollmentId }).session(session);

    if (!enrollment) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
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
        }],
      }], { session });

      profile = profiles[0];
    } else {
      // Update existing profile - keep only enrollment references
      const hasEnrollmentRef = profile.enrollments.some(
        (e) => e.enrollmentId === enrollment.enrollmentId
      );

      if (!hasEnrollmentRef) {
        // Add new enrollment
        profile.enrollments.push({ enrollmentId: enrollment.enrollmentId! });
        await profile.save({ session });
      }
    }

    if (!providedSession) {
      await session.commitTransaction();
    }
  } catch (error) {
    if (!providedSession) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    if (!providedSession) {
      session.endSession();
    }
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
    // Status now lives in Enrollment collection. Keep profile in sync as a reference list only.
    void newStatus;
    void additionalData;

    await session.startTransaction();

    // Find enrollment to get user ID
    const enrollment = await EnrollmentModel.findOne({ enrollmentId }).session(session);
    if (!enrollment) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Enrollment not found');
    }

    // Ensure reference exists in profile
    const profile = await ProfileModel.findOne({ user: enrollment.userId }).session(session);
    if (!profile) {
      await createOrUpdateProfileAfterEnrollment(enrollment.userId.toString(), enrollmentId, session);
    } else {
      const hasEnrollmentRef = profile.enrollments.some(
        (entry) => entry.enrollmentId === enrollmentId
      );

      if (!hasEnrollmentRef) {
        profile.enrollments.push({ enrollmentId });
        await profile.save({ session });
      }
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
  const profileDoc = await ProfileModel.findOne({ user: userId })
    .populate({ path: 'user' });

  const profile = await hydrateProfileWithEnrollmentDetails(profileDoc);

  if (!profile) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Student profile not found');
  }

  // Calculate enrollment statistics
  const enrollmentStats = {
    totalEnrollments: profile.enrollments.length,
    activeEnrollments: profile.enrollments.filter((e: any) => e.status === EnrollmentStatus.Active).length,
    completedEnrollments: profile.enrollments.filter((e: any) => e.status === EnrollmentStatus.Completed).length,
    certificatesEarned: profile.enrollments.filter((e: any) => e.certificateIssued).length,
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
      .select('enrollmentId')
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

    // Sync reference list only (no duplicated enrollment fields)
    const updatedEnrollments = enrollments
      .map((enrollment) => enrollment.enrollmentId)
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ enrollmentId: id }));

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