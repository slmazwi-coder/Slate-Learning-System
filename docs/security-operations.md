<!-- coderabbit-ai-generated:v1 -->

# Security operations

## Account recovery

Recovery sends a 15-minute, single-use code through the Resend email API. Configure `RESEND_API_KEY` and `RECOVERY_EMAIL_FROM` with a verified sender in the deployment environment; without both settings, recovery returns an unavailable message. Confirm delivery to a synthetic test account before rollout. Password resets revoke existing sessions for the affected identity.

## Learner links

A learner can create a one-use, ten-minute approval code from their profile for a named adult's SLATE ID and role. Existing search-created parent and tutor links are retained but cannot access learner data until reapproved. Owner-created learner relationships remain available. Tutor-owned class reports with unverified historical links are unavailable until those links are approved. Review existing teacher class enrollments and remove any unauthorized relationships; historical join-code and manual additions cannot be reliably distinguished by this migration.

## Rate limiting and marking

Authentication rate limits use PostgreSQL counters and fail closed when the database is unavailable. The server trusts no forwarded IP addresses by default. Set `TRUST_PROXY_HOPS` only after verifying the number of trusted proxies on every path to the application; a wrong value can allow spoofing or group unrelated users under one address.

Submission answers are saved before AI marking. Interrupted automatic marking becomes eligible for retry after the lease expires; one failed paper is retried per teacher class overview request. <!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:91f693b7c1072b44126e33fac66fc05fe357063ee4ef16b959dd974d9aacadc0 -->

Manual and selective papers interrupted during marking, or selective papers whose automatic marking fails, remain available for teacher review.

<!-- /coderabbit-ai-generated:v1 --> Monitor failed marking and arrange a durable scheduled worker if automatic recovery without teacher visits is required.
