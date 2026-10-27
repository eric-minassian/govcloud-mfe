import type { AppDescriptor } from '@govcloud-mfe/contracts';
import type { ModuleFederationOptions } from '@module-federation/rsbuild-plugin';
import { sharedDependencies } from './shared';

interface FederationOptions {
  /** Directory containing the app's package.json; used to resolve shared dependency versions. */
  appDir: string;
  /** Remote only: the file whose default export is the module's root component. */
  rootComponent?: string;
}

/**
 * Module Federation options for an app, derived from its `microfrontend.json`.
 *
 * - The shell declares **no static remotes**. It discovers them at runtime from `/api/modules`
 *   and registers them with the MF runtime, so a remote can ship (or roll back) without the
 *   shell being rebuilt.
 * - Remotes expose exactly one module — their root component — under the key from the
 *   descriptor, and emit `mf-manifest.json`, which is what the release record points at.
 */
export function federation(
  app: AppDescriptor,
  options: FederationOptions,
): ModuleFederationOptions {
  const common = {
    name: app.name,
    shared: sharedDependencies(options.appDir),
    // Types are shared through @govcloud-mfe/contracts instead of MF's generated d.ts bundles.
    dts: false,
  } satisfies ModuleFederationOptions;

  if (app.kind === 'shell') {
    return { ...common, remotes: {} };
  }

  if (!options.rootComponent) {
    throw new Error(`Remote "${app.name}" must specify rootComponent`);
  }
  return {
    ...common,
    filename: 'remoteEntry.js',
    manifest: true,
    exposes: { [app.exposedModule]: options.rootComponent },
  };
}
