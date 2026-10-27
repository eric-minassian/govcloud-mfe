# Runbook: shipping, releasing and rolling back (build-time variant)

Two separate things happen here:

- **Code ships on the delivery train.** Every merge to `main` that touches app or module code
  runs `govcloud-mfe-web`, which deploys the whole composed app.
- **Features are released with flags.** Each team turns its own features on and off through its
  module's AppConfig application, deployed by its own `govcloud-mfe-<module>-flags` pipeline.

## Shipping code (any team)

1. Open a PR. Your module's checks pipeline (`govcloud-mfe-<module>-checks`) runs lint, `turbo
   boundaries`, the ownership check and your module's tests, and builds the composed app.
   CODEOWNERS requires your team's review, plus the platform team's if you touched anything
   outside your module.
2. Merge. The train builds once, deploys dev, waits for approval, deploys prod, then bakes for 10
   minutes watching every module's alarm.
3. New behaviour should be behind a flag that defaults to off, so shipping it changes nothing for
   users.

To see what is live and what each release changed:

```sh
pnpm release status --stage prod
# version       releasedAt   changed
# ▶ 3f9c2a1b7d4e  ...          dashboard (team-insights)
#   1a2b3c4d5e6f  ...          settings (team-accounts), dashboard (team-insights)
```

## Releasing a feature (module team)

1. Change the value in `modules/<module>/feature-flags.json`. Use a variant with a rule for a
   percentage rollout or an allow-list.
2. Merge. Your flags pipeline deploys your module's stack to dev, then prod after approval.
   AppConfig rolls the change out with your module's deployment strategy (gradual in prod) and
   **reverts it automatically** if your module's `ClientErrors` alarm fires.

No other team's pipeline runs, and no code is deployed.

## Automatic rollbacks (no action needed)

| What happened | What rolls back | How |
| ------------- | --------------- | --- |
| A train deploy stage failed | That stage, to the previous build | CodePipeline `onFailure: ROLLBACK` |
| Any module's (or the web) alarm fired during the prod bake | The prod stage, to the previous build | Bake action fails, stage rolls back. The log names the module and owning team |
| A module's alarm fired during its flag rollout | That module's flag deployment | AppConfig environment monitor |
| A platform container failed health checks | The ECS service | Deployment circuit breaker |

## Manual rollback: choose the smallest option that works

### 1. Turn the feature off (seconds, module team)

Turn the flag off in your module's AppConfig application (`govcloud-mfe-<module>`, environment
`prod`, profile `feature-flags`), or merge the change to `feature-flags.json`. A console change
is overwritten by your next flags pipeline run, so follow up with a PR.

### 2. Hide the module (seconds, module team or platform on-call)

Turn `moduleEnabled` off for the module. Within about a minute it disappears from navigation and
its routes show "not found". Everything else keeps working.

### 3. Roll back the whole app (seconds, platform on-call)

Preferred, through the pipeline:

```sh
aws codepipeline rollback-stage --pipeline-name govcloud-mfe-web \
  --stage-name Deploy-prod --target-pipeline-execution-id <last good execution id>
```

Break-glass, when the pipeline itself is unavailable:

```sh
pnpm release rollback --stage prod \
  --role-arn arn:aws-us-gov:iam::<prod account>:role/govcloud-mfe-web-prod-release
# [web/prod] Rolling back 3f9c2a1b7d4e → 1a2b3c4d5e6f
# [web/prod] Reverts: dashboard (team-insights)
```

This reverts **every** module to the target build. The output says whose changes are undone.
Tell those teams, and pause the train (`aws codepipeline disable-stage-transition
--pipeline-name govcloud-mfe-web --stage-name Deploy-prod --transition-type Inbound --reason
"..."`) until the fix is merged.

### 4. Take back one team's change, keep everyone else's (minutes)

`git revert` the offending merge and merge the revert. The train ships it like any other change.
If the whole app was rolled back in step 3, this is how the other teams' changes get back to
production.

## Adding a module

1. Create `modules/<name>/` (copy `modules/settings`): `module.json` (`name`, `displayName`,
   `route`, `owner`), `feature-flags.json` with `moduleEnabled`, `package.json` named
   `@govcloud-mfe/<name>`, and `turbo.json` tagged `module`.
2. Add `/modules/<name>/ @example-agency/<owner>` to `.github/CODEOWNERS`.
3. In one platform-reviewed PR, add the package to `apps/web/package.json` and the import to
   `apps/web/src/modules.ts`. `pnpm check:ownership` fails until all three agree.
4. Deploy the module's pipelines (`cdk deploy GovcloudMfe-Pipeline-Module-<name>`) and redeploy
   the platform stack so the frontend API's `APPS` includes the module. The module's flags
   pipeline then creates its AppConfig application and alarm, and the train ships its code.
