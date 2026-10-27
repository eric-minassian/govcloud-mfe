# infra

AWS CDK app for the platform, each app's runtime resources, and each app's pipeline. Interfaces
with the rest of the repo are in [docs/contracts.md](../docs/contracts.md).

## Stacks

| Stack                           | Account | Owner         | Contents                                                                                                                                                                             |
| ------------------------------- | ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GovcloudMfe-<stage>-Platform`  | stage   | platform team | VPC (isolated subnets + VPC endpoints, no NAT), artifact bucket, ALB with OIDC on every rule, ECS services for nginx (`edge`) and the Rust `frontend-api` + AppConfig Agent sidecar. |
| `GovcloudMfe-<stage>-App-<app>` | stage   | app team      | The app's AppConfig application, flags and deployment strategy; its client-error alarm; its release role. Deployed **by the app's pipeline**.                                        |
| `GovcloudMfe-Pipeline-<app>`    | tooling | app team      | CodePipeline V2: Source → Build → Deploy-dev → Approve-prod → Deploy-prod (deploy, bake).                                                                                            |

Apps are discovered from `apps/*/microfrontend.json`. Adding a folder adds its stacks and pipeline.

```
bin/app.ts                         wires stages × apps together
lib/config.ts                      typed config, read from the `govcloud-mfe` context in cdk.json
lib/naming.ts                      names shared with the CLI and frontend-api (contracts §8)
lib/platform-stack.ts              shared infra + the ALB routing table
lib/app-stack.ts                   per-app runtime resources
lib/pipeline-stack.ts              per-app pipeline
lib/buildspecs.ts                  what each pipeline step runs
lib/constructs/                    one construct per concern (bucket, ALB, services, flags, release role)
```

## How a release and a rollback work

1. **Build** (once): test and build the app with `publicPath=/apps/<app>/<sha12>/`, synthesize
   only that app's stacks (`cdk synth -c app=<app>`), and package a self-contained release bundle.
2. **Deploy-\<stage\>**: `cdk deploy` the app's AppStack. The bundled release CLI then assumes the
   release role, uploads the build to `apps/<app>/<sha12>/` (skipped if it's already there), and
   rewrites `releases/<app>.json`.
3. **Bake** (production only): watch the app's `ClientErrors` alarm for 10 minutes.
4. **Rollback**: if any action in a deploy stage fails, including the bake, the stage's
   `onFailure: ROLLBACK` condition re-runs it with the last successful execution's bundle. That
   brings back the previous AppStack and the previous version. Old builds are never deleted, so this
   is a pointer swap. Flag changes have their own safety net: the same alarm is the AppConfig
   environment monitor, so AppConfig reverts a bad flag rollout by itself.

Manual options: `aws codepipeline rollback-stage --pipeline-name govcloud-mfe-<app> --stage-name Deploy-prod --target-pipeline-execution-id <id>`,
or break-glass `pnpm release rollback --app <app> --stage prod` (see `tools/release`).

## Deploying

Prerequisites per stage account: an ACM certificate, the OIDC client secret in Secrets Manager,
and a private ECR mirror of `public.ecr.aws/aws-appconfig/aws-appconfig-agent` (tasks have no
internet access). In the tooling account: an activated CodeConnections connection. Put the real
values in the CDK context, replacing the placeholders in `cdk.json`.

```sh
# Once per account. Stage accounts trust the tooling account, so pipelines can deploy app stacks.
pnpm cdk bootstrap aws://<tooling-account>/us-gov-east-1
pnpm cdk bootstrap aws://<stage-account>/us-gov-west-1 --trust <tooling-account> \
  --cloudformation-execution-policies arn:aws-us-gov:iam::aws:policy/AdministratorAccess

# 1. Platform, per stage (platform team; later its own pipeline).
pnpm cdk deploy GovcloudMfe-dev-Platform GovcloudMfe-prod-Platform

# 2. One pipeline per app. Each pipeline then deploys its own App stacks and releases.
pnpm cdk deploy 'GovcloudMfe-Pipeline-*'
```

Use a narrower policy than `AdministratorAccess` for `--cloudformation-execution-policies` outside
a proof of concept.

## GovCloud notes

- **CodeConnections exists only in us-gov-east-1**, so the tooling account and pipelines default
  to that region. Deploy steps reach us-gov-west-1 with ordinary API calls. CodePipeline's own
  cross-region actions aren't available in GovCloud. That's also why the bake step polls the
  alarm itself instead of using CodePipeline's `CloudWatchAlarm` stage-condition rule, which runs
  in the pipeline's account and region.
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
