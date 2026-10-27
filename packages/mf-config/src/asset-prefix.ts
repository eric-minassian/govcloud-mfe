import { type AppDescriptor, publicPathFor } from '@govcloud-mfe/contracts';

/**
 * The version being built. CI sets `RELEASE_VERSION` to the 12-character commit SHA; local
 * production builds fall back to `local`.
 */
export function releaseVersion(): string {
  return process.env.RELEASE_VERSION ?? 'local';
}

/**
 * Production builds are compiled against the absolute, versioned path the files will be served
 * from (`/apps/<app>/<version>/`). Because every reference inside a build stays within its own
 * immutable prefix, activating or rolling back a version is just a pointer change — no rebuild,
 * no cache invalidation.
 */
export function assetPrefix(app: AppDescriptor): string {
  return publicPathFor(app.name, releaseVersion());
}
