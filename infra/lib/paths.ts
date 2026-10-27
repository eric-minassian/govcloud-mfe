import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ModuleDescriptor, parseModuleDescriptor } from '@govcloud-mfe/contracts';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export const webFeatureFlagsFile = join(repoRoot, 'apps', 'web', 'feature-flags.json');
export const moduleFeatureFlagsFile = (module: string) =>
  join(repoRoot, 'modules', module, 'feature-flags.json');

/**
 * Every directory under `modules/` with a `module.json` is a team-owned module. Adding the folder
 * gives the team its own ModuleStack (flags + alarm) and its own checks and flags pipelines.
 * Sorted, so generated names and lists are stable between synths.
 */
export function loadModules(): ModuleDescriptor[] {
  const modulesDir = join(repoRoot, 'modules');
  return readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(modulesDir, entry.name, 'module.json'))
    .filter((file) => existsSync(file))
    .map((file) => {
      const descriptor = parseModuleDescriptor(JSON.parse(readFileSync(file, 'utf8')), file);
      if (!file.endsWith(join('modules', descriptor.name, 'module.json'))) {
        throw new Error(
          `${file}: the directory name must equal the module name "${descriptor.name}"`,
        );
      }
      return descriptor;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
