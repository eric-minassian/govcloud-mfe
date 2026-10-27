import type { FeatureFlagValue } from '@govcloud-mfe/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMicroFrontend } from './micro-frontend-context';
import { platformQueries } from './platform-queries';

/**
 * Full value of one of the calling module's feature flags (including attributes), or `undefined`
 * while flags are loading or if the flag doesn't exist.
 *
 * Flags are evaluated server-side by the AppConfig Agent for the signed-in user, so multi-variant
 * flags (percentage rollouts, allow-lists) need no client-side logic.
 */
export function useFeatureFlagValue(flag: string): FeatureFlagValue | undefined {
  const { name } = useMicroFrontend();
  const { data } = useQuery({
    ...platformQueries.featureFlags(),
    // `select` subscribes this component to its own flag only; other flag changes don't re-render.
    select: (flags) => flags[name]?.[flag],
  });
  return data;
}

/**
 * Whether one of the calling module's feature flags is on. Unknown or not-yet-loaded flags are
 * off, so new code paths stay dark until AppConfig says otherwise.
 */
export function useFeatureFlag(flag: string): boolean {
  return useFeatureFlagValue(flag)?.enabled ?? false;
}
