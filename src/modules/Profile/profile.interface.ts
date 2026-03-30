import { Types, Model } from 'mongoose';

export interface IEnrollmentMapping {
  enrollmentId: string;
}

export interface IEducation {
  degree: string;
  institution: string;
  passingYear: string;
  result?: string;
}

export interface IProfile {
  user: Types.ObjectId;
  // Personal Information
  phone?: string;
  bio?: string;
  address?: string;
  dateOfBirth?: Date;

  // Professional Information
  currentJob?: string;
  industry?: string;
  experience?: string; // '0-1', '1-3', '3-5', '5-10', '10+'
  company?: string;
  linkedinUrl?: string;

  // Education
  education?: IEducation[];

  // Learning Information
  skillLevel?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  learningGoals?: string;
  preferredLearningStyle?: 'visual' | 'auditory' | 'kinesthetic' | 'reading' | 'mixed';
  timeZone?: string;
  availability?: '5-10' | '10-20' | '20-30' | '30+'; // hours per week

  // Interests
  areasOfInterest: string[];

  // Preferences
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  courseReminders?: boolean;
  profileVisibility?: boolean;

  // Enrollment & Course Mapping (Centralized Student Data)
  enrollments: IEnrollmentMapping[];

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

export interface IProfileModel extends Model<IProfile> { }