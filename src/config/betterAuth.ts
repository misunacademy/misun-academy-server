import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import mongoose from 'mongoose';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/emailService';
import { Role } from '../types/role';
import { UserStatus } from '../types/common';
import { ProfileModel } from '../modules/Profile/profile.model';

// Use the shared email service for auth emails (reuse SMTP config & retry logic)
let authInstance: any = null;

export const initializeAuth = () => {
  if (authInstance) {
    return authInstance;
  }

  authInstance = betterAuth({
    database: mongodbAdapter(mongoose.connection.getClient().db(), {
      // Better Auth defaults to singular collection names; enable plural to use "users"
      usePlural: true,
      // Provide client so transactions stay enabled
      client: mongoose.connection.getClient(),
    }),
    // 'http://localhost:5000/api/v1/auth'
    baseURL: process.env.BETTER_AUTH_URL!,
    secret: process.env.BETTER_AUTH_SECRET!,

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }: { user: any; url: string }) => {
        try {
          const parsed = new URL(url);
          const token = parsed.searchParams.get('token') || parsed.searchParams.get('t') || url;
          await sendPasswordResetEmail(user.email, user.name, token);
        } catch (error) {
          console.error('[BetterAuth] Error sending password reset email:', error);
          throw error;
        }
      },
    },

    emailVerification: {
      sendVerificationEmail: async ({ user, url }: { user: any; url: string }) => {
        try {
          const parsed = new URL(url);
          const token = parsed.searchParams.get('token') || parsed.searchParams.get('t') || url;
          await sendVerificationEmail(user.email, user.name, token);
        } catch (error) {
          console.error('[BetterAuth] Error sending verification email:', error);
          throw error;
        }
      },
    },

    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    },

    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: Role.LEARNER,
          required: true,
          input: false, // Don't allow users to set this directly
        },
        status: {
          type: 'string',
          defaultValue: UserStatus.Active,
          required: true,
          input: false,
        },
        phone: {
          type: 'string',
          required: false,
        },
        address: {
          type: 'string',
          required: false,
        },
        avatar: {
          type: 'string',
          required: false,
        },
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
    },

    advanced: {
      cookiePrefix: 'better-auth',
      crossSubDomainCookies: {
        enabled: false,
      },
      useSecureCookies: process.env.NODE_ENV === 'production',
      // Let MongoDB adapter handle ObjectId generation natively
    },

    trustedOrigins: [
      process.env.FRONTEND_URL!,
      process.env.CLIENT_URL!,
    ],

    // Database hooks for custom logic
    databaseHooks: {
      user: {
        create: {
          after: async (user: any) => {
            // Auto-create profile when user is created
            const existingProfile = await ProfileModel.findOne({ user: user.id });

            if (!existingProfile) {
              await ProfileModel.create({
                user: user.id,
                emailNotifications: true,
                pushNotifications: true,
                courseReminders: true,
                profileVisibility: true,
                enrollments: [],
              });

              console.log(`✅ Profile created for user: ${user.id}`);
            }
          },
        },
      },
    },
  });

  return authInstance;
};

// Lazy getter for auth instance
export const getAuth = () => {
  if (!authInstance) {
    throw new Error('Auth not initialized. Call initializeAuth() after database connection.');
  }
  return authInstance;
};

// For backwards compatibility - proxy to lazily get auth instance
export const auth = new Proxy({} as any, {
  get(target, prop) {
    return getAuth()[prop];
  }
});

export type Auth = typeof auth;
