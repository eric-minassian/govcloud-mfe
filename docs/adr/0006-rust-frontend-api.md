# 0006 — A Rust same-origin API for frontend-only concerns

**Status:** accepted

## Context

The frontend needs a few server-side capabilities that belong to no domain backend: who the user
is, which modules are live, which flags are on, UI preferences, and a sink for client
telemetry. These must be same-origin (behind the same ALB auth) and fast.

## Decision

A small Rust service (`services/frontend-api`, axum) on `/api/*`:

| Endpoint              | Why it lives here                                              |
| --------------------- | -------------------------------------------------------------- |
| `/api/me`             | Verifies the ALB's signed identity header (ES256, GovCloud key endpoint, signer check) |
| `/api/modules`        | Combines release records (S3) with kill-switch flags          |
| `/api/feature-flags`  | Server-side evaluation through the AppConfig Agent, with user context |
| `/api/preferences`    | UI-only user data                                              |
| `/api/client-events`  | Turns client failures into CloudWatch metrics (EMF), which drive rollbacks |
| `/api/auth/logout`    | Clears ALB session cookies and redirects to the IdP           |

Domain data (cases, records and so on) does **not** belong here. It belongs in domain services,
which the frontend reaches through their own ALB rules.

## Consequences

- A small, memory-safe, low-latency binary on a distroless image with a fast cold start.
- The service is stateless except for the in-memory preferences store, which is a POC
  stand-in for DynamoDB.
- Its endpoints are a contract with independently deployed frontends, documented in
  `docs/contracts.md` and mirrored in `packages/contracts`.
