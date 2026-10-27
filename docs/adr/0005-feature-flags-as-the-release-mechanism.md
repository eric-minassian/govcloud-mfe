# 0005 — Feature flags are each team's release and rollback mechanism

**Status:** accepted

## Context

When every module deploys together, a deploy no longer means "my change is live". Teams need
another way to decide when users see their work, and to take it back, without the train.

## Decision

- **One AppConfig application per module** (`govcloud-mfe-<module>`), plus one for the app
  (`govcloud-mfe-web`), each with an environment per stage and a `feature-flags` profile.
  AppConfig allows one deployment per environment at a time, so separate applications keep teams
  off each other's deployment locks and rollback monitors.
- Each module's environment monitor is **that module's own** `ClientErrors` alarm. A flag change
  that breaks the module rolls itself back.
- **Only the module's flags pipeline deploys the module's stack.** If the delivery train
  deployed module stacks, every code merge would re-apply every team's flag file and reset
  whatever another team had just turned on or off.
- Every module defines **`moduleEnabled`**, a kill switch the app applies when building
  navigation and routes. It fails open: if flags can't be loaded, modules stay visible.
- Modules read flags through **typed hooks**. `createModuleFlags<typeof import('../feature-flags.json')>()`
  is a type-only import: flag keys are compile-time checked, and targeting rules (allow-lists,
  percentage splits) never reach the browser. Evaluation happens in the AppConfig Agent with the
  user's context.

## Consequences

- Teams ship code dark and release it with a flag. Removing a flag means removing the code
  first (train), then the definition (flags pipeline). An undefined flag reads as off, so either
  order is safe when adding.
- Flags are code. Flipping a flag in the AppConfig console works in an emergency, but the next
  run of that module's flags pipeline restores the file's value, so follow up with a PR.
- A module's flag deployments never wait on, or roll back, another team's.
