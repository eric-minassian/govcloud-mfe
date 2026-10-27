# frontend-api

The same-origin API behind `/api/*`. The ALB routes `/api/*` here and every
other path to nginx, so the browser talks to one origin and one session
cookie for assets and APIs alike.

It owns the APIs that only the UI needs:

| Route | Purpose |
| --- | --- |
| `GET /api/health` | ALB target health check (unauthenticated) |
| `GET /api/me` | The signed-in user, from the ALB-signed claims |
| `GET /api/modules` | Remotes the shell should load: active release of each app, minus kill-switched ones |
| `GET /api/feature-flags` | Every app's AppConfig flags, evaluated for the caller |
| `GET`/`PUT /api/preferences` | Per-user UI preferences |
| `POST /api/client-events` | Browser error reports → `ClientErrors` CloudWatch metric |
| `GET /api/auth/logout` | Ends the ALB session |

Shapes and configuration are defined in [docs/contracts.md](../../docs/contracts.md)
(§4 API, §7 environment variables); [`src/model.rs`](src/model.rs) mirrors
[`packages/contracts`](../../packages/contracts/src).

## Run locally

```sh
pnpm --filter @govcloud-mfe/frontend-api dev   # or: APP_ENV=local cargo run
```

`APP_ENV=local` needs no AWS access: every request is a fixed developer
user, release records come from [`dev/releases`](../../dev/releases), and
flags are read from each app's `apps/<app>/feature-flags.json` (multi-variant
flags resolve to their default variant).

```sh
cargo test
cargo clippy --all-targets -- -D warnings
```

## How it fits together

```
src/
  main.rs          startup, graceful shutdown on SIGTERM
  config.rs        environment variables
  state.rs         wires concrete implementations into AppState
  auth/            ALB token verification and the CurrentUser extractor
  releases.rs      ReleaseStore: S3 (releases/<app>.json) or local dir, with a 15s cache
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

* Region, credentials (ECS task role) and FIPS endpoints
  (`AWS_USE_FIPS_ENDPOINT=true`) come from the standard AWS SDK environment.
* Flags are read from the AppConfig Agent sidecar on `localhost:2772`. The
  agent handles polling and caching, and evaluates multi-variant flags using
  the `userId` and `email` we send as `Context` headers.
* Client error metrics are EMF lines on stdout. The `awslogs` driver ships
  them to CloudWatch Logs, which turns them into metrics with no SDK calls.
