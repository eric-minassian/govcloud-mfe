import type { FeatureFlagValue } from '@govcloud-mfe/contracts';
import { useQuery } from '@tanstack/react-query';
import { platformQueries } from './platform-queries';

/** The part of an AppConfig feature-flags document the type system needs: its flag keys. */
interface FlagDefinitions {
  flags: Record<string, unknown>;
}

/**
 * Creates feature-flag hooks bound to one app's flags, with flag keys checked by the compiler.
 *
 * Pass the type of the module's own flag file using a type-only import. Nothing from the file is
 * bundled, so descriptions and targeting rules never reach the browser:
 *
 * @example
 * type Flags = typeof import('../feature-flags.json');
 * export const flags = createModuleFlags<Flags>('dashboard');
 * flags.useFlag('releaseTimeline'); // ✓
 * flags.useFlag('releaseTimelne');  // ✗ compile error
 *
 * Flags are evaluated server-side by the AppConfig Agent for the signed-in user, so multi-variant
 * flags (percentage rollouts, allow-lists) need no client-side logic.
 */
export function createModuleFlags<Definitions extends FlagDefinitions>(appName: string) {
  type FlagKey = Extract<keyof Definitions['flags'], string>;

  /** Full value of a flag (including attributes and the evaluated variant), once loaded. */
  function useFlagValue(flag: FlagKey): FeatureFlagValue | undefined {
    const { data } = useQuery({
      ...platformQueries.featureFlags(),
      // Subscribe to this one flag only; other flag changes don't re-render the component.
      select: (all) => all[appName]?.[flag],
    });
    return data;
  }

  /** Whether a flag is on. Flags that are loading or undefined in AppConfig count as off. */
  function useFlag(flag: FlagKey): boolean {
    return useFlagValue(flag)?.enabled ?? false;
  }

  return { useFlag, useFlagValue };
}
