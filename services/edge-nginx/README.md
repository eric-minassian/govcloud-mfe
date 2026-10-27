# edge-nginx

The authenticated static origin. GovCloud has no CloudFront, so this nginx container sits
behind the ALB (which enforces OIDC login on every request) and proxies reads to the private S3
artifact bucket.

```
browser ──HTTPS──▶ ALB (authenticate-oidc) ──▶ nginx (ECS Fargate) ──VPC gateway endpoint──▶ S3
```

## What it serves

| Request                              | Served from               | Cache-Control                         |
| ------------------------------------ | ------------------------- | ------------------------------------- |
| `/apps/<app>/<version>/<file>`       | same key in S3            | `public, max-age=31536000, immutable` |
| anything else (client-side routes)   | `index.html` in S3        | `no-cache` (revalidated via ETag)     |
| `/nginx-health`                      | nginx                     | —                                     |

`/api/*` never reaches nginx; the ALB routes it to the frontend API.

## Design notes

- **No request signing.** nginx makes anonymous requests. The bucket policy only allows
  anonymous `s3:GetObject` on `apps/*` and `index.html` when the request comes through the VPC's
  S3 gateway endpoint (`aws:SourceVpce`). That is also why the bucket uses SSE-S3: anonymous
  requests can't decrypt SSE-KMS objects. If you need SSE-KMS, swap this image for one that
  signs requests with the task role (for example the NGINX S3 Gateway project).
- **Nothing user-specific reaches S3.** Cookies and the ALB's `x-amzn-oidc-*` headers are
  stripped before proxying.
- **Local disk cache.** Versioned assets never change, so nginx caches them on local disk.
  Nothing ever needs invalidating.
- **Strict CSP.** Every script, including every remote module, comes from this origin, so the
  Content-Security-Policy can be `script-src 'self'` with no exceptions.
- **Read-only root filesystem.** nginx runs as the image's unprivileged user and only writes to
  `/tmp` and `/var/cache/nginx`. The task definition must mount both as writable volumes
  that uid 101 can write to.

## Configuration

| Variable             | Example                                                    |
| -------------------- | ---------------------------------------------------------- |
| `ASSETS_BUCKET_HOST` | `govcloud-mfe-prod-assets.s3.us-gov-west-1.amazonaws.com`  |
| `DNS_RESOLVER`       | `169.254.169.253` (default, the VPC resolver)              |

To use the S3 FIPS endpoint, set `ASSETS_BUCKET_HOST` to the bucket's `s3-fips` hostname and
check that your gateway endpoint routes to it.
