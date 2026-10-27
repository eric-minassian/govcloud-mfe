# 0003 — Enforce module ownership with tooling, not convention

**Status:** accepted

## Context

When every module lives in one repository and one build, nothing technical stops a team from
importing another team's internals or editing another team's code. Any such shortcut couples
teams, and it accumulates silently.

## Decision

Make the boundaries machine-checked, and run every check in every pipeline:

| Rule | Mechanism |
| ---- | --------- |
| A team must approve every change to its module | `.github/CODEOWNERS`: `/modules/<name>/` → the module's team |
| Wiring modules into the app is a platform decision | CODEOWNERS on `apps/web/src/modules.ts` |
| Modules depend only on platform packages | `turbo boundaries`, tag `module` denies `module` and `app` |
| Platform packages never depend on modules or the app | `turbo boundaries`, tag `platform` denies `module` and `app` |
| No imports outside a package or of undeclared dependencies | `turbo boundaries` built-in checks |
| No deep imports into a module | Package `exports` exposes only `./src/index.ts` |
| `module.json`, CODEOWNERS and the composition agree | `pnpm check:ownership` (`tools/ownership/check.ts`) |
| Modules satisfy the platform contract | `defineModule(): ModuleDefinition`, checked by `tsc` |
| Modules only use flags they define | `createModuleFlags<typeof import('../feature-flags.json')>()` |

## Consequences

- Cross-module coordination goes through the platform: shared types in
  `packages/contracts`, shared data in the platform SDK's query cache, and navigation in the
  app. No module knows another exists.
- `turbo boundaries` is marked experimental by Turborepo. If it regresses, dependency-cruiser
  or ESLint's `no-restricted-imports` can enforce the same rules.
- GitHub only enforces CODEOWNERS reviews when branch protection requires them. That's a
  repository setting, not code.
