import { z } from 'zod';

const educationZodSchema = z.object({
  degree: z.string().min(1, 'Degree is required'),
  institution: z.string().min(1, 'Institution is required'),
  passingYear: z.string().min(1, 'Passing year is required'),
  result: z.string().optional(),
});

export const createProfileSchema = z.object({
  body: z.object({
    phone: z.string().optional(),
    bio: z.string().optional(),
    address: z.string().optional(),
    dateOfBirth: z.string().datetime().optional(),
    currentJob: z.string().optional(),
    industry: z.string().optional(),
    experience: z.enum(['0-1', '1-3', '3-5', '5-10', '10+']).optional(),
    company: z.string().optional(),
    linkedinUrl: z.string().url().optional(),
    education: z.array(educationZodSchema).optional(),
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
    learningGoals: z.string().optional(),
    preferredLearningStyle: z.enum(['visual', 'auditory', 'kinesthetic', 'reading', 'mixed']).optional(),
    timeZone: z.string().optional(),
    availability: z.enum(['5-10', '10-20', '20-30', '30+']).optional(),
    areasOfInterest: z.array(z.string()).default([]),
    emailNotifications: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    courseReminders: z.boolean().optional(),
    profileVisibility: z.boolean().optional(),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    phone: z.string().optional(),
    bio: z.string().optional(),
    address: z.string().optional(),
    dateOfBirth: z.string().datetime().optional(),
    currentJob: z.string().optional(),
    industry: z.string().optional(),
    experience: z.enum(['0-1', '1-3', '3-5', '5-10', '10+']).optional(),
    company: z.string().optional(),
    linkedinUrl: z.string().url().optional(),
    education: z.array(educationZodSchema).optional(),
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
    learningGoals: z.string().optional(),
    preferredLearningStyle: z.enum(['visual', 'auditory', 'kinesthetic', 'reading', 'mixed']).optional(),
    timeZone: z.string().optional(),
    availability: z.enum(['5-10', '10-20', '20-30', '30+']).optional(),
    areasOfInterest: z.array(z.string()).optional(),
    emailNotifications: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    courseReminders: z.boolean().optional(),
    profileVisibility: z.boolean().optional(),
  }),
});

export const updateInterestsSchema = z.object({
  body: z.object({
    interests: z.array(z.string()),
  }),
});

export const addInterestSchema = z.object({
  body: z.object({
    interest: z.string().min(1, 'Interest cannot be empty'),
  }),
});

export const removeInterestSchema = z.object({
  body: z.object({
    interest: z.string().min(1, 'Interest cannot be empty'),
  }),
});