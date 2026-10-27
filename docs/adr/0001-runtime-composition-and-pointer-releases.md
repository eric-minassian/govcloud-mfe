# 0001 — Runtime composition with immutable artifacts and pointer releases

**Status:** accepted

## Context

Each micro-frontend must deploy and roll back on its own, without rebuilding or redeploying
the shell. GovCloud has no CloudFront, so there is no CDN cache to invalidate and no
edge-function to rewrite requests. The tools available are S3, nginx and the ALB.

## Decision

- **Immutable, versioned artifacts.** Every build is compiled against
  `publicPath = /apps/<app>/<version>/` and uploaded to that S3 prefix once. Nothing under a
  version prefix ever changes or is deleted by a deploy.
- **A single mutable pointer per app.**
  - Remotes: `releases/<app>.json`, read by the frontend API to answer `/api/modules`.
  - Shell: `index.html`, served by nginx for every navigation, plus `releases/shell.json` for
    consistency and history.
- **Runtime discovery.** The shell declares no remotes at build time. It fetches the registry
  and calls the Module Federation runtime's `registerRemotes()`.
- **History via S3 versioning.** Rollback reads earlier object versions of the pointer.

## Consequences

- A deploy goes live with one S3 PUT and a rollback is another. Both take seconds, need no
  rebuild and leave nothing to invalidate.
- Users with an open tab keep their versions until they reload. Old chunks stay available
  because versions are never deleted.
- Old versions accumulate. A retention job that keeps the last N versions of each app (and
  never the live one) is future work. Bucket lifecycle rules can't express that safely.
- The frontend API sits on the critical path for remote discovery. It caches release records for
  a few seconds, and if flags are unavailable it fails open (modules stay visible).

## Alternatives considered

- **Static remotes baked into the shell** (`remotes: { dashboard: 'dashboard@/apps/dashboard/remoteEntry.js' }`).
  Shipping a remote then means either rebuilding the shell or overwriting a mutable remoteEntry,
  which breaks open tabs and makes rollback a re-upload.
- **The registry as an AppConfig freeform profile.** This gets AppConfig's built-in bake and
  rollback, but the per-environment deployment lock serialises every team's releases, and the
  shell's `index.html` would still need a separate pointer.
- **SSM Parameter Store pointers.** These work equally well. S3 keeps all frontend state in one
  place, and nginx and the API already need access to it.
