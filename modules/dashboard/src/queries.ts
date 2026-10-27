import { apiFetch, moduleQueryKey } from '@govcloud-mfe/platform-sdk';
import { queryOptions } from '@tanstack/react-query';

/** Queries owned by the dashboard module. Keys are namespaced so they can't collide with other modules. */
export const dashboardQueries = {
  serviceHealth: () =>
    queryOptions({
      queryKey: moduleQueryKey('dashboard', 'service-health'),
      queryFn: () => apiFetch<{ status: string }>('/api/health'),
      refetchInterval: 15_000,
    }),
};
