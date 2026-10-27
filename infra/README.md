# infra

AWS CDK app for the build-time-composition variant: the shared platform, the composed web app's
runtime resources, each team module's runtime resources, and the pipelines that ship them.
Interfaces with the rest of the repo are in [docs/contracts.md](../docs/contracts.md).

The shape follows from one fact: **all modules are compiled into one build**. Code therefore
ships on a single delivery pipeline (the "train"). What each team still owns, deploys and rolls
back on its own is its pull-request gate and its feature flags.

## Stacks

| Stack                                | Account | Owner         | Deployed by                     | Contents |
| ------------------------------------ | ------- | ------------- | ------------------------------- | -------- |
| `GovcloudMfe-<stage>-Platform`       | stage   | platform team | `cdk deploy` (platform team)    | VPC (isolated subnets + VPC endpoints, no NAT), artifact bucket, ALB with OIDC on every rule, ECS services for nginx (`edge`) and the Rust `frontend-api` + AppConfig Agent sidecar. |
| `GovcloudMfe-<stage>-Web`            | stage   | platform team | delivery pipeline               | `govcloud-mfe-web` AppConfig application (web app flags), the `web` client-error alarm, and the release role the pipeline uses to publish, promote, roll back and bake. |
| `GovcloudMfe-<stage>-Module-<name>`  | stage   | module team   | that module's flags pipeline    | `govcloud-mfe-<name>` AppConfig application (incl. the `moduleEnabled` kill switch) and the module's client-error alarm, which is also its AppConfig rollback monitor. |
| `GovcloudMfe-Pipeline-Web`           | tooling | platform team | `cdk deploy` (once)             | Delivery pipeline and platform PR checks pipeline. |
| `GovcloudMfe-Pipeline-Module-<name>` | tooling | module team   | `cdk deploy` (once per module)  | The module's PR checks pipeline and flags pipeline. |

Modules are discovered from `modules/*/module.json`. Adding a module folder adds its stacks and
pipelines; redeploy the platform stack so the frontend-api's `APPS` list includes it.

## Pipelines

| Pipeline                       | Owner         | Triggered by                                                                 | Does |
| ------------------------------ | ------------- | ---------------------------------------------------------------------------- | ---- |
| `govcloud-mfe-web` (delivery)  | platform team | push to `main` touching `apps/web/**`, `modules/**`, `packages/**`, `tools/release/**`, `infra/**`, lockfile/workspace/turbo config — **excluding** `modules/*/feature-flags.json` | Build once (lint incl. `turbo boundaries` and ownership check, typecheck, test, build) → Deploy-dev → Approve-prod → Deploy-prod → Bake (every app's alarm, 10 min). Deploy = `GovcloudMfe-<stage>-Web` + `release deploy`. |
| `govcloud-mfe-web-checks`      | platform team | pull request into `main` touching `apps/web/**`, `packages/**`, `tools/**`, `infra/**` | Lint, typecheck/test/build of the web app and everything it depends on, plus infra tests. |
| `govcloud-mfe-<name>-checks`   | module team   | pull request into `main` touching `modules/<name>/**`                        | Lint, the module's own typecheck and tests, and a full web build (the change must still compose). |
| `govcloud-mfe-<name>-flags`    | module team   | push to `main` touching `modules/<name>/feature-flags.json` or `module.json` (or the module stack definition) | Synth only that module's stacks → Deploy-dev → Approve-prod → Deploy-prod. AppConfig's gradual rollout and alarm monitor are the bake and the rollback. |

Checks pipelines run in `PARALLEL` execution mode (pull requests are independent). CodePipeline
doesn't post commit statuses to GitHub; making them required checks needs an EventBridge rule on
execution state changes and a small Lambda that calls the GitHub statuses API (not included).

### Why module flags never ride the train

The delivery pipeline runs for every team's merges. If it also deployed module stacks, a merge by
team A would redeploy team B's `feature-flags.json` as it stood in that commit, overwriting
whatever team B had just rolled out (or rolled back). So the delivery trigger excludes
`modules/*/feature-flags.json`, its synth (`-c target=web`) contains only WebStacks, and module
stacks are deployed exclusively by their own flags pipeline.

### Rollback

- **A release fails or bakes badly**: the stage's `onFailure: ROLLBACK` re-runs it with the last
  good bundle (previous WebStack, previous build — still in S3, so it's a pointer swap). This
  undoes *every* module's changes in that release; the bake log names the module and team whose
  alarm fired. Manual: `aws codepipeline rollback-stage --pipeline-name govcloud-mfe-web --stage-name Deploy-prod --target-pipeline-execution-id <id>`,
  or break-glass `pnpm release rollback --stage prod`.
- **One module misbehaves**: its team turns off `moduleEnabled` (or the offending flag). AppConfig
  also reverts a bad flag rollout by itself when the module's alarm fires.
- **Platform containers**: the ECS deployment circuit breaker rolls the service back.

## Layout

```
bin/app.ts                     stages × (platform, web, modules) + pipelines; `-c target=` selects a subset
lib/config.ts                  typed config, read from the `govcloud-mfe` context in cdk.json
lib/naming.ts                  names shared with the CLI, frontend-api and docs (contracts §10)
lib/paths.ts                   repo paths and module discovery
lib/platform-stack.ts          shared infra + the ALB routing table
lib/web-stack.ts               web flags, web alarm, release role
lib/module-stack.ts            one module's flags and alarm
lib/web-pipeline-stack.ts      delivery pipeline + platform checks
lib/module-pipeline-stack.ts   one module's checks + flags pipelines
lib/pipelines/                 buildspecs, the reusable ChecksPipeline, shared pipeline helpers
lib/constructs/                runtime constructs (bucket, ALB, services, FeatureFlagsApp, release role)
```

`-c target=web` synthesizes only the WebStacks (delivery pipeline bundle);
`-c target=module:<name>` only that module's ModuleStacks (its flags pipeline bundle); no target
synthesizes everything.

## Deploying

Prerequisites per stage account: an ACM certificate, the OIDC client secret in Secrets Manager,
and a private ECR mirror of `public.ecr.aws/aws-appconfig/aws-appconfig-agent` (tasks have no
internet access). In the tooling account: an activated CodeConnections connection. Put the real
values in the CDK context, replacing the placeholders in `cdk.json`.

```sh
# Once per account. Stage accounts trust the tooling account, so pipelines can deploy stacks.
pnpm cdk bootstrap aws://<tooling-account>/us-gov-east-1
pnpm cdk bootstrap aws://<stage-account>/us-gov-west-1 --trust <tooling-account> \
  --cloudformation-execution-policies arn:aws-us-gov:iam::aws:policy/AdministratorAccess

# 1. Platform, per stage (platform team).
pnpm cdk deploy GovcloudMfe-dev-Platform GovcloudMfe-prod-Platform

# 2. Pipelines. Each module's flags pipeline then creates its ModuleStacks on its first run, and the
#    delivery pipeline creates the WebStacks and the first release.
pnpm cdk deploy GovcloudMfe-Pipeline-Web 'GovcloudMfe-Pipeline-Module-*'
```

Order matters only loosely: the bake treats a module alarm that doesn't exist yet as healthy, so a
release can go out before a brand-new module's flags pipeline has run (its `moduleEnabled` flag
then reads as missing, which the app treats as enabled).

Use a narrower policy than `AdministratorAccess` for `--cloudformation-execution-policies` outside
a proof of concept. Module flags pipelines deploy through the same bootstrap roles; in production,
give each team its own bootstrap qualifier or a permissions boundary.

## GovCloud notes

- **CodeConnections exists only in us-gov-east-1**, so the tooling account and pipelines default to
  that region. Deploy steps reach us-gov-west-1 with ordinary API calls; CodePipeline's own
  cross-region actions aren't available in GovCloud. That's also why the bake polls alarms itself
  instead of using CodePipeline's `CloudWatchAlarm` rule, which runs in the pipeline's account and
  region.
- **No CodeArtifact in GovCloud**: modules are composed from source in the monorepo rather than
  published as versioned packages, so no registry is needed.
- **No CloudFront**: nginx on Fargate reads the bucket through the S3 gateway endpoint. The bucket
  uses SSE-S3 because anonymous reads, even through a VPC endpoint, can't decrypt SSE-KMS objects.
- **ALB public keys** for verifying `x-amzn-oidc-data` are served from S3 in GovCloud
  (`s3-us-gov-west-1.amazonaws.com/aws-elb-public-keys-prod-us-gov-west-1/<kid>`), so the
  frontend-api reaches them through the same gateway endpoint.
- ARNs are built from `Aws.PARTITION` / `Stack.formatArn`, never `arn:aws:`.
- The HTTPS listener uses a FIPS TLS policy (`ELBSecurityPolicy-TLS13-1-2-Res-FIPS-2023-04`).

## Checks

```sh
pnpm typecheck   # tsc
pnpm test        # vitest + aws-cdk-lib/assertions
pnpm synth       # offline; no AWS credentials needed
```
