# AGENTS.md — Misun Academy Server

Guidelines for AI/agentic contributors working in this repo. Backend: **Express 5 + TypeScript (NodeNext ESM) + Mongoose 8 + Better-Auth + Zod**.

## 1. Commands (run from this dir)

```bash
npm run dev              # tsx watch src/server.ts
npm run build            # tsc -p tsconfig.json → dist/
npm start                # node dist/server.js
npm run lint             # eslint src/
npm run lint:fix         # eslint src/ --fix
npm run typecheck        # tsc --noEmit  (use: npx tsc --noEmit)
npm test                 # jest --runInBand --forceExit (60s timeouts, mongodb-memory-server)
npm run docs:generate    # regenerate openapi.json — REQUIRED after route/controller changes
npm run seed:courses|seed:bootcamp|seed:superAdmin
npm run migrate:emailVerification
```

CI (`.github/workflows/ci.yml`) runs: install → lint → typecheck → docs:generate → test. Keep all green. `NODE_ENV=test` in CI; `src/config/env.ts` Zod-validates env on boot — missing vars throw `ApiError`.

> Note: `package.json` declares `packageManager: pnpm` but the checkout uses `package-lock.json` + `npm ci`. Don't switch managers unprompted; follow the existing `npm` flow.

## 2. Project structure

- `src/server.ts` — entry: DB, email worker, crons (`batchScheduler`, `batchReminderScheduler`, `employeeBirthdayReminderScheduler`), Socket.IO, graceful shutdown. No route logic here.
- `src/app.ts` — middleware pipeline. Order matters (see §4).
- `src/routes/index.ts` — mounts all modules under `/api/v1`. Exception: Better-Auth is mounted in `app.ts`.
- `src/modules/<Name>/` — vertical slice: `<name>.model.ts`, `<name>.interface.ts`, `<name>.service.ts`, `<name>.controller.ts`, `<name>.routes.ts`, (`<name>.validation.ts` optional — many schemas live in `src/validations/`).
- `src/middlewares/`, `src/services/`, `src/models/` (cross-cutting: auditLog, email queue, uploadAsset), `src/utils/`, `src/validations/`, `src/types/` (role, common enums), `src/scripts/`, `src/__tests__/`.
- `Progress` and `Resource` have **no HTTP routes** — models/services only, consumed via Content/Enrollment/Lesson. Don't add mounts for them without product approval.

## 3. Module pattern (follow strictly)

New/changed endpoints must follow: `routes → controller → service → model`.

```ts
// routes: auth first, then validateRequest(Zod), then controller
router.post('/', requireAuth, requireAdmin, validateRequest(createCourseSchema), CourseController.createCourse);
// controller: catchAsync + sendResponse, no DB logic
export const createCourse = catchAsync(async (req, res) => {
  const result = await CourseService.createCourse(req.body);
  sendResponse(res, { success: true, statusCode: 201, message: 'Course created', data: result });
});
// service: Mongoose/transactions, throw ApiError(status, msg) on failure
```

- Zod schemas shape: `{ body, query, params, cookies }` (see `validateRequest.ts`). Put reusable schemas in `src/validations/`; keep module-specific ones next to the module only if not shared.
- Response envelope (`sendResponse.ts`): `{ success, statusCode, message, meta?, data, serverTimestamp? }`. Paginated lists include `meta: { page, limit, total }`.
- Errors: `throw new ApiError(statusCode, message)` from services; `globalErrorHandler` formats. Don't `res.status().json()` inside services.
- Imports: **NodeNext ESM — always use `.js` suffix** for relative imports (`./x.js`), even in `.ts` files. `moduleNameMapper` strips them in Jest.
- TypeScript: `strict` + `skipLibCheck`. `no-explicit-any` is off, but prefer real types; `_`-prefixed unused vars only. `no-non-null-assertion` is off — still avoid `!` on unvalidated input.

## 4. Middleware ordering & auth rules

`app.ts` order: Vercel lazy-DB → CORS → Helmet → `correlationId` → `requestLogger` → compression → cookieParser → **Better-Auth routes** (before `express.json()`!) → body parsers (1 MB) → `csrfProtection` → rate limiter + main router → health/ready → `/openapi.json` + `/docs` → `/` → Sentry error handler → 404 → `globalErrorHandler`. Do not reorder without reason; moving auth after `express.json()` breaks Better-Auth.

- `requireAuth` enforces session + `emailVerified` + `active` status, attaches `req.user { id, email, name, role, status, emailVerified }`.
- Role gates: `requireAdmin` (admin+superadmin), `requireSuperAdmin`, `requireInstructor` (instructor+admin+superadmin), `requireEmployee` (employee+admin+superadmin), `requireLearner`, `requireRole(...)`, `optionalAuth` (public-but-personalized reads). Default new users to `Role.LEARNER`; `role`/`status` are `input:false` — never accept them from client bodies.
- Enrollment-gated content: use `batchAccess`/`ownership` middlewares for Content/Recording/Enrollment reads.
- CSRF: mutating `/api/v1` calls need `X-CSRF-Token` where issued; include `x-correlation-id` support when adding clients.
- Rate limits: auth-strict (20/15min on sign-in/up/verify/forget/reset/change-password), auth-general (1000/15min), api (300/15min). Don't bypass; extend via `createRateLimiter({ prefix, windowMs, max, message })`.
- File uploads: `upload.single('image')` / `upload.array('images', 10)` + `handleMulterError`, behind `requireAuth`; Cloudinary config in `src/config/cloudinary.ts`.

## 5. Domain conventions

- Enums live in `src/types/common.ts` (Status, UserStatus, EnrollmentStatus, BatchStatus, CourseStatus, LessonType, QuizStatus, CertificateStatus, …). Import them — don't redefine string unions.
- Brand routing: use `deriveCourseBrand(course)` + `courseEmailRouter` for emails; `MA_*` vs `EP_*` env links. New course-adjacent emails must be brand-aware.
- Payments: transaction IDs `MA…`; status callbacks HMAC-signed; always validate via `SSL_VALIDATION_API` server-side; wrap enrollment activation in a Mongoose transaction; sync profile (`ProfileService.createOrUpdateProfileAfterEnrollment`), send brand email, create notification, `recordAudit()`.
- Emails: never send inline — enqueue via `emailService`/`EmailLogModel` (worker retries). Templates go in `misunAcademyEmails.ts` / `esunPointEmails.ts`.
- Realtime: emit via `socketService`; respect the 20-events/10s per-user throttle.
- Schedulers: node-cron in `src/utils/*Scheduler.ts`, started from `server.ts`; Vercel cron hits `/api/v1/batches/auto-transition/run` (guard with `CRON_SECRET` when adding new cron endpoints).
- Audit: call `recordAudit()` on admin mutations (users, payments, refunds, certificates, enrollments).

## 6. Definition of done

1. `npm run lint` clean, `npx tsc --noEmit` clean.
2. `npm test` passes; add/extend Jest tests under `src/__tests__/` for new service/validation/route logic (follow existing `*.test.ts` patterns, use mongodb-memory-server — no live DB).
3. `npm run docs:generate` re-run and commit updated `openapi.json` whenever routes/controllers change.
4. No secrets in code/logs; new env vars → add to `src/config/env.ts` Zod schema **and** `.env.example`.
5. Keep `docs/PRODUCT_DOC.md` in sync when adding modules/flows/roles.

## 7. Don'ts

- Don't commit `.env`, `dist/`, logs, or Cloudinary/SSL/Groq keys.
- Don't expose `role`/`status` as client-settable fields or skip `requireAuth` email-verification semantics.
- Don't bypass `validateRequest`, `catchAsync`, `sendResponse`, or `ApiError` with ad-hoc handling.
- Don't create top-level route files outside `src/routes/index.ts` mount table (except Better-Auth, which stays in `app.ts`).
- Don't add dependencies without need; Node ≥ 20 APIs preferred over new packages.
