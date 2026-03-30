import { Schema, model } from 'mongoose';
import { IProfile, IProfileModel, IEnrollmentMapping } from './profile.interface';

const EnrollmentMappingSchema = new Schema<IEnrollmentMapping>(
  {
    enrollmentId: { type: String, required: true },
  },
  { _id: false },
);

const EducationSchema = new Schema(
  {
    degree: { type: String, required: true },
    institution: { type: String, required: true },
    passingYear: { type: String, required: true },
    result: { type: String },
  },
  { _id: true }
);

const profileSchema = new Schema<IProfile>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

    // Personal Information
    phone: { type: String },
    bio: { type: String },
    address: { type: String },
    dateOfBirth: { type: Date },

    // Professional Information
    currentJob: { type: String },
    industry: { type: String },
    experience: {
      type: String,
      enum: ['0-1', '1-3', '3-5', '5-10', '10+'],
    },
    company: { type: String },
    linkedinUrl: { type: String },

    // Education
    education: [EducationSchema],

    // Learning Information
    skillLevel: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced', 'expert'],
    },
    learningGoals: { type: String },
    preferredLearningStyle: {
      type: String,
      enum: ['visual', 'auditory', 'kinesthetic', 'reading', 'mixed'],
    },
    timeZone: { type: String },
    availability: {
      type: String,
      enum: ['5-10', '10-20', '20-30', '30+'],
    },

    // Interests
    areasOfInterest: [{ type: String }],

    // Preferences
    emailNotifications: { type: Boolean, default: true },
    pushNotifications: { type: Boolean, default: true },
    courseReminders: { type: Boolean, default: true },
    profileVisibility: { type: Boolean, default: true },

    // Enrollment & Course Mapping (Centralized Student Data)
    enrollments: [EnrollmentMappingSchema],
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete (ret as any).__v;
        return ret;
      },
    },
  }
);

// Indexes for better query performance
profileSchema.index({ 'enrollments.enrollmentId': 1 });

export const ProfileModel = model<IProfile, IProfileModel>('Profile', profileSchema);