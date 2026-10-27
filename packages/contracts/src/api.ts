/** Response and request bodies of the same-origin frontend API (`/api/*`). See docs/contracts.md §4. */

export interface CurrentUser {
  sub: string;
  email?: string;
  name?: string;
  groups: string[];
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

/** Props the app passes to every module's root component. */
export interface ModuleProps {
  /** Absolute path the module is mounted at, e.g. `/dashboard`. */
  basePath: string;
}
