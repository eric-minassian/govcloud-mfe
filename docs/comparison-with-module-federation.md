# Build-time composition vs Module Federation

Two branches implement the same product, same GovCloud platform (ALB + OIDC, nginx + S3,
Rust API, AppConfig, CDK) and the same team ownership. They differ in **when modules are put
together**:

- `main` composes at **runtime** with Module Federation. The shell discovers remotes from
  `/api/modules` and loads each remote's `mf-manifest.json` in the browser.
- `build-time-composition` (this branch) composes at **build time**. Modules are packages
  compiled into one app.

## At a glance

| | Module Federation (`main`) | Build-time (this branch) |
| --- | --- | --- |
| Deployables | One per app: shell and each remote | One: the composed app |
| A team ships its code | Whenever its own pipeline runs | When any merge runs the shared train |
| Roll back one module's code | Seconds (pointer swap of that module's release record) | Minutes (revert commit plus a train run) |
| Roll back everything | Per module, one at a time | Seconds (pointer swap of `index.html`) |
| Turn a module off | `moduleEnabled` flag (kill switch) | Same |
| Release a feature | Flag in the module's own AppConfig app | Same, and flags are the *primary* release lever |
| Contracts between teams | Runtime: shared-singleton version ranges, an exposed-module convention, types in a shared package | Compile time: `ModuleDefinition`, typed flags, all checked on every PR |
| Platform-wide breaking change | Coordinated: shell first, then each remote rebuilds | One atomic PR that updates every affected module (owners approve) |
| Dependency versions | Must agree at runtime (singletons, `requiredVersion`) | One copy, by construction |
| Ownership enforcement | Separate pipelines and roles: a team's role can only write its prefix | CODEOWNERS, `turbo boundaries`, package `exports`, ownership check |
| Per-team pipelines | Build, deploy and roll back its own app and flags | PR checks (including composed-app build) and flags deploy |
| Frontend API | Also serves the module registry (reads S3) | No registry, no S3 access, no AWS SDK |
| S3 layout | `apps/<app>/<version>/`, `releases/<app>.json` | `builds/<version>/`, `releases/web.json` |
| Local development | Shell, each remote's dev server and the API | One dev server and the API |
| Moving parts unique to the variant | MF runtime, shared-scope negotiation, remote discovery, per-remote release roles | Composition plugin (module revisions), ownership check |

## What the user downloads

Measured with headless Chromium against production builds of both branches, served the same
way. The journey: load the home page, open Dashboard, open Settings. Sizes are JS and CSS only;
API calls and the HTML document are excluded.

| | Module Federation | Build-time |
| --- | --- | --- |
| First load (home) | 11 requests, 589 kB raw / **182 kB gzip** | 5 requests, 300 kB raw / **97 kB gzip** |
| Open Dashboard | 4 requests, 128 kB raw / 35 kB gzip | 2 requests, 3 kB raw / 1 kB gzip |
| Open Settings | 4 requests, 128 kB raw / 36 kB gzip | 2 requests, 4 kB raw / 2 kB gzip |
| **Whole journey** | 19 requests, **253 kB gzip** | 9 requests, **100 kB gzip** |

Why the difference:

- **Shared dependencies aren't tree-shaken by default.** A federated singleton has to contain
  every export any remote might use, so the shell ships complete copies of React DOM, the router
  and TanStack Query. Module Federation 2.x has an opt-in shared tree-shaking mode, which `main`
  doesn't use. The build-time bundler sees every import and drops what's unused.
- **Each remote carries the Module Federation runtime.** Opening a remote downloads its
  `remoteEntry.js` (about 120 kB raw), even though the shell already has the runtime. In the
  build-time variant, opening a module downloads only that module's own code.

Both variants code-split per module, and both serve everything immutable and same-origin, so
repeat visits are cache hits in either case.

## Choosing

Choose **build-time composition** when:

- teams work in one repository and can agree on trunk-based development behind flags,
- "my change is live in production within the hour, on the shared train" is acceptable,
- you value compile-time safety, atomic cross-cutting changes and the smallest bundle, and
- you'd rather not run runtime-composition machinery inside the GovCloud boundary.

Choose **Module Federation** when:

- teams must deploy and roll back their code on their own schedule, without coordinating
  through `main`,
- modules come from different repositories, vendors or release cadences, or
- one team's broken build regularly blocking everyone else is unacceptable.

A common path is to start with build-time composition and move a module to runtime composition
only when its team needs that independence. Here the module contract (`defineModule` with a
lazy root component) maps directly onto a federated `./App` expose.

## What it took to get from one to the other

- `apps/shell` became `apps/web`. It has no async bootstrap boundary, no `registerRemotes` or
  `loadRemote`, and it builds routes from a compile-time composition list instead of
  `/api/modules`.
- Remotes became library packages under `modules/` (`defineModule`, lazy root, typed flags,
  tests with `renderWithPlatform`). They have no dev servers or Rsbuild configs, and the
  `mf-config` package is gone.
- The platform SDK lost the runtime module context. It gained typed `createModuleFlags`,
  `defineModule`, build info and a testing entry point.
- The frontend API lost the registry and its S3 dependency, and gained `APPS`.
- The release CLI went from many apps, each with its own pointer, to one app whose release
  records carry per-module revisions.
- The infrastructure went from a pipeline, stack and release role per app, to one delivery train
  plus checks and flags pipelines per team.
- Ownership enforcement moved from IAM (each team's role could only write its own prefix) to
  repository tooling (CODEOWNERS, boundaries, ownership check).
