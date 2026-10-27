# 0001 — Compose modules at build time, from source, in one repository

**Status:** accepted (for this variant; `main` uses runtime composition with Module Federation)

## Context

Several teams each own a part of the UI. We want to know what the platform looks like if those
parts are composed when the app is **built**, not when it runs in the browser.

There are two established ways to compose at build time:

1. **Versioned packages.** Each module is published to a package registry, and the app pins a
   version of each. This is the textbook "build-time integration" ([Fowler, *Micro
   Frontends*](https://martinfowler.com/articles/micro-frontends.html)). Teams release on their
   own cadence, and rolling one module back means re-pinning it and rebuilding the app.
2. **Source packages in one repository.** Modules are workspace packages that the app compiles
   directly. There's one version of everything: whatever is on `main`.

Things that shaped the choice:

- **AWS CodeArtifact isn't available in GovCloud.** Its endpoints don't resolve in
  `us-gov-west-1` or `us-gov-east-1`, and it isn't in the `aws-us-gov` partition. Option 1 would
  mean running and accrediting a self-hosted registry (Verdaccio, Nexus) inside the boundary,
  or inventing one on S3.
- Even with versioned packages, build-time composition still produces **one deployable**. Every
  module release still means rebuilding and redeploying the whole app. Fowler calls this the
  "lockstep release process". Versioned packages buy release *cadence*, not deploy independence.
- Versioned packages bring well-known costs: version-bump churn, modules compiled against
  different versions of the platform SDK, and integration problems found late, at app build
  time, rather than in the module's own PR.
- If a team needs truly independent deploys, runtime composition (the `main` branch) is the tool
  built for that. This variant shouldn't imitate it badly.

## Decision

Option 2: **source packages in one repository**, with team autonomy recovered by other means.

- `modules/<name>/` is a library package per team. It default-exports a `defineModule(...)`
  definition with a lazy root component.
- `apps/web` imports the definitions in one composition list and compiles everything into one
  build. Each module still gets its own lazily loaded, named chunk.
- Autonomy comes from enforced ownership ([0003](0003-enforced-module-ownership.md)), per-team
  checks and flag pipelines ([0004](0004-delivery-train-and-team-pipelines.md)), and feature
  flags as the release mechanism ([0005](0005-feature-flags-as-the-release-mechanism.md)).

## Consequences

- Contracts between modules and the platform are TypeScript types, checked on every PR. A
  breaking platform change and the fixes to every affected module land in one atomic PR, which
  each affected team must approve.
- There's one copy of every dependency, fully tree-shaken. There are no shared-singleton version
  ranges, no async bootstrap boundary and no remote manifests. For the same user journey this
  variant transfers 100 kB gzipped against 253 kB for the MF variant
  ([measurements](../comparison-with-module-federation.md#what-the-user-downloads)).
- Every merge ships every module. Teams work trunk-based behind flags, and a broken module
  blocks the train until it's reverted or fixed. Mitigations: the per-module PR gate builds the
  composed app, the prod bake watches every module's alarm, and kill switches exist.
- Rolling back one module's *code* takes a revert and a pipeline run. Only whole-app rollback
  is instant.
- Build time grows with the number of modules. Turborepo caching keeps checks incremental. The
  app build itself is fast (Rsbuild), but this is the scaling limit to watch.

## When to switch to runtime composition

- Teams need to ship on different days without coordinating through `main`.
- Modules are built from different repositories or by different organizations.
- One team's broken build regularly blocks others, despite the gates.
