import mongoose from 'mongoose';
import { UserModel } from '../../modules/User/user.model.js';
import { AdminModel } from '../../modules/Admin/admin.model.js';
import { CourseModel } from '../../modules/Course/course.model.js';
import { BatchModel } from '../../modules/Batch/batch.model.js';
import { EnrollmentModel } from '../../modules/Enrollment/enrollment.model.js';
import { PaymentModel } from '../../modules/Payment/payment.model.js';
import { ModuleModel } from '../../modules/Module/module.model.js';
import { ModuleProgressModel } from '../../modules/Progress/moduleProgress.model.js';
import {
  BatchStatus,
  CourseLevel,
  EnrollmentStatus,
  ProgressStatus,
  Status,
} from '../../types/common.js';

export const buildUser = (overrides: Record<string, unknown> = {}) => ({
  name: 'Test User',
  email: `test-${Date.now()}@example.com`,
  password: 'password123',
  role: 'learner',
  ...overrides,
});

export const createUser = async (overrides: Record<string, unknown> = {}) =>
  UserModel.create(buildUser(overrides));

export const buildAdmin = (overrides: Record<string, unknown> = {}) => ({
  name: 'Admin User',
  email: `admin-${Date.now()}@example.com`,
  password: 'admin123',
  ...overrides,
});

export const createAdmin = async (overrides: Record<string, unknown> = {}) =>
  AdminModel.create(buildAdmin(overrides));

export const buildCourse = (adminId: mongoose.Types.ObjectId, overrides: Record<string, unknown> = {}) => ({
  title: 'Test Course',
  slug: `test-course-${Date.now()}`,
  shortDescription: 'A short description',
  fullDescription: 'A full description',
  learningOutcomes: ['Learn X'],
  targetAudience: 'Beginners',
  thumbnailImage: 'https://example.com/thumb.jpg',
  durationEstimate: '10 hours',
  level: CourseLevel.Beginner,
  category: 'Programming',
  createdBy: adminId,
  ...overrides,
});

export const createCourse = async (adminId: mongoose.Types.ObjectId, overrides: Record<string, unknown> = {}) =>
  CourseModel.create(buildCourse(adminId, overrides));

export const buildBatch = (
  courseId: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {}
) => ({
  courseId,
  title: 'Batch 1',
  batchNumber: 1,
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-06-01'),
  enrollmentStartDate: new Date('2024-12-01'),
  enrollmentEndDate: new Date('2025-03-01'),
  price: 5000,
  status: BatchStatus.Upcoming,
  ...overrides,
});

export const createBatch = async (
  courseId: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {}
) => BatchModel.create(buildBatch(courseId, overrides));

export const buildEnrollment = (
  userId: mongoose.Types.ObjectId,
  batchId: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {}
) => ({
  userId,
  batchId,
  status: EnrollmentStatus.Pending,
  ...overrides,
});

export const createEnrollment = async (
  userId: mongoose.Types.ObjectId,
  batchId: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {}
) => EnrollmentModel.create(buildEnrollment(userId, batchId, overrides));

export const buildPayment = (
  userId: mongoose.Types.ObjectId,
  batchId: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {}
) => ({
  userId,
  batchId,
  enrollmentId: `ENR-${Date.now()}`,
  transactionId: `TXN-${Date.now()}`,
  amount: 5000,
  currency: 'BDT',
  status: Status.Pending,
  method: 'SSLCommerz',
  ...overrides,
});

export const createPayment = async (
  userId: mongoose.Types.ObjectId,
  batchId: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {}
) => PaymentModel.create(buildPayment(userId, batchId, overrides));

export const buildModule = (
  courseId: mongoose.Types.ObjectId,
  batchId: mongoose.Types.ObjectId,
  orderIndex: number,
  overrides: Record<string, unknown> = {}
) => ({
  courseId,
  batchId,
  title: `Module ${orderIndex}`,
  description: `Description for module ${orderIndex}`,
  orderIndex,
  estimatedDuration: '2 hours',
  ...overrides,
});

export const createModule = async (
  courseId: mongoose.Types.ObjectId,
  batchId: mongoose.Types.ObjectId,
  orderIndex: number,
  overrides: Record<string, unknown> = {}
) => ModuleModel.create(buildModule(courseId, batchId, orderIndex, overrides));

export const createModuleProgress = async (
  enrollmentId: mongoose.Types.ObjectId,
  moduleId: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {}
) =>
  ModuleProgressModel.create({
    enrollmentId,
    moduleId,
    status: ProgressStatus.Locked,
    completionPercentage: 0,
    ...overrides,
  });

export const createActiveEnrollment = async (
  userId: mongoose.Types.ObjectId,
  batchId: mongoose.Types.ObjectId
) => {
  const enrollment = await createEnrollment(userId, batchId, {
    status: EnrollmentStatus.Active,
    enrollmentId: `MA-1${new Date().getFullYear()}00001`,
    enrolledAt: new Date(),
  });
  return enrollment;
};
