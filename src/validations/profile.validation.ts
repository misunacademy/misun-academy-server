import { z } from 'zod';

const educationZodSchema = z.object({
  degree: z.string().min(1, 'Degree is required').max(200),
  institution: z.string().min(1, 'Institution is required').max(200),
  passingYear: z.string().min(1, 'Passing year is required').max(20),
  result: z.string().max(100).optional(),
});

export const createProfileSchema = z.object({
  body: z.object({
    phone: z.string().max(30).optional(),
    bio: z.string().max(2000).optional(),
    address: z.string().max(500).optional(),
    dateOfBirth: z.string().datetime().optional(),
    currentJob: z.string().max(200).optional(),
    industry: z.string().max(200).optional(),
    experience: z.enum(['0-1', '1-3', '3-5', '5-10', '10+']).optional(),
    company: z.string().max(200).optional(),
    linkedinUrl: z.string().url().optional(),
    education: z.array(educationZodSchema).optional(),
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
    learningGoals: z.string().max(1000).optional(),
    preferredLearningStyle: z.enum(['visual', 'auditory', 'kinesthetic', 'reading', 'mixed']).optional(),
    timeZone: z.string().max(100).optional(),
    availability: z.enum(['5-10', '10-20', '20-30', '30+']).optional(),
    areasOfInterest: z.array(z.string().max(100)).max(50).default([]),
    emailNotifications: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    courseReminders: z.boolean().optional(),
    profileVisibility: z.boolean().optional(),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    phone: z.string().max(30).optional(),
    bio: z.string().max(2000).optional(),
    address: z.string().max(500).optional(),
    dateOfBirth: z.string().datetime().optional(),
    currentJob: z.string().max(200).optional(),
    industry: z.string().max(200).optional(),
    experience: z.enum(['0-1', '1-3', '3-5', '5-10', '10+']).optional(),
    company: z.string().max(200).optional(),
    linkedinUrl: z.string().url().max(2048).optional(),
    education: z.array(educationZodSchema).optional(),
    skillLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
    learningGoals: z.string().max(1000).optional(),
    preferredLearningStyle: z.enum(['visual', 'auditory', 'kinesthetic', 'reading', 'mixed']).optional(),
    timeZone: z.string().max(100).optional(),
    availability: z.enum(['5-10', '10-20', '20-30', '30+']).optional(),
    areasOfInterest: z.array(z.string().max(100)).max(50).optional(),
    emailNotifications: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    courseReminders: z.boolean().optional(),
    profileVisibility: z.boolean().optional(),
  }),
});

export const updateInterestsSchema = z.object({
  body: z.object({
    interests: z.array(z.string().max(100)).max(50),
  }),
});

export const addInterestSchema = z.object({
  body: z.object({
    interest: z.string().min(1, 'Interest cannot be empty').max(100),
  }),
});

export const removeInterestSchema = z.object({
  body: z.object({
    interest: z.string().min(1, 'Interest cannot be empty').max(100),
  }),
});