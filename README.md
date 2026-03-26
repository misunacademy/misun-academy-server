# Misun Academy - Backend Server

A robust, secure Express.js backend server for the Misun Academy Learning Management System (LMS), featuring modern authentication, modular architecture, and comprehensive API endpoints for managing courses, enrollments, payments, and more.

## 🚀 Tech Stack

- **Runtime:** Node.js (>= 20.x)
- **Language:** TypeScript 5.7+
- **Framework:** Express.js 4.x
- **Database:** MongoDB with Mongoose ODM
- **Authentication:** BetterAuth 1.4.18 with email & OAuth support
- **Email:** Resend API + Nodemailer (SMTP fallback)
- **Payment Gateway:** SSLCommerz
- **Cloud Storage:** Cloudinary
- **Security:** Helmet, CORS, Rate Limiting
- **Logging:** Pino with pretty print for development

## 📋 Features

### Authentication & Authorization
- ✅ Email/Password authentication with BetterAuth
- ✅ Google OAuth integration
- ✅ Email verification system
- ✅ Password reset functionality
- ✅ Role-based access control (Learner, Instructor, Admin, SuperAdmin)
- ✅ Session management with encrypted cookies (JWE)

### Core Modules
- **Users:** User management and profiles
- **Courses:** Course creation, management, and discovery
- **Batches:** Batch scheduling and management
- **Enrollments:** Course enrollment and tracking
- **Lessons & Modules:** Content organization
- **Progress Tracking:** Student progress monitoring
- **Certificates:** Certificate generation and management
- **Payments:** SSLCommerz integration for secure payments
- **Recordings:** Class recording management
- **Resources:** Course materials and downloads
- **Assignments:** (Coming soon)
- **Quizzes:** (Coming soon)

### Security Features
- 🔒 Helmet.js for security headers
- 🔒 CORS with configurable origins
- 🔒 Rate limiting (global + auth-specific)
- 🔒 Environment variable validation with Zod
- 🔒 Password hashing with bcrypt
- 🔒 XSS protection
- 🔒 CSRF protection via SameSite cookies

## 📦 Installation

### Prerequisites
- Node.js >= 20.x
- MongoDB (local or MongoDB Atlas)
- npm or yarn

### Setup Steps

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd server
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your configuration. See [Environment Variables](#environment-variables) section.

4. **Generate BetterAuth secret:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   
   Copy the output to `BETTER_AUTH_SECRET` in your `.env` file.

5. **Start development server:**
   ```bash
   npm run dev
   ```

6. **Build for production:**
   ```bash
   npm run build
   npm start
   ```

## 🔧 Environment Variables

Create a `.env` file based on `.env.example`. Required variables:



## 📜 Available Scripts

```bash
npm run dev              # Start development server with hot reload
npm run build            # Compile TypeScript to JavaScript
npm start                # Start production server
npm run seed:courses     # Seed sample courses
npm run seed:superAdmin  # Create super admin user
npm test                 # Run tests (coming soon)
```

## 🏗️ Project Structure

```
server/
├── src/
│   ├── app.ts                 # Express app configuration
│   ├── server.ts              # Server entry point
│   ├── config/                # Configuration files
│   │   ├── database.ts        # MongoDB connection
│   │   ├── betterAuth.ts      # BetterAuth setup
│   │   ├── env.ts             # Environment validation
│   │   └── logger.ts          # Pino logger
│   ├── modules/               # Feature modules
│   │   ├── User/
│   │   │   ├── user.model.ts
│   │   │   ├── user.controller.ts
│   │   │   ├── user.service.ts
│   │   │   ├── user.interface.ts
│   │   │   └── user.routes.ts
│   │   ├── Course/
│   │   ├── Enrollment/
│   │   └── ... (18 modules total)
│   ├── middlewares/           # Express middlewares
│   │   ├── betterAuth.ts      # Auth middleware
│   │   ├── globalErrorHandler.ts
│   │   ├── validateRequest.ts
│   │   └── upload.ts (Multer)
│   ├── services/              # Shared services
│   │   └── emailService.ts
│   ├── utils/                 # Helper functions
│   │   ├── catchAsync.ts
│   │   ├── sendResponse.ts
│   │   └── dateUtils.ts
│   ├── types/                 # TypeScript types
│   ├── validations/           # Zod schemas
│   ├── errors/                # Custom error classes
│   └── scripts/               # Utility scripts
├── dist/                      # Compiled JavaScript
└── package.json
```

## 🔐 Authentication Flow

### Email/Password Sign Up
1. User submits email + password
2. BetterAuth creates user in database
3. Verification email sent via Resend
4. User clicks link to verify email
5. Account activated

### Google OAuth
1. User clicks "Sign in with Google"
2. Redirected to Google OAuth consent
3. Google redirects back with auth code
4. BetterAuth exchanges code for tokens
5. User created/updated in database
6. Redirected to frontend with session

### Session Management
- Sessions stored in MongoDB
- Cookie-based authentication
- JWE encryption for security
- 7-day expiration with sliding window

## 🛡️ Security Best Practices

1. **Never commit `.env` files** - use `.env.example` for templates
2. **Use strong secrets** - Generate random strings for `BETTER_AUTH_SECRET`
3. **Enable HTTPS in production** - Set `NODE_ENV=production`
4. **Keep dependencies updated** - Run `npm audit` regularly
5. **Validate all inputs** - Use Zod schemas for validation
6. **Sanitize user data** - Prevent XSS and injection attacks

## 📊 API Endpoints

### Authentication
```
POST   /api/v1/auth/sign-up/email
POST   /api/v1/auth/sign-in/email
POST   /api/v1/auth/sign-out
GET    /api/v1/auth/session
POST   /api/v1/auth/forget-password
POST   /api/v1/auth/reset-password
POST   /api/v1/auth/verify-email
GET    /api/v1/auth/callback/google
```

### Courses
```
GET    /api/v1/courses
GET    /api/v1/courses/:id
GET    /api/v1/courses/slug/:slug
POST   /api/v1/courses              # Auth required (Instructor+)
PUT    /api/v1/courses/:id          # Auth required (Instructor+)
DELETE /api/v1/courses/:id          # Auth required (Admin+)
```

### Enrollments
```
GET    /api/v1/enrollments          # Auth required
POST   /api/v1/enrollments          # Auth required
GET    /api/v1/enrollments/:id      # Auth required
```

*Full API documentation coming soon with Swagger/OpenAPI*

## 🧪 Testing

```bash
npm test                 # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # Generate coverage report
```

## 🚀 Deployment

### Vercel (Serverless)
The app is configured for Vercel deployment. see `vercel.json`.

### Traditional VPS/Cloud
1. Build the application: `npm run build`
2. Set environment variables on server
3. Start with PM2: `pm2 start dist/server.js`
4. Configure reverse proxy (Nginx/Apache)
5. Set up SSL certificate (Let's Encrypt)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📝 License

MIT License - see LICENSE file for details

## 👥 Authors

- MA Team

## 🐛 Known Issues

See GitHub Issues for known bugs and feature requests.

## 📞 Support

For support, email admin@misunacademy.com or join our community chat.

---

**Happy Coding! 🎓**
