# 0006 — A smaller Rust frontend API

**Status:** accepted

## Context

On `main`, the frontend API also serves the module registry: it reads release records from S3
so the shell can discover remotes at runtime. With build-time composition, which modules exist
is decided by the compiler.

## Decision

The Rust service (`services/frontend-api`, axum) keeps only the frontend concerns that need a
server:

| Endpoint              | Why it lives here                                              |
| --------------------- | -------------------------------------------------------------- |
| `/api/me`             | Verifies the ALB's signed identity header (ES256, GovCloud key endpoint, signer check) |
| `/api/feature-flags`  | Evaluates flags server-side through the AppConfig Agent, with user context, for every app in `APPS` |
| `/api/preferences`    | UI-only user data                                              |
| `/api/client-events`  | Turns client failures into per-module CloudWatch metrics (EMF), which drive rollbacks |
| `/api/auth/logout`    | Clears ALB session cookies and redirects to the IdP            |

`APPS` (`web,dashboard,settings`) is set by the platform stack from the discovered modules. It
bounds which AppConfig applications are read and which metric dimensions can be created.

## Consequences

- The service has no AWS SDK and no IAM permissions beyond AppConfig reads. Its task role
  can't touch the artifact bucket.
- Adding a module means redeploying the platform stack so `APPS` includes it. Adding a module is
  already a platform change (the composition list), so this adds no new coordination.
- Domain data still belongs in domain services, not here.
