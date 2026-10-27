import type { FeatureFlags } from '@govcloud-mfe/contracts';
import type { ModuleDefinition } from '@govcloud-mfe/platform-sdk';

/** Name of the kill-switch flag every module defines in its own AppConfig application. */
export const KILL_SWITCH_FLAG = 'moduleEnabled';

/**
 * Modules whose kill switch isn't explicitly off. Fails open: a missing flag, a module without
 * flags, or no flags at all (AppConfig unreachable) all leave the module visible. Hiding every
 * module because of a flag outage would be worse than the problem the switch exists to solve.
 */
export function enabledModules<M extends ModuleDefinition>(
  modules: readonly M[],
  flags: FeatureFlags | undefined,
): M[] {
  return modules.filter((module) => flags?.[module.name]?.[KILL_SWITCH_FLAG]?.enabled !== false);
}
