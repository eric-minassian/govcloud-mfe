import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { ModuleFederationOptions } from '@module-federation/rsbuild-plugin';

type SharedConfig = NonNullable<ModuleFederationOptions['shared']>;

/**
 * Packages that hold global state (React's dispatcher, the router's history, the query cache,
 * the platform SDK's contexts) must exist exactly once on the page, so they are shared as
 * singletons. The shell is the provider; remotes declare which major version they were built
 * against and Module Federation warns loudly if the shell provides something incompatible.
 */
const SINGLETONS = [
  'react',
  'react-dom',
  'react-router',
  '@tanstack/react-query',
  '@govcloud-mfe/platform-sdk',
  '@govcloud-mfe/ui',
] as const;

/**
 * Builds the `shared` map from the versions actually installed for this app.
 *
 * Versions are read from each package's own package.json because app manifests use pnpm
 * `catalog:` specifiers, which Module Federation can't interpret as semver ranges.
 */
export function sharedDependencies(appDir: string): SharedConfig {
  const require = createRequire(join(appDir, 'package.json'));

  return Object.fromEntries(
    SINGLETONS.map((name) => {
      const version = installedVersion(require, name);
      return [
        name,
        {
          singleton: true,
          version,
          requiredVersion: `^${majorOf(version)}`,
        },
      ];
    }),
  );
}

/**
 * Walks up from the package's resolved entry point to its own package.json. Some packages don't
 * list `./package.json` in their `exports`, so `require('<name>/package.json')` isn't reliable.
 */
function installedVersion(require: NodeJS.Require, name: string): string {
  let dir = dirname(require.resolve(name));
  while (dir !== dirname(dir)) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string; version: string };
      if (pkg.name === name) return pkg.version;
    }
    dir = dirname(dir);
  }
  throw new Error(`Could not find the installed version of ${name}`);
}

/** `19.3.1` -> `19`, but `0.1.0` -> `0.1` (for 0.x, the minor version is the breaking one). */
function majorOf(version: string): string {
  const [major, minor] = version.split('.');
  return major === '0' ? `${major}.${minor}` : (major ?? version);
}
