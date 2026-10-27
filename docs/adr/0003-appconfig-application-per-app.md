# 0003 — One AppConfig application per micro-frontend

**Status:** accepted

## Context

Teams need feature flags they control without waiting on, or being rolled back by, other
teams. AppConfig allows **only one deployment per environment at a time**, and a deployment
with a bake period holds that lock for minutes. An environment's monitors roll back whatever
deployment is in progress.

## Decision

- Each app gets its own AppConfig **application** `govcloud-mfe-<app>`, with one **environment**
  per stage and one `feature-flags` profile (`AWS.AppConfig.FeatureFlags`).
- The environment's **monitor** is the app's own `ClientErrors` alarm.
- Flag definitions live in the app's folder (`feature-flags.json`) and are deployed by the app's
  own stack in its own pipeline.
- The frontend API reads flags through the **AppConfig Agent** sidecar, which handles polling,
  caching and multi-variant evaluation, and passes the user's `userId` and `email` as context.
- Each remote has a `moduleEnabled` kill switch, which the API applies to `/api/modules`.

## Consequences

- Teams' flag deployments never conflict, and a bad flag rolls back only that team's change.
- Least privilege is simple: a pipeline's permissions are scoped to one AppConfig application.
- The API fans out one agent call per app per request. The agent answers from memory, so the
  cost is negligible at this scale.
- The agent image must be mirrored to private ECR in GovCloud.

## Alternatives considered

- **One shared application with a profile per app.** Teams would serialise on the
  per-environment lock, and one team's alarm could roll back another team's deployment.
- **Evaluating flags in the browser.** This exposes targeting rules and needs an AppConfig data
  path from the browser, which the ALB-only design deliberately avoids.
