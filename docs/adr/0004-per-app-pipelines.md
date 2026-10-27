# 0004 — One CodePipeline per app with alarm-gated stage rollback

**Status:** accepted

## Context

Each module must have its own pipeline and be able to deploy and roll back on its own. Delivery
should stay inside the GovCloud boundary.

## Decision

- One **CodePipeline V2** per app, defined in CDK (`PipelineStack`), with a trigger
  **filtered by file path** (`apps/<app>/**`, shared packages, tooling, lockfile). A change
  to the dashboard runs only the dashboard's pipeline.
- **Build once.** The build stage produces a release bundle (assets, the app's synthesized CDK
  stacks, the bundled release CLI), and every stage deploys that same bundle.
- Each deploy stage deploys the app's own stack, then runs `release deploy` under the app's
  release role.
- **Automated rollback, provided by CodePipeline itself:** every deploy stage has
  `onFailure: ROLLBACK`.
- **Bake.** The prod stage ends with a Bake action. It assumes the app's release role and
  watches the app's `ClientErrors` alarm for 10 minutes. If the alarm fires, the action fails,
  and the failure rolls the stage back.
- Stage rollback re-runs the deploy actions with the previous successful execution's
  artifacts. Because `release publish` is idempotent, that comes down to swapping the pointer
  back.

## Consequences

- Rollback works the same way in every app. The only custom code is the short bake loop.
- **Why not CodePipeline's `CloudWatchAlarm` stage-condition rule?** Rules run as the pipeline
  role, in the pipeline's account and region. The prod alarm is in the prod account, and usually
  in another region (see below). GovCloud CodePipeline has no cross-region actions. The bake
  action can assume a role in the prod account, so it can read the alarm.
- **CodeConnections is only available in GovCloud (US-East)**, so the tooling account's
  pipelines default to `us-gov-east-1`. Workloads can stay in `us-gov-west-1`: the deploy steps
  are CodeBuild jobs that call AWS APIs in the stage's region. If you can't use US-East, use an
  S3 or CodeCommit source in US-West. The source action is isolated in one place in
  `PipelineStack`.
- The pipeline stacks themselves are deployed manually (or by a platform pipeline). The pipelines
  don't self-mutate.

## Alternatives considered

- **CDK Pipelines (`pipelines.CodePipeline`).** It's convenient, but it hides the stage
  conditions this design relies on.
- **GitHub Actions / GitLab CI.** These are equally valid if the organisation allows them. The
  release CLI keeps the deploy logic CI-agnostic. Only the stage-rollback features are
  CodePipeline-specific.
