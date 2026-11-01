# Runbook: Payment Gateway Down

## Scenario
SSLCommerz gateway is unreachable or returning errors. Learners cannot complete payments, and webhooks/IPNs are not being received.

## Detection
- High rate of 5xx errors from `sslcommerz-lts` SDK calls
- Alert: `payment_gateway_errors_rate` > threshold
- Customer support tickets: "payment failed", "cannot enroll"
- No new `success` payments in dashboard for >30 min during business hours

## Immediate Response
1. **Verify the outage**: Check SSLCommerz status page (https://developer.sslcommerz.com/) and try a manual API call to the validation endpoint.
2. **Check local config**: Verify `SSL_STORE_ID`, `SSL_STORE_PASSWORD`, `SSL_IS_LIVE`, `SSL_VALIDATION_API` in `.env` are correct.
3. **Check network**: Ensure outbound HTTPS to sslcommerz.com is not blocked by firewall/security group.

## Mitigation
1. **Enable manual payment fallback**: Direct learners to use the manual payment path (PhonePe/bKash with UTR) via `/api/v1/enrollments/manual`. Admins can verify via `verifyManualPayment`.
2. **Communicate**: Post a banner on the site and send an email notification (via `sendNewsUpdate`) explaining the issue and alternative payment method.
3. **Queue payments**: Learners who attempted SSLCommerz payment will have `pending`/`payment-pending` enrollments. These will be picked up by the reconciliation job once the gateway recovers.

## Reconciliation
- The reconciliation job (`paymentReconciliation.service.ts`) runs hourly and queries SSLCommerz for each pending transaction.
- Once the gateway is back, run reconciliation manually: call `POST /api/v1/payments/maintenance/run` (requires `CRON_SECRET`).
- For each pending payment, the job calls the gateway validation API and activates/expires the enrollment accordingly.

## Escalation
- If SSLCommerz is down >4 hours, escalate to engineering lead.
- If SSLCommerz is down >24 hours, consider temporarily switching to sandbox/test mode or integrating an alternative gateway.

## Verification
- Confirm new `success` payments appear in the dashboard.
- Verify webhook callbacks (`POST /api/v1/payments/webhook`) are being received.
- Check that pending enrollments are being activated via reconciliation.

---

# Runbook: Database Slow / Failover

## Scenario
MongoDB is slow (high latency, high CPU) or has failed over to a secondary node.

## Detection
- Alert: `db_response_time_p99` > 2s for 5 min
- Alert: `db_connections_usage` > 80%
- Application errors: `MongoServerSelectionError`, `MongoNetworkError`
- Slow query log shows queries taking >1s

## Immediate Response
1. **Check MongoDB Atlas/cloud dashboard**: Verify cluster health, failover status, and any ongoing maintenance.
2. **Check connection pool**: Mongoose connection pool may be exhausted. Check `db_connections_usage` metric.
3. **Identify slow queries**: Use MongoDB profiler or `explain()` on hot paths:
   - `enrollments` by `userId` + `status`
   - `payments` by `transactionId`
   - `batches` by `status`

## Mitigation
1. **Scale up**: If using MongoDB Atlas, scale up the cluster tier temporarily.
2. **Add read replicas**: Route read queries to secondary nodes if using a replica set.
3. **Optimize queries**: Add missing indexes. Common missing indexes:
   - `enrollments: { userId: 1, status: 1 }`
   - `payments: { transactionId: 1 }`
   - `payments: { userId: 1, status: 1 }`
4. **Reduce connection pool**: Lower `maxPoolSize` in Mongoose connection options if connections are being exhausted.

## Failover
- If using MongoDB Atlas with auto-failover, the driver handles this automatically. Verify the connection string includes `replicaSet` and `readPreference=secondaryPreferred`.
- If manual failover is needed, promote a secondary in the MongoDB console and update the connection string.

## Verification
- Query latency returns to <100ms p99.
- Error rate drops to <0.1%.
- Connection pool usage returns to <70%.

---

# Runbook: Email Failing

## Scenario
Transactional emails (enrollment confirmation, payment success/failure, certificate issued, batch reminders) are not being delivered.

## Detection
- Alert: `email_delivery_failure_rate` > 5%
- `EmailLogModel` shows many `failed` status entries
- Customer reports: "not receiving confirmation email"

## Immediate Response
1. **Check SMTP credentials**: Verify `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` in `.env`.
2. **Check email provider**: Verify the SMTP provider (SendGrid, Mailgun, etc.) is not experiencing an outage.
3. **Check email queue**: Query `EmailLogModel` for failed/pending emails.
4. **Check DNS**: Verify SPF/DKIM/DMARC records are correct for the sending domain.

## Mitigation
1. **Retry failed emails**: The email worker retries failed emails with exponential backoff. Check the worker is running (`initializeEmailWorker` in `server.ts`).
2. **Switch provider temporarily**: If the primary SMTP provider is down, switch to a backup provider by updating env vars and restarting.
3. **Notify users**: If critical emails (enrollment confirmation) are affected, notify affected users via in-app notification or alternative channel.

## Verification
- New emails are delivered successfully.
- `EmailLogModel` shows `sent` status for new emails.
- Failed email count decreases over time as retries succeed.

---

# Runbook: Video Host Down

## Scenario
Video hosting (YouTube/Google Drive) is unavailable or videos are not playing for learners.

## Detection
- Customer reports: "video not playing", "video won't load"
- YouTube/Google Drive status page shows degradation
- High error rate on video embed requests

## Immediate Response
1. **Verify the outage**: Check YouTube/Google Drive status pages.
2. **Check video URLs**: Verify lesson `videoUrl` and `videoSource` fields are correct in the database.
3. **Check CORS/domain restrictions**: Ensure the video host allows embedding from your domain.

## Mitigation
1. **Use alternative host**: If YouTube is down, instructors can re-upload to Google Drive (or vice versa) and update the lesson `videoSource` and `videoId`.
2. **Use signed URLs**: For Cloudinary-stored videos, use `GET /api/v1/lessons/:lessonId/signed-url` which generates signed, expiring URLs.
3. **Notify learners**: Post a banner and send an email about the temporary video issue.

## DRM/Download Protection
- Videos stored in Cloudinary with `type: 'authenticated'` require signed URLs for access.
- Enable domain restriction on Cloudinary to prevent hotlinking.
- Set `videoDrmProtected` and `videoWatermarked` flags on lessons for DRM-protected content.

## Verification
- Videos play successfully in the learner dashboard.
- Signed URLs return 200 with valid video content.
- Unsigned URLs return 401/403.

---

# Runbook: Stuck Payments

## Scenario
Payments are stuck in `pending` or `payment-pending` status for an extended period. Learners have paid but don't have access.

## Detection
- Dashboard shows payments with `pending` status for >24 hours
- `payment-failed` enrollments that should be `active`
- Customer reports: "paid but no access"

## Immediate Response
1. **Identify stuck payments**: Query `PaymentModel.find({ status: 'pending', updatedAt: { $lt: 24h ago } })`.
2. **Check gateway**: Query SSLCommerz for each stuck transaction ID using the validation API.
3. **Reconcile**: Run the reconciliation job: `POST /api/v1/payments/maintenance/run` (requires `CRON_SECRET`).

## Mitigation
1. **Manual verification**: For payments where the gateway confirms success but the webhook was missed, use `POST /api/v1/payments/:tran_id/re-verify` (admin only, requires reason).
2. **Manual approval**: For manual payments (PhonePe/bKash), admin verifies via `verifyManualPayment` with UTR proof.
3. **Activate enrollment**: Once payment is verified as success, `activateEnrollmentForPayment` activates the enrollment and increments seat counter.

## Prevention
- The reconciliation job runs hourly to catch missed webhooks.
- The abandoned-enrollment job expires `pending` enrollments after `ENROLLMENT_EXPIRY_HOURS` (default 48h).
- Webhook endpoint (`POST /api/v1/payments/webhook`) validates via `val_id` via the validation API.

## Verification
- Previously stuck payments are now `success` and enrollments are `active`.
- Learners confirm they have access to course content.

---

# Runbook: Manual Payment Resolution

## Scenario
Learner pays via manual method (bKash/Nagad/Personal) and submits UTR via the manual payment form. Admin needs to verify and activate enrollment.

## Detection
- Payment with `method: 'manual'` and `status: 'review'` in dashboard
- Payment with `status: 'payment-pending'` enrollment
- Support ticket: "paid via bKash but no access"

## Immediate Response
1. **Verify the payment**: Ask learner for UTR/transaction ID and screenshot.
2. **Check for duplicates**: Query `PaymentModel.find({ 'gatewayResponse.phonePeTransactionId': <UTR> })` to ensure the UTR hasn't been used before.
3. **Verify with gateway**: For SSLCommerz payments, query the validation API. For manual payments, verify the UTR against the gateway's transaction records.

## Mitigation
1. **Approve payment**: `POST /api/v1/payments/:tran_id/verify` with `approved: true` and reason. This activates the enrollment and increments the seat counter.
2. **Reject payment**: `POST /api/v1/payments/:tran_id/verify` with `approved: false` and reason. This marks the payment as `failed` and enrollment as `payment-failed`.
3. **Notify learner**: Send confirmation email (success or failure) via the email queue.

## Prevention
- UTR deduplication: `paymentAttempt.model.ts` tracks unique `phonePeTransactionId` values.
- Amount validation: `finalizeSSLCommerzPayment` compares gateway amount with stored amount.
- Currency validation: Ensures currency matches (BDT for MA, INR for EP).

## Verification
- Payment status changes to `success`/`failed`.
- Enrollment status changes to `active`/`payment-failed`.
- Learner receives confirmation email.

---

# Runbook: Certificate Revocation

## Scenario
A certificate needs to be revoked (e.g., refund issued, academic misconduct, duplicate issuance).

## Detection
- Support ticket: "revoke certificate"
- Admin identifies fraudulent certificate
- Refund processed for completed course

## Immediate Response
1. **Identify the certificate**: Query `CertificateModel.findOne({ certificateId: <id> })` or by enrollment ID.
2. **Verify eligibility**: Check if revocation is appropriate (refund issued, academic misconduct, etc.).
3. **Revoke certificate**: `POST /api/v1/certificates/:id/revoke` (admin only). This:
   - Sets certificate status to `revoked`
   - Sets `certificateIssued = false` on the enrollment
   - Keeps enrollment status as `completed` (does not resurrect to `active`)
   - Writes status history and audit log

## Verification
- Certificate status is `revoked`.
- Public verification page (`/verify-certificate/:id`) shows certificate as revoked.
- Enrollment `certificateIssued` is `false`.
- Audit log entry exists for the revocation.

---

# Runbook: Webhook Failure

## Scenario
SSLCommerz webhook (`POST /api/v1/payments/webhook`) is failing or not being received.

## Detection
- Alert: `webhook_failure_rate` > threshold
- Payments show `pending` but gateway shows `success`
- No webhook entries in server logs

## Immediate Response
1. **Check webhook endpoint**: Verify `https://<domain>/api/v1/payments/webhook` is reachable.
2. **Check HMAC verification**: Ensure `SSL_STORE_PASSWORD` matches the gateway's validation key.
3. **Check SSLCommerz dashboard**: Verify the webhook URL is configured correctly in the SSLCommerz merchant panel.
4. **Reconcile**: Run `POST /api/v1/payments/maintenance/run` to process pending payments via the validation API.

## Mitigation
1. **Fix webhook URL**: Update SSLCommerz merchant settings with the correct callback URL.
2. **Fix HMAC**: Ensure `SSL_STORE_PASSWORD` matches.
3. **Manual reconciliation**: Use the re-verify endpoint for individual payments.

## Verification
- Webhook endpoint returns 200 for test callbacks.
- Pending payments are activated via reconciliation.
- New payments are automatically activated via webhook.

---

# Runbook: Email Worker Failure

## Scenario
The email worker (`initializeEmailWorker` in `server.ts`) is not processing the email queue.

## Detection
- `EmailLogModel` shows many `pending` emails that are not being sent
- Alert: `email_queue_depth` > threshold
- Customer reports: "not receiving emails"

## Immediate Response
1. **Check worker status**: Verify the email worker is running (started in `server.ts` via `initializeEmailWorker`).
2. **Check SMTP credentials**: Verify `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_HOST`, `EMAIL_PORT` in `.env`.
3. **Check email queue**: Query `EmailLogModel` for `pending`/`failed` emails.

## Mitigation
1. **Restart worker**: Restart the server to reinitialize the email worker.
2. **Fix SMTP**: Update SMTP credentials in `.env` and restart.
3. **Retry failed emails**: The email worker retries failed emails with exponential backoff.

## Verification
- `EmailLogModel` shows `sent` status for new emails.
- Pending emails are processed and sent.
- Email queue depth returns to normal.

---

# Runbook: High 5xx Error Rate

## Scenario
Application is returning high rates of 5xx errors.

## Detection
- Alert: `http_5xx_rate` > threshold
- Sentry alerts: high error rate
- Customer reports: "site not working", "errors"

## Immediate Response
1. **Check Sentry**: Review recent error events for common patterns.
2. **Check server logs**: Look for stack traces and error messages.
3. **Check dependencies**: Verify database, email, payment gateway, and video host are all operational.
4. **Check recent deployments**: If a recent deploy caused the issue, roll back.

## Mitigation
1. **Rollback**: If a recent deploy caused the issue, roll back to the previous version.
2. **Scale up**: If the issue is resource exhaustion, scale up the server.
3. **Fix code**: If a specific code path is causing errors, fix and redeploy.

## Verification
- 5xx error rate returns to normal (<0.1%).
- Sentry alerts stop.
- Customer reports stop.

---

# Runbook: Cron Job Failure

## Scenario
Cron jobs (batch transitions, payment maintenance, chat conversation purge, enrollment expiry) are not running.

## Detection
- Alert: `cron_job_failure` > 0
- Payments not reconciled, enrollments not expired, chat conversations not purged
- Vercel cron logs show failures

## Detection
- Check Vercel cron logs for failed runs.
- Verify `CRON_SECRET` is set correctly.
- Check endpoint URL is correct (`/api/v1/batches/auto-transition/run`, `/api/v1/payments/maintenance/run`, etc.).

## Mitigation
1. **Fix CRON_SECRET**: Update `CRON_SECRET` in `.env` and Vercel environment variables.
2. **Fix endpoint**: Ensure the cron endpoint URL is correct and reachable.
3. **Manual run**: Manually trigger the cron endpoint to process overdue jobs.

## Verification
- Cron jobs run successfully.
- Overdue jobs are processed.
- No new cron failures.

---

# RPO/RTO Targets

| Scenario | RPO (Recovery Point Objective) | RTO (Recovery Time Objective) |
|----------|-------------------------------|-------------------------------|
| Database failure | 1 hour (MongoDB Atlas PITR) | 4 hours |
| Payment gateway down | 0 minutes (gateway handles retries) | 4 hours |
| Email down | 1 hour (email queue persists) | 2 hours |
| Video host down | 0 minutes (videos hosted externally) | 2 hours |
| Application code bug | 15 minutes (automated backups) | 30 minutes (rollback) |
| Complete region outage | 4 hours (cross-region backup) | 8 hours |

## Backup Strategy
- MongoDB Atlas: Automated daily snapshots + continuous PITR (last 7 days)
- Application code: Git repository (off-site)
- Configuration: `.env` files (not in Git, stored securely)
- SSLCommerz: Gateway handles payment persistence

## Restore Procedure
1. **Database**: Restore from MongoDB Atlas snapshot or PITR to a point before the incident.
2. **Application**: Redeploy from Git repository.
3. **Configuration**: Restore `.env` from secure storage.
4. **Verify**: Run smoke tests on auth, enrollment, payment, and certificate flows.

---

# Sentry Alert Rules

| Alert | Condition | Threshold | Severity |
|-------|-----------|-----------|----------|
| High 5xx Rate | `http.status_code:500` events | > 10/min for 5 min | Critical |
| Webhook Failures | `event:webhook_failure` | > 5/min for 10 min | Critical |
| Payment Validation Mismatch | `event:payment.validation_mismatch` | > 3/hour | High |
| Invariant Violation | `event:invariant.violation` | > 0 (any) | Critical |
| Admin Payment Change | `action:payment.admin_reverify` | > 0 (any) | Medium |
| Enrollment Capacity Drift | `invariant:capacity_drift` | > 0 (any) | High |
| Cron Failure | `event:cron.failure` | > 0 (any) | Medium |
| Email Failure | `event:email.failure` | > 10/hour | Medium |

## Sentry Configuration
- Environment: `production`, `staging`, `development`
- Release tracking: Enable release tracking via `sentry-cli releases`
- Error filtering: Filter out expected errors (e.g., client-side validation errors)
- Alert routing: Critical alerts to on-call engineer, Medium/High to team channel

---

# Disaster Recovery

## RPO/RTO Summary
- **RPO**: 1 hour maximum data loss (MongoDB PITR)
- **RTO**: 8 hours maximum downtime (complete region outage)

## Single Points of Failure
- **SSLCommerz**: Single payment gateway. Mitigation: Manual payment fallback.
- **SMTP Provider**: Single email provider. Mitigation: Backup provider configuration.
- **MongoDB Atlas**: Single cluster. Mitigation: Auto-failover, PITR.
- **Application Server**: Single VPS/server. Mitigation: Quick redeployment from Git.

## Disaster Recovery Steps
1. **Assess**: Determine scope of outage (application, database, gateway, etc.).
2. **Communicate**: Notify users via status page, email, and in-app notifications.
3. **Restore Database**: Restore from MongoDB Atlas snapshot or PITR.
4. **Redeploy Application**: Redeploy from Git repository.
5. **Reconfigure**: Restore `.env` and third-party integrations.
6. **Verify**: Run smoke tests on critical flows (auth, enrollment, payment, certificate).
7. **Post-mortem**: Document root cause and preventive measures.
