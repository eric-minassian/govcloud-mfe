# Runbook: deploying and rolling back a micro-frontend

Every app (the shell and each remote) has its own pipeline, `govcloud-mfe-<app>` (defined by
the `GovcloudMfe-Pipeline-<app>` stack).
Everything below applies to one app at a time. No step touches another team's module.

## Normal deploy

1. Merge to `main`. The pipeline triggers only if the change touches `apps/<app>/**` or shared
   code (`packages/**`, `tools/release/**`, `infra/**`, the lockfile).
2. **Build** typechecks, tests and builds with `RELEASE_VERSION=<12-char commit SHA>`, then
   synthesizes the app's stacks and bundles the release CLI into one artifact.
3. **Deploy dev** deploys `GovcloudMfe-dev-App-<app>` (flags, alarm, release role) and runs
   `release deploy`.
4. **Approve** promotion to prod.
5. **Deploy prod** does the same against prod. The stage's Bake action then watches
   `govcloud-mfe-<app>-prod-client-errors` for 10 minutes.

To see what is live:

```sh
pnpm release status --app dashboard --stage prod
```

## Automatic rollbacks (no action needed)

| What happened                                   | What rolls back                      | How                                   |
| ----------------------------------------------- | ------------------------------------ | ------------------------------------- |
| A deploy stage failed                           | That stage, to the last good release | CodePipeline `onFailure: ROLLBACK`    |
| The client-errors alarm fired during prod bake  | The prod stage                       | Bake action fails → `onFailure: ROLLBACK` |
| The alarm fired during a flag deployment        | The flag deployment                  | AppConfig environment monitor         |
| A platform container failed health checks       | The ECS service                      | Deployment circuit breaker            |

A stage rollback re-runs the stage with the previous good artifact. The app stack goes back to
the previous flag definitions, and `release deploy` skips the upload (the version is already
published) and moves the pointer back.

## Manual rollback

Choose the least drastic option that fixes the problem.

### 1. Hide the module (seconds, remotes only)

Turn off the module's `moduleEnabled` flag in AppConfig (application `govcloud-mfe-<app>`,
environment `prod`, profile `feature-flags`) and deploy it with the `AllAtOnce` strategy. Within
about a minute the module disappears from navigation and its routes return "not found". Nothing
else changes.

### 2. Roll back through the pipeline (preferred)

```sh
aws codepipeline list-pipeline-executions --pipeline-name govcloud-mfe-dashboard \
  --query 'pipelineExecutionSummaries[?status==`Succeeded`].[pipelineExecutionId,sourceRevisions[0].revisionId]'

aws codepipeline rollback-stage \
  --pipeline-name govcloud-mfe-dashboard \
  --stage-name Deploy-prod \
  --target-pipeline-execution-id <execution id>
```

This keeps the pipeline's view of what is deployed accurate. It also reverts the app's flag
definitions and alarm along with the code.

### 3. Break-glass pointer swap (seconds, no pipeline)

Use this when the pipeline itself is unavailable:

```sh
# Assumes credentials that can assume the app's release role in the prod account.
pnpm release rollback --app dashboard --stage prod \
  --role-arn arn:aws-us-gov:iam::<prod account>:role/govcloud-mfe-dashboard-prod-release
# or to a specific version:
pnpm release rollback --app dashboard --stage prod --to 1a2b3c4d5e6f --role-arn ...
```

Afterwards, **disable the pipeline's transition into Deploy-prod** until a fix is merged.
Otherwise the next execution re-releases the bad version:

```sh
aws codepipeline disable-stage-transition --pipeline-name govcloud-mfe-dashboard \
  --stage-name Deploy-prod --transition-type Inbound --reason "Rolled back <version>, see <ticket>"
```

### What users see after a rollback

- New page loads get the rolled-back version as soon as the frontend API's release cache
  refreshes (a few seconds). For the shell, it's the next `index.html` revalidation, which happens
  on every load.
- Open tabs keep running the version they loaded until they reload. Its files are still in S3.

## Adding a new module

1. Copy `apps/dashboard` to `apps/<name>` and edit `microfrontend.json` (`name`, `route`,
   `displayName`, `owner`, `devPort`) and `feature-flags.json`. Keep the `moduleEnabled` flag.
2. Add a `dev/releases/<name>.json` record for local development.
3. Deploy its pipeline: `pnpm --filter @govcloud-mfe/infra cdk deploy GovcloudMfe-Pipeline-<name>`.
   The CDK app discovers apps from `apps/*/microfrontend.json`.
4. Merge. The new pipeline deploys the module's stack and first release, and the shell picks it
   up from `/api/modules` without being redeployed.
