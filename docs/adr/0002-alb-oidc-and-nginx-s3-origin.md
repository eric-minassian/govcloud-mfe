# 0002 — Authenticate at the ALB, serve assets through nginx from private S3

**Status:** accepted

## Context

All requests, including static assets, must be authenticated. GovCloud has no CloudFront,
so there are no signed cookies, no Lambda@Edge and no origin access control.

## Decision

- An internet-facing (or internal) **ALB** with an HTTPS listener whose rules all start with an
  **`authenticate-oidc`** action:
  - `/api/*` → frontend-api, `OnUnauthenticatedRequest: deny`, so XHR gets a 401 and not a
    redirect.
  - default → nginx, `OnUnauthenticatedRequest: authenticate`.
  - `/signed-out` → unauthenticated fixed response, which ALB logout requires.
- **nginx on Fargate** proxies to S3 with **unsigned** requests through the VPC's **S3 gateway
  endpoint**. The bucket policy allows anonymous `GetObject` on `builds/*` and `index.html`
  only with `aws:SourceVpce` set to that endpoint. Block Public Access stays fully on, because
  policies conditioned on a fixed VPC endpoint are not considered public.
- The bucket uses **SSE-S3**, because anonymous requests can't use KMS keys.
- Tasks run in **isolated subnets** with VPC endpoints (ECR, Logs, AppConfig, S3) and need no
  NAT.

## Consequences

- One origin for everything, so the CSP can be `script-src 'self'` with no exceptions and no
  CORS is needed.
- nginx adds a hop that CloudFront would have absorbed. It mitigates that with a local disk cache
  for immutable assets and HTTP keep-alive to S3.
- Anything in the VPC that routes through the gateway endpoint could read `builds/*`. The
  assets are the same for every authenticated user, so this is acceptable. Release records
  are not exposed.
- If SSE-KMS is required, nginx must sign requests with the task role (for example the NGINX S3
  Gateway image) and the VPCE-anonymous policy goes away.

## Alternatives considered

- **S3 static website hosting.** It doesn't support HTTPS or VPC endpoints, and it can't be put
  behind ALB auth.
- **ALB → S3 interface endpoint directly (IP target group).** No auth headers would be
  stripped, there would be no SPA fallback and no cache-header control, and rewriting `/` to
  `index.html` is awkward.
- **Serving assets from the Rust service.** This mixes concerns, and nginx is the better static
  server.
