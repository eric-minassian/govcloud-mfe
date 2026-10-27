/**
 * @govcloud-mfe/platform-sdk — everything a module needs from the platform: the API client, typed
 * feature flags, shared queries, telemetry, and `defineModule`.
 *
 * Modules are compiled into the same bundle as the app, so this is an ordinary library: one copy,
 * no runtime negotiation. Test helpers live in `@govcloud-mfe/platform-sdk/testing`.
 */
export { ApiError, apiFetch, SessionExpiredError } from './api-client';
export { type BuildInfo, useBuildInfo } from './build-info';
export { defineModule, type ModuleDefinition } from './define-module';
export { createModuleFlags } from './module-flags';
export { PlatformProvider } from './platform-provider';
export { platformQueries, useUpdatePreferences } from './platform-queries';
export { createPlatformQueryClient } from './query-client';
export { moduleQueryKey } from './query-keys';
export { reportClientEvent } from './telemetry';
