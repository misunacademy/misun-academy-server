// Static imports for CJS-compatible packages only
import mongoose from 'mongoose';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/misunAcademyEmails.js';
import { Role } from '../types/role.js';
import { UserStatus } from '../types/common.js';
import { ProfileModel } from '../modules/Profile/profile.model.js';
import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { logger } from './logger.js';

// Use the shared email service for auth emails (reuse SMTP config & retry logic)
let authInstance: any = null;

export const initializeAuth = async () => {
  if (authInstance) {
    return authInstance;
  }


  const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  const enableCrossSubDomainCookies =
    process.env.NODE_ENV === 'production' && Boolean(authCookieDomain);

  authInstance = betterAuth({
    database: mongodbAdapter(mongoose.connection.getClient().db(), {
      // Better Auth defaults to singular collection names; enable plural to use "users"
      usePlural: true,
      // Provide client so transactions stay enabled
      client: mongoose.connection.getClient(),
    }),
    baseURL: new URL(process.env.BETTER_AUTH_URL!).origin,
    basePath: new URL(process.env.BETTER_AUTH_URL!).pathname,
    secret: process.env.BETTER_AUTH_SECRET!,

    appName: 'Misun Academy',

    // Redirect to client after OAuth
    redirects: {
      // After successful OAuth, redirect to client's callback page
      afterSignIn: `${process.env.MA_FRONTEND_URL!}/auth/callback`,
      afterSignUp: `${process.env.MA_FRONTEND_URL!}/auth/callback`,
    },

    // Enable experimental features for better performance
    experimental: {
      joins: true, // 2-3x performance improvement for MongoDB queries
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      // Password reset configuration
      resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
      sendResetPassword: async ({ user, token }: { user: any; url: string; token: string }) => {
        try {
          await sendPasswordResetEmail(user.email, user.name, token);
          logger.info('Password reset email sent successfully');
        } catch (error) {
          logger.error(error, 'Failed to send password reset email');
        }
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, token }: { user: any; url: string; token: string }) => {
        try {
          await sendVerificationEmail(user.email, user.name, token);
          logger.info('Verification email sent successfully');
        } catch (error) {
          logger.error(error, 'Failed to send verification email');
        }
      },
    },

    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        // Always get refresh token and prompt for account selection
        accessType: 'offline',
        prompt: 'select_account consent',
        redirectURI: `${process.env.BETTER_AUTH_URL}/callback/google`,
      },
    },

    user: {
      additionalFields: {
        role: {
          type: 'string',
          defaultValue: Role.LEARNER,
          required: true,
          input: false, // Don't allow users to set this directly (security)
        },
        status: {
          type: 'string',
          defaultValue: UserStatus.Active,
          required: true,
          input: false, // Don't allow users to set this directly (security)
        },
        phone: {
          type: 'string',
          required: false,
          input: true, // Users CAN set this field
        },
        address: {
          type: 'string',
          required: false,
          input: true, // Users CAN set this field
        },
        avatar: {
          type: 'string',
          required: false,
          input: true, // Users CAN set this field
        },
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
        strategy: 'jwe', // Use JWE (encrypted) for maximum security
      },
    },

    advanced: {
      cookiePrefix: 'better-auth',
      crossSubDomainCookies: enableCrossSubDomainCookies
        ? {
          enabled: true,
          domain: authCookieDomain!,
        }
        : {
          enabled: false,
        },
      useSecureCookies: process.env.NODE_ENV === 'production',
      // Let MongoDB adapter handle ObjectId generation natively

      defaultCookieAttributes: {
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
      },
    },

    onAPIError: {
      errorURL: `${process.env.MA_FRONTEND_URL!}/auth?error=authentication_failed`,
    },

    trustedOrigins: [
      process.env.MA_FRONTEND_URL!,
      process.env.CLIENT_URL,
      process.env.EP_FRONTEND_URL!,
    ].filter((s): s is string => Boolean(s)), // Filter out any undefined values

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

              logger.info(`Profile created for user: ${user.id}`);
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
