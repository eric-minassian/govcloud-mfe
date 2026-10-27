import { QueryClient } from '@tanstack/react-query';
import { ApiError, SessionExpiredError } from './api-client';

/**
 * The single QueryClient for the page, created by the app. Every module reads from the same cache,
 * so platform data (user, flags, preferences) is fetched once no matter how many modules use it.
 */
export function createPlatformQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => isRetryable(error) && failureCount < 2,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** Retrying a 4xx or an expired session only delays the inevitable. */
function isRetryable(error: unknown): boolean {
  if (error instanceof SessionExpiredError) return false;
  if (error instanceof ApiError) return error.status >= 500;
  return true;
}
