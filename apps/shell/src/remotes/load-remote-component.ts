import type { MicroFrontendProps, RemoteModule } from '@govcloud-mfe/contracts';
import { loadRemote, registerRemotes } from '@module-federation/enhanced/runtime';
import { type ComponentType, type LazyExoticComponent, lazy } from 'react';

type RootComponent = ComponentType<MicroFrontendProps>;

/** Distinguishes "the module's code could not be fetched" from "the module threw while rendering". */
export class RemoteLoadError extends Error {
  constructor(module: RemoteModule, cause: unknown) {
    super(`Failed to load ${module.name}@${module.version}: ${String(cause)}`, { cause });
    this.name = 'RemoteLoadError';
  }
}

const registered = new Set<string>();
const components = new Map<string, LazyExoticComponent<RootComponent>>();

/**
 * Returns a lazily loaded component for a remote's root, registering the remote with the Module
 * Federation runtime on first use.
 *
 * A module's version is pinned for the lifetime of the page: if a newer release is promoted while
 * the user has the app open, they get it on their next page load. Old versions stay in S3, so
 * chunks the pinned version lazy-loads later still resolve.
 */
export function remoteComponent(module: RemoteModule): LazyExoticComponent<RootComponent> {
  let component = components.get(module.name);
  if (!component) {
    component = lazy(() => loadRootComponent(module));
    components.set(module.name, component);
  }
  return component;
}

/** Drops a failed component so the next render tries to load it again. */
export function forgetRemoteComponent(module: RemoteModule): void {
  components.delete(module.name);
}

async function loadRootComponent(module: RemoteModule): Promise<{ default: RootComponent }> {
  if (!registered.has(module.name)) {
    registerRemotes([{ name: module.name, entry: module.entry }]);
    registered.add(module.name);
  }

  // `./App` in the descriptor becomes the request `dashboard/App`.
  const request = `${module.name}/${module.exposedModule.replace(/^\.\//, '')}`;
  let exposed: { default?: RootComponent } | null;
  try {
    exposed = await loadRemote<{ default?: RootComponent }>(request);
  } catch (error) {
    throw new RemoteLoadError(module, error);
  }
  if (!exposed?.default) {
    throw new RemoteLoadError(module, `"${request}" has no default export`);
  }
  return { default: exposed.default };
}
