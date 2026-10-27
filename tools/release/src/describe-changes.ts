import { type ComposedModule, changedModules } from '@govcloud-mfe/contracts';

/**
 * Human-readable summary of which teams' modules differ between two compositions, e.g.
 * `dashboard (team-insights)`. Anything else that changed (platform code) isn't listed.
 */
export function describeChanges(from: ComposedModule[], to: ComposedModule[]): string {
  const changed = changedModules(from, to);
  if (changed.length === 0) return 'no module changes';
  return changed.map((module) => `${module.name} (${module.owner})`).join(', ');
}
