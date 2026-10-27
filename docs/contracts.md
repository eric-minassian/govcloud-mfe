# Contracts

The pieces of this repo are deployed independently, so the interfaces between
them are written down here. If you change one of these, you are changing a
contract that other teams' deployed code depends on — make it backwards
compatible or version it.

TypeScript definitions live in [`packages/contracts`](../packages/contracts/src/index.ts).
The Rust service mirrors them in
[`services/frontend-api/src/model.rs`](../services/frontend-api/src/model.rs).

## 1. App descriptor — `apps/<app>/microfrontend.json`

One per deployable frontend. Read by the build (Module Federation name), the
CDK app (which stacks/pipelines to create) and the release CLI (what to write
into the release record).

| Field           | Shell | Remote | Notes                                                        |
| --------------- | :---: | :----: | ------------------------------------------------------------ |
| `name`          |   ✓   |   ✓    | `^[a-z][a-z0-9]*$`. MF container name, S3 prefix, AppConfig app suffix. |
| `kind`          |   ✓   |   ✓    | `"shell"` or `"remote"`.                                     |
| `displayName`   |   ✓   |   ✓    | Shown in navigation.                                         |
| `route`         |       |   ✓    | Base path the shell mounts the module at, e.g. `/dashboard`. |
| `exposedModule` |       |   ✓    | MF expose key that default-exports the module's root component. Always `./App` today. |
| `owner`         |   ✓   |   ✓    | Owning team. Used for tagging.                               |
| `devPort`       |   ✓   |   ✓    | Local dev server port.                                       |

## 2. Artifact bucket layout (one bucket per stage)

```
apps/<app>/<version>/**                   Immutable build output. URL path == object key.
apps/<app>/<version>/.upload-complete     Written last by `release publish`; marks the version as deployable.
releases/<app>.json                       The active release record for <app> (mutable pointer).
index.html                                Shell entry document; a copy of apps/shell/<version>/index.html.
```

* `<version>` is the first 12 characters of the git commit SHA.
* Every build is compiled with `publicPath = /apps/<app>/<version>/`, so a
  version's files only ever reference files in the same immutable prefix.
* Versions are never deleted by deploys or rollbacks. Users with an open tab
  keep lazy-loading chunks from the version they booted with.
* The bucket is versioned; the object history of `releases/<app>.json` *is* the
  release history used for rollback.
* Each app's release role (§8) may only read and write `apps/<app>/*` and
  `releases/<app>.json` (plus `index.html` for the shell). It may list the bucket, including
  object versions, only under those prefixes. Release tooling must work within that: it checks
  whether an object exists with a prefix listing, because `HeadObject` on a missing key returns
  403 rather than 404 without bucket-wide `s3:ListBucket`.

## 3. Release record — `releases/<app>.json`

```jsonc
{
  "schemaVersion": 1,
  "app": "dashboard",
  "kind": "remote",                      // "shell" | "remote"
  "version": "3f9c2a1b7d4e",
  "entry": "/apps/dashboard/3f9c2a1b7d4e/mf-manifest.json", // shell: .../index.html
  "displayName": "Dashboard",
  "route": "/dashboard",                 // remotes only
  "exposedModule": "./App",              // remotes only
  "commit": "3f9c2a1b7d4e8a7f0c1d2e3f4a5b6c7d8e9f0a1b",
  "releasedAt": "2026-10-27T17:04:05.000Z",
  "releasedBy": "arn:aws-us-gov:sts::111111111111:assumed-role/govcloud-mfe-dashboard-prod-release/..."
}
```

Written only by `release promote` / `release rollback`, with
`Cache-Control: no-cache`. For local development the frontend-api reads the
same shape from [`dev/releases/*.json`](../dev/releases).

## 4. Frontend API (`services/frontend-api`, same origin, `/api/*`)

All routes except `/api/health` require a valid ALB `x-amzn-oidc-data` header.
State-changing requests that a browser marks as cross-site (`Sec-Fetch-Site`,
or an `Origin` that doesn't match `Host`) are rejected with 403. This is CSRF
defence in depth on top of the ALB cookie.

| Method & path              | Response / body                                                                 |
| -------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/health`          | `{ "status": "ok" }` — ALB target health check, unauthenticated.                |
| `GET /api/me`              | `CurrentUser` `{ sub, email?, name?, groups: string[] }`                         |
| `GET /api/modules`         | `ModuleRegistry` `{ shell: { version } \| null, modules: RemoteModule[] }` — remotes whose `moduleEnabled` flag is not `false` (fail-open). `RemoteModule = { name, displayName, route, entry, exposedModule, version }`. |
| `GET /api/feature-flags`   | `FeatureFlags` `{ [app]: { [flag]: { enabled: boolean, ...attributes } } }`, evaluated for the caller (AppConfig `Context: userId=<sub>`, `Context: email=<email>`). |
| `GET /api/preferences`     | `UserPreferences` `{ theme: "system"\|"light"\|"dark", density: "comfortable"\|"compact", pinnedModules: string[] }` |
| `PUT /api/preferences`     | Body and response: `UserPreferences`.                                           |
| `POST /api/client-events`  | Body `{ events: ClientEvent[] }` (max 20), `ClientEvent = { type: "module-load-failure"\|"render-error", app, version?, message }`. Returns `202`. Unknown apps are dropped. |
| `GET /api/auth/logout`     | Expires the ALB session cookie shards and redirects to the IdP logout URL.     |

## 5. Feature flags

* One AppConfig **application per app**: `govcloud-mfe-<app>`; one
  **environment per stage** (`dev`, `prod`); one **profile** `feature-flags`
  of type `AWS.AppConfig.FeatureFlags`. AppConfig only allows one deployment
  per environment at a time, so per-app applications keep teams from blocking
  (or rolling back) each other.
* Definitions live in `apps/<app>/feature-flags.json` and ship with the app's
  pipeline. Every remote defines `moduleEnabled` (kill switch).
* The frontend-api reads flags through the AppConfig Agent sidecar at
  `http://localhost:2772/applications/govcloud-mfe-<app>/environments/<stage>/configurations/feature-flags`.
  Locally it reads `apps/<app>/feature-flags.json` directly and resolves each
  flag to its `values` entry (for multi-variant flags: the variant with no rule).

## 6. Client error metric

The frontend-api writes each accepted client event as a CloudWatch Embedded
Metric Format line to stdout:

* Namespace `GovcloudMfe/Frontend`, metric `ClientErrors` (Count), dimension `App`.

Each app's stack alarms on its own dimension
(`govcloud-mfe-<app>-<stage>-client-errors`). That alarm gates the pipeline's
prod stage and is the AppConfig rollback monitor for the app's flags.

## 7. Frontend-api configuration (environment variables)

| Variable                       | Example                                         | Notes                                           |
| ------------------------------ | ----------------------------------------------- | ----------------------------------------------- |
| `APP_ENV`                      | `aws` \| `local`                                | `local` switches every default below to local sources. |
| `PORT`                         | `8080`                                          |                                                 |
| `AUTH_MODE`                    | `alb` \| `local-dev`                            | `local-dev` refuses to start unless `APP_ENV=local`. |
| `ALB_ARN`                      | `arn:aws-us-gov:elasticloadbalancing:...`        | Expected `signer` of `x-amzn-oidc-data`.        |
| `AWS_REGION`                   | `us-gov-west-1`                                 | Selects the ALB public-key endpoint.            |
| `SESSION_COOKIE_NAME`          | `govcloud-mfe-session`                          | Must match the ALB authenticate action.         |
| `LOGOUT_REDIRECT_URL`          | `https://idp.example.gov/logout?...`            |                                                 |
| `RELEASES_SOURCE`              | `s3` \| `local`                                 |                                                 |
| `ASSETS_BUCKET`                | `govcloud-mfe-prod-assets-...`                  | When `RELEASES_SOURCE=s3`.                      |
| `LOCAL_RELEASES_DIR`           | `../../dev/releases`                            | When `RELEASES_SOURCE=local`.                   |
| `FLAGS_SOURCE`                 | `appconfig-agent` \| `local`                    |                                                 |
| `APPCONFIG_AGENT_URL`          | `http://localhost:2772`                         |                                                 |
| `APPCONFIG_APPLICATION_PREFIX` | `govcloud-mfe-`                                 |                                                 |
| `APPCONFIG_ENVIRONMENT`        | `prod`                                          |                                                 |
| `APPCONFIG_PROFILE`            | `feature-flags`                                 |                                                 |
| `LOCAL_FLAGS_DIR`              | `../../apps`                                    | Reads `<dir>/<app>/feature-flags.json`.         |
| `METRICS_NAMESPACE`            | `GovcloudMfe/Frontend`                          |                                                 |

## 8. Naming

| Thing                       | Name                                             |
| --------------------------- | ------------------------------------------------ |
| Platform stack              | `GovcloudMfe-<stage>-Platform`                   |
| Per-app runtime stack       | `GovcloudMfe-<stage>-App-<app>`                  |
| Per-app pipeline stack      | `GovcloudMfe-Pipeline-<app>`                     |
| Per-app pipeline            | `govcloud-mfe-<app>`; stages `Deploy-<stage>`    |
| Release role (per app/stage)| `govcloud-mfe-<app>-<stage>-release`             |
| SSM: artifact bucket name   | `/govcloud-mfe/<stage>/assets-bucket-name`       |
| Alarm                       | `govcloud-mfe-<app>-<stage>-client-errors`       |
