import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import mongoose from 'mongoose';
import { Resend } from 'resend';
import { Role } from '../types/role';
import { UserStatus } from '../types/common';
import { ProfileModel } from '../modules/Profile/profile.model';

const resend = new Resend(process.env.RESEND_API_KEY);
let authInstance: any = null;

export const initializeAuth = () => {
  if (authInstance) {
    return authInstance;
  }

  authInstance = betterAuth({
    database: mongodbAdapter(mongoose.connection.getClient().db()),
    
    baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5000/api/v1/auth',
    secret: process.env.BETTER_AUTH_SECRET!,
  
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }: { user: any; url: string }) => {
      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'noreply@misunacademy.com',
        to: user.email,
        subject: 'Reset Your Password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Reset Your Password</h2>
            <p>Hi ${user.name},</p>
            <p>You requested to reset your password. Click the button below to reset it:</p>
            <a href="${url}" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px; margin: 16px 0;">Reset Password</a>
            <p>This link will expire in 1 hour.</p>
            <p>If you didn't request this, please ignore this email.</p>
            <p>Best regards,<br>Misun Academy Team</p>
          </div>
        `,
      });
    },
  },

  emailVerification: {
    sendVerificationEmail: async ({ user, url }: { user: any; url: string }) => {
      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'noreply@misunacademy.com',
        to: user.email,
        subject: 'Verify Your Email',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Welcome to Misun Academy!</h2>
            <p>Hi ${user.name},</p>
            <p>Thank you for signing up! Please verify your email address by clicking the button below:</p>
            <a href="${url}" style="display: inline-block; padding: 12px 24px; background-color: #28a745; color: white; text-decoration: none; border-radius: 4px; margin: 16px 0;">Verify Email</a>
            <p>This link will expire in 24 hours.</p>
            <p>If you didn't create an account, please ignore this email.</p>
            <p>Best regards,<br>Misun Academy Team</p>
          </div>
        `,
      });
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
    database: {
      generateId: () => {
        // Use MongoDB ObjectId-compatible ID generation
        return new mongoose.Types.ObjectId().toString();
      },
    },
  },

  trustedOrigins: [
    process.env.FRONTEND_URL!,
    process.env.CLIENT_URL || 'http://localhost:3000',
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
