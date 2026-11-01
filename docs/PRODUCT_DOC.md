# Misun Academy Server — Product Documentation

> Backend for the Misun Academy LMS. Express 5 + TypeScript + MongoDB (Mongoose) monolith serving two frontend brands: **MA (Misun Academy)** and **EP (Esun Point / English)**.

## 1. Product overview

Misun Academy is a cohort-based learning platform. Students discover courses, enroll in time-boxed **batches**, pay via **SSLCommerz**, consume drip-delivered **modules → lessons → quizzes**, track **progress**, earn **certificates**, compete on a **gamified leaderboard (Zames points)**, and get support via **AI chat**, **notifications**, **announcements**, and **recordings**.

Admins/instructors operate the whole lifecycle: course authoring, batch scheduling + auto-transitions, manual enrollment, payment verification + refunds, quiz authoring + analytics, certificate issuance, employee HR, audit logs, and dashboards.

### 1.1 Users & roles (`src/types/role.ts`)

| Role | Description |
|---|---|
| `superadmin` | Full access. Seeded via `seed:superAdmin`. Only role for `requireSuperAdmin` routes. |
| `admin` | Course/batch/user/payment/certificate/quiz management. `requireAdmin` = admin + superadmin. |
| `instructor` | Own courses/batches/students, author modules/lessons/quizzes, view analytics. `requireInstructor` = instructor + admin + superadmin. |
| `learner` | Default role on sign-up. Enrolls, learns, attempts quizzes, earns certificates. |
| `employee` | Internal HR surface (profile, salaries, leave). `requireEmployee` = employee + admin + superadmin. |

Account lifecycle: `UserStatus = active | suspended | deleted`. Suspended users are blocked at sign-in (Better-Auth `after` hook deletes fresh sessions + expires cookies) **and** on every `requireAuth` call. `emailVerified` is enforced in `requireAuth`. Role/status are `input: false` in Better-Auth `additionalFields` — never client-settable.

### 1.2 Multi-brand (MA / EP)

`src/utils/courseBrand.ts` derives brand: explicit `brand` field, else title/slug containing "english" → `EP`, else `MA`. Brand drives:
- CORS origins: `MA_FRONTEND_URL`, `EP_FRONTEND_URL` (+ localhost 3000/3001).
- Email templates: `misunAcademyEmails.ts` vs `esunPointEmails.ts`, routed by `courseEmailRouter.ts` + `deriveCourseBrand`.
- Brand social links in env (`MA_*`, `EP_*`).

## 2. Tech stack

| Area | Choice |
|---|---|
| Runtime / lang | Node.js ≥ 20, TypeScript 5.7 (ES2022, `NodeNext`, ESM `"type": "module"`) |
| Framework | Express 5 |
| DB / ODM | MongoDB + Mongoose 8 |
| Auth | Better-Auth 1.6 (MongoDB adapter, `usePlural`, joins), email+password + Google OAuth, 7-day sessions, JWE cookie-cache (5 min) |
| Validation | Zod (request + env) |
| Uploads | Multer (memory) + Cloudinary (incl. restricted/signed delivery) |
| Payments | `sslcommerz-lts` (sandbox/live toggle), manual-payment + webhook + IPN validation |
| Email | Nodemailer (Gmail service or custom SMTP) + DB-backed queue (`EmailLogModel`, `EmailWorker` polling every 5s, batch 5, retry) |
| Realtime | Socket.IO (Better-Auth session handshake, per-user rate limit 20 events / 10s) |
| AI chat | Groq SDK (`groq/compound-mini`, 1024 tokens, 20-msg history cap, 5-min batch-context cache, 3 retries) |
| Rate limiting | Upstash Redis (persistent) w/ in-memory fallback + `express-rate-limit`; strict auth limiter 20/15min, general auth 1000/15min, API 300/15min |
| Security | Helmet (CSP/HSTS/noSniff), CORS credentials, CSRF (`csrfProtection` on `/api/v1`), SameSite/secure/httpOnly cookies, bcrypt, JWE |
| Observability | Pino + `correlationId` + `requestLogger`, Sentry (`@sentry/node`, express integration), `/health` + `/ready` |
| Scheduling | `node-cron` (batch transitions, batch reminders, employee birthdays) + Vercel Cron `0 0 * * *` → `/api/v1/batches/auto-transition/run` |
| Docs | `openapi.json` (generated) + Scalar `/docs` |
| Tests | Jest + ts-jest (ESM) + supertest + mongodb-memory-server |
| Deploy | Vercel serverless (`dist/server.js`) + Dockerfile (pnpm monorepo-aware: `ma-server` filter) |
| CI | `.github/workflows/ci.yml`: install → lint → typecheck → docs:generate → test |

## 3. Architecture

```
src/
  server.ts        # http server, DB connect, workers/crons, socket init, graceful shutdown
  app.ts           # middleware pipeline, auth mount (BEFORE body parsers), /api/v1 router, docs, error handlers
  config/          # env (Zod), database, betterAuth, cloudinary, sslcommerz, logger
  routes/          # index.ts (26 module mounts) + betterAuth.routes.ts
  modules/*/       # vertical slices: *.model|interface|service|controller|routes|validation
  middlewares/     # betterAuth, validateRequest, globalErrorHandler, rateLimit, csrfProtection,
                   # correlationId, requestLogger, upload, ownership, batchAccess
  services/        # emailService (queue), misunAcademyEmails, esunPointEmails, courseEmailRouter, socketService
  models/          # auditLog, email (queue log), uploadAsset
  utils/           # catchAsync, sendResponse, slugify, courseBrand, batchScheduler,
                   # batchReminderScheduler, employeeBirthdayReminderScheduler, firstParam, dynamicImport
  validations/     # shared Zod schemas (course, batch, quiz, attempt, payment, profile, ...)
  types/           # role, common (all enums), auth, response, error
  scripts/         # seedCourses, seedBootcamp, seedSuperAdmin, migrateEmailVerification, ...
```

**Critical pipeline order in `app.ts`:** Vercel lazy-DB → CORS → Helmet → correlationId/requestLogger → compression → cookieParser → Better-Auth routes (must precede `express.json()` — Better-Auth does its own body parsing) → `express.urlencoded/json (1mb)` → `csrfProtection` → API rate limiter + main router → health/ready → openapi/docs → `/` → Sentry error handler → 404 → globalErrorHandler.

**Standard module pattern:** `routes` (auth + `validateRequest(Zod)`) → `controller` (wrapped in `catchAsync`, calls service, `sendResponse`) → `service` (Mongoose/transactions, throws `ApiError`) → `model/interface`. Response envelope: `{ success, statusCode, message, meta?, data, serverTimestamp? }`.

## 4. Domain modules (26)

| Mount (`/api/v1`…) | Module | What it does |
|---|---|---|
| `/auth/*` | Better-Auth | sign-up/in/out email, Google callback, verify-email, forget/reset/change password, sessions, update-user. Mounted in `app.ts`, not `routes/index.ts`. |
| `/admin` | Admin | User CRUD, status changes, instructors list, send enrollment / batch-progress / incomplete / news emails. |
| `/` | User | Public/own user endpoints (mounted at root). |
| `/courses` | Course | Public list/slug/id; admin create/update/assign-instructor/delete. `brand, status=draft/published/archived, level, featured`. |
| `/batches` | Batch | List incl. `upcoming`, `current-enrollment(s)`, auto-transition (`/auto-transition/run`, `/:id/transition`). `status=draft/upcoming/running/completed`. |
| `/content` | Content | **Learner delivery:** batch modules, module lessons, lesson detail, resources, lesson/batch progress. Gated by enrollment + `batchAccess`. |
| `/admin/modules`, `/admin/lessons` | Module, Lesson | Admin CRUD + reorder. `LessonType=video/reading/quiz/project`, `VideoSource=youtube/googledrive`. |
| `/recordings` | Recording | Instructor CRUD; student `my-recordings` + `batch/:batchId` + view (signed) access. |
| `/enrollments`, `/course-enrollment` | Enrollment | Create/manual/grant/special-access, `me`, status transitions. `EnrollmentStatus=pending/payment-pending/active/completed/suspended/refunded/payment-failed`. Legacy `courseEnrollment` = lesson-complete + course-progress. |
| `/instructor` | Instructor | Profile, assigned courses, batches + students + statistics, full module/lesson/quiz/question management scoped to own courses. |
| `/certificates` | Certificate | Request/issue/approve/revoke, `pending`, `my-certificates`, eligibility, public `verify/:certificateId`. `status=pending/active/revoked`. |
| `/payments`, `/refunds` | Payment, Refund | SSLCommerz init/verify/webhook/status, history/me; refund request workflow. `Status=pending/success/failed/review/risk/cancel/refunded`. |
| `/dashboard` | Dashboard | `admin`, `instructor`, `student`, `users`, `metadata` aggregates. |
| `/upload` | Upload | `single` (`image`), `multiple` (`images`, max 10), `with-data`, `restricted`, delete by `publicId`. Auth required. |
| `/profile` | Profile | Auto-created on user-create hook; CRUD, interests add/remove, `complete`, `sync-enrollments`. |
| `/settings` | Settings | Public GET; admin PATCH. |
| `/employee` | Employee | Self: profile, salaries, leave, NID photo URL. Admin: employees, salaries CRUD + status, leave approvals. Birthday cron emails `ADMIN_EMAIL`. |
| `/chat` | Chat | Groq-powered course/batch assistant with live batch context. |
| `/notifications` | Notification | List, unread-count, mark read/read-all, delete. Also emitted by payment flows. |
| `/admin/quizzes`, `/quizzes`, `/gamification` | Quiz | Admin/instructor: quiz + question CRUD, reorder, duplicate, analytics. Learner: quiz info, start/submit/result, attempts. Gamification: global/course/batch leaderboards, Zames stats/history. `QuestionType=mcq/true_false`, `AttemptStatus=in_progress/completed`, `ZamesSource=quiz/bonus/achievement/streak/multiplier`. |
| `/audit-logs` | AuditLog | Admin queryable audit trail; `recordAudit()` called from payment and other mutating services. |
| `/bootcamp` | Bootcamp | Free/paid bootcamp registrations (email unique unless rejected, `pending/approved/rejected`) + catalog (`current`, `past`). Admin review (`reviewedBy/At`, IP logged). |
| `/announcements` | Announcement | `live`, `meta`, admin `stats` + CRUD. Targeted/published announcements. |

`Resource` has only `resource.interface/model` (embedded in lessons, no standalone routes). `Progress` has only `lessonProgress/moduleProgress/quizProgress` models + `progress.service` (no HTTP mount — used via Content/Enrollment).

## 5. Key flows

1. **Sign-up → verify → learn:** `POST /auth/sign-up/email` → `sendVerificationEmail` (queued) → verify → auto-sign-in → `requireAuth` (emailVerified + status checks) → enroll.
2. **Enrollment + payment:** create enrollment (`pending/payment-pending`) → SSLCommerz init (`tran_id = MA…`) → success/fail/cancel IPN + webhook → `checkPaymentStatus`/server validation via `SSL_VALIDATION_API` → activate enrollment in transaction → sync `Profile.enrollments` → confirmation/success/failure emails (brand-routed) + notification + audit log. Manual/grant/special-access paths bypass gateway for staff.
3. **Learning:** batch must be `running` + enrollment `active` (`batchAccess`/`ownership`) → content delivery → lesson-complete → progress service updates lesson/module/course progress → certificate eligibility.
4. **Quiz + gamification:** start attempt → submit (validated by `submitQuizSchema`) → `scoring.service` → Zames awarded (`zames.model`) → leaderboards (`all_time/monthly`).
5. **Certificate:** request → eligibility check → issue → admin approve → `active`; public verify by ID; revoke path.
6. **Bootcamp:** public register (IP + paymentLast4) → admin approve/reject → catalog browse.
7. **HR:** employee profile → leave request → admin approve → salary records + birthday scheduler.

## 6. API surface

Base `/api/v1`. **117 paths** in `openapi.json`. Interactive docs: `GET /docs` (Scalar), raw `GET /openapi.json`. Health: `GET /health` (200 only when Mongoose connected, else 503 + memory/uptime), `GET /ready`, `GET /` liveness. **After any route/controller change run `npm run docs:generate`** (CI enforces a fresh spec).

Auth cookie flow uses `better-auth.*` cookies; CSRF token header `X-CSRF-Token` required on `/api/v1` mutating calls where issued; correlation id via `x-correlation-id`.

## 7. Data & models (selection)

`User` (Better-Auth managed + role/status/phone/address/avatar) → auto `Profile`. `Course` (slug unique, brand, instructors). `Batch` (courseId, dates, price/manualPrice, status). `Enrollment` (+ `enrollmentCounter` for sequential numbers). `LessonProgress/ModuleProgress/QuizProgress`. `Quiz/Question/Attempt/Zames/Leaderboard`. `Payment` (tran_id unique, status, HMAC callback key). `Certificate`. `BootcampRegistration` + `BootcampCatalog`. `Recording/Announcement/Notification/Settings/Employee(+Salary/Leave)/AuditLog/EmailLog/UploadAsset`.

## 8. Configuration & scripts

Required env (see `.env.example`, validated by Zod in `config/env.ts` — missing vars throw on boot): `MONGO_URI`, `BETTER_AUTH_SECRET/URL`, `GOOGLE_CLIENT_ID/SECRET`, `MA_FRONTEND_URL`, `EP_FRONTEND_URL`, `SERVER_URL`, `SSL_STORE_ID/PASSWORD/IS_LIVE/VALIDATION_API`, `EMAIL_USER/PASS` (+ optional HOST/PORT/SECURE/PROVIDER/FROM), `CLOUDINARY_*`, `SUPER_ADMIN_EMAIL/PASSWORD`, `ADMIN_EMAIL`; optional `GROQ_API_KEY` (chat), `SENTRY_DSN`, `UPSTASH_REDIS_*`, `CRON_SECRET`, `AUTH_COOKIE_DOMAIN`.

| Script | Purpose |
|---|---|
| `dev` (`tsx watch src/server.ts`) | Hot-reload dev |
| `build` / `start` | `tsc` → `node dist/server.js` |
| `lint` / `lint:fix` / `typecheck` | eslint / `tsc --noEmit` |
| `docs:generate` | Regenerate `openapi.json` |
| `seed:courses`, `seed:bootcamp`, `seed:superAdmin` | Seed data / superadmin |
| `migrate:emailVerification` | Backfill verification |
| `test` | Jest `--runInBand --forceExit` (60s timeouts, ESM) |

## 9. Deployment & operations

- **Vercel:** builds `dist/server.js` (`@vercel/node`), all routes → server, daily cron auto-transition. Lazy-connects Mongo on first request (`dbConnected` guard).
- **Docker:** multi-stage, `node:20-alpine`, pnpm filtered build for `ma-server`; `production` runs `pnpm --filter ma-server start`. (Repo-root compose expects sibling clients — server-only checkouts must adjust `Dockerfile` COPY lines.)
- **Graceful shutdown:** 30s cap, `closeAllConnections` at 10s, closes Socket.IO + Mongo on SIGTERM/SIGINT/uncaughtException/unhandledRejection.
- **Limits:** JSON/urlencoded 1 MB, Multer→Cloudinary caps, Socket event throttling.

## 10. Security & compliance notes

Never commit `.env`. Strong `BETTER_AUTH_SECRET`. HTTPS + `NODE_ENV=production` (switches to `secure`/`SameSite=none` cookies). All input through Zod; uploads type-checked; audit logs for sensitive mutations; suspended/deleted gating in two layers (hook + middleware). Rate limits per-surface; Sentry sampling default 0.1.

## 11. Known gaps / roadmap

- `Resource` is model-only (no dedicated CRUD routes); managed via lessons.
- `Assignments` noted "coming soon" in README but no module yet; `ProjectSubmission` validation exists without a full module.
- README references Resend — code uses Nodemailer/SMTP only; `CLIENT_URL`/`AUTH_COOKIE_DOMAIN`/`CRON_SECRET`/`UPSTASH_*` missing from `.env.example`.
- `packageManager: pnpm` but repo has `package-lock.json` and CI uses `npm ci` — lockfile/manager mismatch to reconcile.
- Dockerfile references sibling client packages absent from this checkout.
