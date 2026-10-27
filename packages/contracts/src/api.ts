/** Response and request bodies of the same-origin frontend API (`/api/*`). See docs/contracts.md §4. */

export interface CurrentUser {
  sub: string;
  email?: string;
  name?: string;
  groups: string[];
}

export interface RemoteModule {
  name: string;
  displayName: string;
  route: string;
  /** URL of the module's `mf-manifest.json`. */
  entry: string;
  exposedModule: string;
  version: string;
}

export interface ModuleRegistry {
  shell: { version: string } | null;
  modules: RemoteModule[];
}

/** Evaluated AppConfig feature flag: `enabled` plus any attributes defined on the flag. */
export interface FeatureFlagValue {
  enabled: boolean;
  [attribute: string]: unknown;
}

/** Flags for every app, keyed by app name and then flag key. */
export type FeatureFlags = Record<string, Record<string, FeatureFlagValue>>;

export interface UserPreferences {
  theme: 'system' | 'light' | 'dark';
  density: 'comfortable' | 'compact';
  pinnedModules: string[];
}

export type ClientEventType = 'module-load-failure' | 'render-error';

export interface ClientEvent {
  type: ClientEventType;
  app: string;
  version?: string;
  message: string;
}

/** Props the shell passes to every remote's root component. */
export interface MicroFrontendProps {
  /** Absolute path the module is mounted at, e.g. `/dashboard`. Build links relative to it. */
  basePath: string;
}
