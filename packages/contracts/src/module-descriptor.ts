/** `modules/<name>/module.json` — identifies one team-owned module. See docs/contracts.md §1. */
export interface ModuleDescriptor {
  /** Package `@govcloud-mfe/<name>`, AppConfig application suffix and metric dimension. */
  name: string;
  displayName: string;
  /** Base path the app mounts the module at, e.g. `/dashboard`. */
  route: string;
  /** Owning team slug. Must match the module's entry in .github/CODEOWNERS. */
  owner: string;
}

const MODULE_NAME = /^[a-z][a-z0-9]*$/;
const TEAM_SLUG = /^[a-z][a-z0-9-]*$/;

/** Validates an untrusted descriptor (e.g. parsed from disk) and narrows its type. */
export function parseModuleDescriptor(value: unknown, source = 'module.json'): ModuleDescriptor {
  const fail = (reason: string): never => {
    throw new Error(`Invalid ${source}: ${reason}`);
  };
  if (typeof value !== 'object' || value === null) fail('expected an object');
  const d = value as Record<string, unknown>;

  if (typeof d.name !== 'string' || !MODULE_NAME.test(d.name))
    fail(`name must match ${MODULE_NAME}`);
  if (typeof d.displayName !== 'string' || d.displayName === '') fail('displayName is required');
  if (typeof d.route !== 'string' || !d.route.startsWith('/')) fail('route must start with "/"');
  if (typeof d.owner !== 'string' || !TEAM_SLUG.test(d.owner))
    fail(`owner must match ${TEAM_SLUG}`);
  return d as unknown as ModuleDescriptor;
}
