# Contracts

This variant composes every module into **one build**, so most contracts between teams are
TypeScript types checked by the compiler on every pull request. The few contracts the compiler
can't check (between the frontend build, the release tooling, the Rust API and the
infrastructure) are written down here.

TypeScript definitions live in [`packages/contracts`](../packages/contracts/src/index.ts). The
Rust service mirrors the API types in
[`services/frontend-api/src/model.rs`](../services/frontend-api/src/model.rs).

## 1. Module descriptor: `modules/<name>/module.json`

One per team-owned module. The module's own code (`defineModule`), the infrastructure (which
module stacks and pipelines to create) and the ownership check (CODEOWNERS) all read it.

| Field         | Notes                                                                 |
| ------------- | --------------------------------------------------------------------- |
| `name`        | `^[a-z][a-z0-9]*$`. Package `@govcloud-mfe/<name>`, AppConfig app suffix, metric dimension. |
| `displayName` | Shown in navigation.                                                  |
| `route`       | Base path the app mounts the module at, e.g. `/dashboard`.            |
| `owner`       | Owning team slug, e.g. `team-insights`. Must match `.github/CODEOWNERS`. |

## 2. Module definition (compile-time)

Each module's package entry (`modules/<name>/src/index.ts`) default-exports
`defineModule({ ...descriptor, component })` from `@govcloud-mfe/platform-sdk`. `component` is a
`React.lazy` import of the module's root, so every module stays in its own chunk. The app's
composition list (`apps/web/src/modules.ts`) imports these definitions. That list, together
with `apps/web/package.json`, is the only place modules are wired in.

Rules, enforced by `turbo boundaries` and package `exports`:

- A module may depend on platform packages (`packages/*`) only. It can't depend on another
  module or on the app.
- Platform packages can't depend on modules or the app.
- Nothing may deep-import into a module. A module exports only its package entry.

## 3. Artifact bucket layout (one bucket per stage)

```
builds/<version>/**                 Immutable composed build. URL path == object key.
builds/<version>/.upload-complete   Written last by `release deploy`; marks the build as deployable.
builds/<version>/composition.json   Which module revisions are inside this build (§5).
releases/web.json                   The live release record (mutable pointer, bucket-versioned).
index.html                          Copy of builds/<live version>/index.html, served for every route.
```

- `<version>` is the first 12 characters of the git commit SHA.
- The build is compiled with `publicPath = /builds/<version>/`.
- Builds are never deleted by deploys or rollbacks.

## 4. Release record: `releases/web.json`

```jsonc
{
  "schemaVersion": 1,
  "version": "3f9c2a1b7d4e",
  "commit": "3f9c2a1b7d4e8a7f0c1d2e3f4a5b6c7d8e9f0a1b",
  "modules": [
    { "name": "dashboard", "owner": "team-insights", "revision": "a41c09e2d3b7" },
    { "name": "settings",  "owner": "team-accounts", "revision": "77f0b1c9e044" }
  ],
  "releasedAt": "2026-10-27T17:04:05.000Z",
  "releasedBy": "arn:aws-us-gov:sts::111111111111:assumed-role/govcloud-mfe-web-prod-release/..."
}
```

`modules` is copied from the build's `composition.json`. Comparing two records shows which
teams' code changed between releases, which tells whoever is rolling back whose change they
are about to undo.

## 5. Composition manifest: `builds/<version>/composition.json`

Emitted by the web build (`apps/web/build/composition-plugin.ts`):

```json
{
  "modules": [{ "name": "dashboard", "owner": "team-insights", "revision": "a41c09e2d3b7" }]
}
```

`revision` is a content hash (SHA-256, first 12 hex characters) of the module's source files.
Two builds share a revision exactly when that module's code is identical. It needs no git
metadata, so it works the same locally and in CI.

## 6. Frontend API (`services/frontend-api`, same origin, `/api/*`)

All routes except `/api/health` require a valid ALB `x-amzn-oidc-data` header. State-changing
requests that a browser marks as cross-site are rejected with 403.

| Method & path              | Response / body                                                                 |
| -------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/health`          | `{ "status": "ok" }`. ALB target health check, unauthenticated.                 |
| `GET /api/me`              | `CurrentUser` `{ sub, email?, name?, groups: string[] }`                         |
| `GET /api/feature-flags`   | `FeatureFlags` `{ [app]: { [flag]: { enabled: boolean, ...attributes } } }` for every app in `APPS`, evaluated for the caller. |
| `GET /api/preferences`     | `UserPreferences` `{ theme: "system"\|"light"\|"dark", density: "comfortable"\|"compact", pinnedModules: string[] }` |
| `PUT /api/preferences`     | Body and response: `UserPreferences`.                                           |
| `POST /api/client-events`  | Body `{ events: ClientEvent[] }` (max 20). `ClientEvent = { type: "module-load-failure"\|"render-error", app, version?, message }`. Returns `202`. Events for apps not in `APPS` are dropped. |
| `GET /api/auth/logout`     | Expires the ALB session cookie shards and redirects to the IdP logout URL.     |

There is no module registry endpoint: which modules exist is decided at build time.

## 7. Feature flags

- One AppConfig **application per app**: `govcloud-mfe-<app>` for `web` and for every module.
  One **environment per stage**. One `feature-flags` profile (`AWS.AppConfig.FeatureFlags`).
- Definitions live in `apps/web/feature-flags.json` and `modules/<name>/feature-flags.json`.
  Every module defines `moduleEnabled`, its kill switch.
- **A module's flags are deployed by that module's own flags pipeline**, never by the delivery
  pipeline, so one team's code deploy can't overwrite another team's flag values.
- Modules read their flags through typed hooks: `createModuleFlags<typeof import('../feature-flags.json')>('<name>')`.
  This is a type-only import, so flag keys are checked by the compiler and targeting rules
  never reach the browser bundle.
- The frontend API reads flags through the AppConfig Agent sidecar:
  `http://localhost:2772/applications/govcloud-mfe-<app>/environments/<stage>/configurations/feature-flags`,
  sending `Context: userId=<sub>` and `Context: email=<email>`. Locally it reads
  `<repo>/modules/<app>/feature-flags.json`, or `<repo>/apps/<app>/feature-flags.json` for `web`,
  and resolves each flag to its `values` entry. For multi-variant flags it uses the variant
  with no rule.

## 8. Client error metric

Each accepted client event becomes a CloudWatch Embedded Metric Format line on stdout:
namespace `GovcloudMfe/Frontend`, metric `ClientErrors` (Count), dimension `App` (`web` or a
module name).

- Each module's stack alarms on its own dimension (`govcloud-mfe-<module>-<stage>-client-errors`).
  That alarm is the AppConfig rollback monitor for the module's flags.
- The web stack alarms on `App=web`.
- The delivery pipeline's prod bake watches **all** of these alarms. Any of them firing rolls
  the whole release back, and the alarm's name says which team's module broke.

## 9. Frontend API configuration (environment variables)

| Variable                       | Example                                 | Notes                                            |
| ------------------------------ | --------------------------------------- | ------------------------------------------------ |
| `APP_ENV`                      | `aws` \| `local`                        | `local` switches the defaults below to local sources. |
| `PORT`                         | `8080`                                  |                                                  |
| `APPS`                         | `web,dashboard,settings`                | Apps whose flags are served and whose telemetry is accepted. Default locally: `web` plus every `modules/*` directory. |
| `AUTH_MODE`                    | `alb` \| `local-dev`                    | `local-dev` refuses to start unless `APP_ENV=local`. |
| `ALB_ARN`                      | `arn:aws-us-gov:elasticloadbalancing:...`| Expected `signer` of `x-amzn-oidc-data`.         |
| `AWS_REGION`                   | `us-gov-west-1`                         | Selects the ALB public-key endpoint.             |
| `SESSION_COOKIE_NAME`          | `govcloud-mfe-session`                  |                                                  |
| `LOGOUT_REDIRECT_URL`          | `https://idp.example.gov/logout?...`    |                                                  |
| `FLAGS_SOURCE`                 | `appconfig-agent` \| `local`            |                                                  |
| `APPCONFIG_AGENT_URL`          | `http://localhost:2772`                 |                                                  |
| `APPCONFIG_APPLICATION_PREFIX` | `govcloud-mfe-`                         |                                                  |
| `APPCONFIG_ENVIRONMENT`        | `prod`                                  |                                                  |
| `APPCONFIG_PROFILE`            | `feature-flags`                         |                                                  |
| `LOCAL_REPO_ROOT`              | `../..`                                 | Where local flag files are read from.            |
| `METRICS_NAMESPACE`            | `GovcloudMfe/Frontend`                  |                                                  |

The service has no AWS SDK dependency and no S3 access.

## 10. Naming

| Thing                               | Name                                         |
| ----------------------------------- | -------------------------------------------- |
| Platform stack                      | `GovcloudMfe-<stage>-Platform`               |
| Web stack (web flags, alarm, release role) | `GovcloudMfe-<stage>-Web`             |
| Module stack (module flags, alarm)  | `GovcloudMfe-<stage>-Module-<name>`          |
| Delivery + platform checks pipelines stack | `GovcloudMfe-Pipeline-Web`            |
| Module pipelines stack              | `GovcloudMfe-Pipeline-Module-<name>`         |
| Delivery pipeline                   | `govcloud-mfe-web`; stages `Deploy-<stage>`  |
| Platform PR checks pipeline         | `govcloud-mfe-web-checks`                    |
| Module PR checks pipeline           | `govcloud-mfe-<name>-checks`                 |
| Module flags pipeline               | `govcloud-mfe-<name>-flags`                  |
| Release role (stage account)        | `govcloud-mfe-web-<stage>-release`           |
| Delivery deploy role (tooling)      | `govcloud-mfe-web-pipeline-deploy`           |
| Module flags deploy role (tooling)  | `govcloud-mfe-<name>-flags-deploy`           |
| SSM: artifact bucket name           | `/govcloud-mfe/<stage>/assets-bucket-name`   |
| Alarm                               | `govcloud-mfe-<app>-<stage>-client-errors`   |
