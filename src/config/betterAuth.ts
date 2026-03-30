// Static imports for CJS-compatible packages only
import mongoose from 'mongoose';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/emailService';
import { Role } from '../types/role';
import { UserStatus } from '../types/common';
import { ProfileModel } from '../modules/Profile/profile.model';
import { dynamicImport } from '../utils/dynamicImport';

// Use the shared email service for auth emails (reuse SMTP config & retry logic)
let authInstance: any = null;

// initializeAuth is async because better-auth is ESM-only (.mjs) and cannot be
// statically require()'d from CommonJS. We use dynamic import() to load it at runtime.
export const initializeAuth = async () => {
  if (authInstance) {
    return authInstance;
  }

  // Dynamically import ESM-only packages at runtime (prevents ERR_REQUIRE_ESM)
  const { betterAuth } = await dynamicImport('better-auth');
  const { mongodbAdapter } = await dynamicImport('better-auth/adapters/mongodb');

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
    // 'http://localhost:5000/api/v1/auth'
    baseURL: process.env.BETTER_AUTH_URL!,
    secret: process.env.BETTER_AUTH_SECRET!,

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
      sendResetPassword: async ({ user, url }: { user: any; url: string }) => {
        try {
          // Extract token from the Better Auth generated URL
          // The token is in the path, not query params
          const parsed = new URL(url);
          const pathParts = parsed.pathname.split('/');
          const token = pathParts[pathParts.length - 1]; // Get last part of path

          if (!token || token.length < 10) {
            console.error('[BetterAuth] No valid token found in reset password URL:', url);
            console.error('[BetterAuth] Parsed pathname:', parsed.pathname);
            console.error('[BetterAuth] Path parts:', pathParts);
            return;
          }



          // Send email asynchronously but log any errors
          sendPasswordResetEmail(user.email, user.name, token)
            .then(() => {
              console.log('[BetterAuth]  Password reset email queued/sent successfully');
            })
            .catch((error) => {
              console.error('[BetterAuth]  Failed to send password reset email:', error);
            });
        } catch (error) {
          console.error('[BetterAuth] Error in sendResetPassword callback:', error);
          // Don't throw - just log the error
        }
      },
    },

    emailVerification: {
      sendVerificationEmail: async ({ user, url }: { user: any; url: string }) => {
        try {
          const parsed = new URL(url);
          const token = parsed.searchParams.get('token') || parsed.searchParams.get('t') || url;
          // Don't await to prevent timing attacks - fire and forget
          void sendVerificationEmail(user.email, user.name, token);
        } catch (error) {
          console.error('[BetterAuth] Error sending verification email:', error);
          // Don't throw - just log the error
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
    },

    trustedOrigins: [
      process.env.MA_FRONTEND_URL!,
      process.env.CLIENT_URL!,
      process.env.EP_FRONTEND_URL!,
    ].filter(Boolean), // Filter out any undefined values

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

              console.log(` Profile created for user: ${user.id}`);
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
