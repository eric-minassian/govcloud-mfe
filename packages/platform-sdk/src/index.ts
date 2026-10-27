/**
 * @govcloud-mfe/platform-sdk — the only way remotes talk to the platform.
 *
 * Shared as a Module Federation singleton: the shell and every remote get the same instance, so
 * React contexts and the TanStack Query cache created by the shell are visible to remotes.
 */
export { ApiError, apiFetch, SessionExpiredError } from './api-client';
export { useFeatureFlag, useFeatureFlagValue } from './feature-flags';
export { MicroFrontendProvider, useMicroFrontend } from './micro-frontend-context';
export { PlatformProvider } from './platform-provider';
export { platformQueries, useUpdatePreferences } from './platform-queries';
export { createPlatformQueryClient } from './query-client';
export { moduleQueryKey } from './query-keys';
export { reportClientEvent } from './telemetry';
