import type { CurrentUser, FeatureFlags, UserPreferences } from '@govcloud-mfe/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api-client';

/**
 * Query definitions for platform-owned data. Use them with any TanStack Query hook:
 *
 * @example const { data: user } = useQuery(platformQueries.currentUser());
 *
 * Defining them once (instead of inline `useQuery` calls) keeps keys, fetchers and cache timing
 * consistent between the app and every module, so they all share one cache entry.
 */
export const platformQueries = {
  currentUser: () =>
    queryOptions({
      queryKey: ['platform', 'current-user'],
      queryFn: () => apiFetch<CurrentUser>('/api/me'),
      staleTime: Number.POSITIVE_INFINITY,
    }),

  featureFlags: () =>
    queryOptions({
      queryKey: ['platform', 'feature-flags'],
      queryFn: () => apiFetch<FeatureFlags>('/api/feature-flags'),
      // Matches the AppConfig Agent's poll interval: refetching faster can't see newer data.
      staleTime: 30_000,
      refetchInterval: 60_000,
    }),

  preferences: () =>
    queryOptions({
      queryKey: ['platform', 'preferences'],
      queryFn: () => apiFetch<UserPreferences>('/api/preferences'),
    }),
};

/**
 * Saves the user's preferences with an optimistic update: the UI changes immediately and reverts
 * if the server rejects the change.
 */
export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  const { queryKey } = platformQueries.preferences();

  return useMutation({
    mutationFn: (preferences: UserPreferences) =>
      apiFetch<UserPreferences>('/api/preferences', {
        method: 'PUT',
        body: JSON.stringify(preferences),
      }),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, next);
      return { previous };
    },
    onError: (_error, _next, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
}
