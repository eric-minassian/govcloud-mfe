# frontend-api

The same-origin API behind `/api/*`. The ALB routes `/api/*` here and every
other path to nginx, so the browser talks to one origin and one session
cookie for assets and APIs alike.

It owns the few APIs that only the UI needs:

| Route | Purpose |
| --- | --- |
| `GET /api/health` | ALB target health check (unauthenticated) |
| `GET /api/me` | The signed-in user, from the ALB-signed claims |
| `GET /api/feature-flags` | AppConfig flags for the web app and every module in `APPS`, evaluated for the caller |
| `GET`/`PUT /api/preferences` | Per-user UI preferences |
| `POST /api/client-events` | Browser error reports → `ClientErrors` CloudWatch metric per module |
| `GET /api/auth/logout` | Ends the ALB session |

There is no module registry: in this variant the modules are compiled into
the web app at build time, so the API only needs to know their names
(`APPS`) to serve their flags and accept their telemetry. The service has no
AWS SDK dependency and no S3 access.

Shapes and configuration are defined in [docs/contracts.md](../../docs/contracts.md)
(§6 API, §9 environment variables); [`src/model.rs`](src/model.rs) mirrors
[`packages/contracts/src/api.ts`](../../packages/contracts/src/api.ts).

## Run locally

```sh
pnpm --filter @govcloud-mfe/frontend-api dev   # or: APP_ENV=local cargo run
```

It listens on port 8080, where the web app's dev server proxies `/api`.
`APP_ENV=local` needs no AWS access:

* every request is a fixed developer user,
* `APPS` defaults to `web` plus every `modules/<name>` that has a `module.json`,
* flags are read from `modules/<app>/feature-flags.json` (or
  `apps/web/feature-flags.json` for the web app), with multi-variant flags
  resolved to their default variant.

```sh
cargo test
cargo clippy --all-targets -- -D warnings
```

## How it fits together

```
src/
  main.rs          startup, graceful shutdown on SIGTERM
  config.rs        environment variables, including APPS
  state.rs         wires concrete implementations into AppState
  auth/            ALB token verification and the CurrentUser extractor
  flags.rs         FlagProvider: AppConfig Agent sidecar or local definitions
  preferences.rs   PreferencesStore (in memory; DynamoDB in a real deployment)
  metrics.rs       CloudWatch Embedded Metric Format output
  routes/          one file per resource
```

### Authentication

The ALB `authenticate-oidc` action signs in the user and forwards their claims
in `x-amzn-oidc-data`, a JWT signed by the load balancer. The service:

1. Splits the token and decodes the header. ALB tokens use base64url *with*
   padding and put `exp`, `signer` and `kid` in the header, so this is done
   by hand rather than with a generic JWT library.
2. Requires `alg = ES256`, `signer` = this ALB's ARN (`ALB_ARN`) and an
   unexpired `exp`.
3. Fetches the public key for `kid`, which is first checked to be a plain
   identifier. In GovCloud the keys are published in S3:
   `https://s3-us-gov-west-1.amazonaws.com/aws-elb-public-keys-prod-us-gov-west-1/<kid>`.
   Commercial regions use `https://public-keys.auth.elb.<region>.amazonaws.com/<kid>`.
   Keys are cached by `kid`.
4. Verifies the ES256 signature over the segments exactly as received.

The unsigned `x-amzn-oidc-identity` and `x-amzn-oidc-accesstoken` headers are
never used. The ECS security group only admits traffic from the ALB, so
requests cannot bypass it.

State-changing requests also pass a `Sec-Fetch-Site` / `Origin` CSRF check
(`tower_http::csrf`), because the ALB session cookie is sent automatically.

### AWS specifics

* Flags are read from the AppConfig Agent sidecar on `localhost:2772`. The
  agent handles AppConfig sessions, polling and caching (with the task role's
  credentials), and evaluates multi-variant flags using the `userId` and
  `email` we send as `Context` headers. Each app has its own AppConfig
  application, `govcloud-mfe-<app>`.
* Client error metrics are EMF lines on stdout. The `awslogs` driver ships
  them to CloudWatch Logs, which turns them into metrics with no SDK calls.
  Each module's alarm watches its own `App` dimension.
* TLS for outbound calls (the ALB key endpoint) uses rustls with the
  `aws-lc-rs` crypto provider, which has a FIPS-validated build.
