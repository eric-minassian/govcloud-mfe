# 0004 — One delivery train, plus checks and flags pipelines per team

**Status:** accepted

## Context

There's one deployable, so there's one place it can be deployed from. Teams still need their
own feedback loop, and their own way to control what users see without waiting on the train.

## Decision

| Pipeline | Owner | Trigger | Does |
| -------- | ----- | ------- | ---- |
| `govcloud-mfe-web`, the delivery train | platform | Push to `main` touching app, module code, packages, tools, infra or the lockfile, but **not** `modules/*/feature-flags.json` | Build once, deploy dev, approve, deploy prod, bake on every module's alarm, roll back the stage on failure |
| `govcloud-mfe-web-checks` | platform | PRs touching `apps/web`, `packages`, `tools`, `infra` | Lint, boundaries, ownership, typecheck, tests, build |
| `govcloud-mfe-<module>-checks` | module team | PRs touching `modules/<module>/**` | Lint, boundaries, ownership, the module's typecheck and tests, **and a build of the composed app** |
| `govcloud-mfe-<module>-flags` | module team | Push to `main` touching `modules/<module>/feature-flags.json` | Deploy the module's stack (AppConfig flags and alarm) to dev, approve, prod |

- All are CodePipeline V2, with path-filtered triggers. PR triggers use `PARALLEL` execution so
  PRs don't queue behind each other.
- The train's prod **bake** assumes the release role and polls every `ClientErrors` alarm in the
  stage (web plus each module) for 10 minutes. Any alarm fails the action, and `onFailure:
  ROLLBACK` restores the previous build. The log names the module and owning team.
- Build once: the train packages the build, its synthesized web stacks and the bundled release
  CLI into one artifact, and every stage deploys that same artifact.

## Consequences

- A team's flag change reaches production on its own schedule, without a code deploy.
- Every team's code reaches production on the train's schedule. Fast, small merges keep the
  train short. `SUPERSEDED` execution batches merges that arrive during a run.
- One team's broken change can roll back a release that also contained others' work. The bake
  names who caused it, and the others' changes re-ship on the next run after a revert.
- CodePipeline doesn't post commit statuses to GitHub. To make the checks pipelines *required*
  PR checks, forward pipeline execution events (EventBridge) to the GitHub statuses API. This is
  not implemented here.
- CodeConnections exists only in GovCloud (US-East), so the tooling account defaults there (see
  [govcloud.md](../govcloud.md)).
