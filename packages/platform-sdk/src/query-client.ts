import { QueryClient } from '@tanstack/react-query';
import { ApiError, SessionExpiredError } from './api-client';

/**
 * The single QueryClient for the page. Created by the shell; remotes only ever see it through
 * React context, which works across federated modules because @tanstack/react-query is a
 * shared singleton.
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
