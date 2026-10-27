/**
 * Keeps team ownership honest. For every module under modules/ it checks that:
 *
 * 1. module.json is valid and its package is named `@govcloud-mfe/<name>`,
 * 2. .github/CODEOWNERS assigns `/modules/<name>/` to the team in module.json (so that team's
 *    review is required for any change to it), and
 * 3. the app composes it: it's a dependency of apps/web and imported in apps/web/src/modules.ts.
 *
 * Run with `pnpm check:ownership`; part of `pnpm lint` and every pipeline's checks.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseModuleDescriptor } from '@govcloud-mfe/contracts';

const repoRoot = join(import.meta.dirname, '..', '..');
const CODEOWNERS_ORG = '@example-agency';

const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

/** `/modules/dashboard/` -> `@example-agency/team-insights`, from CODEOWNERS. */
function codeOwners(): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  for (const line of read('.github/CODEOWNERS').split('\n')) {
    const [pattern, ...teams] = line.replace(/#.*/, '').trim().split(/\s+/);
    if (pattern) owners.set(pattern, teams);
  }
  return owners;
}

function checkModule(name: string, owners: Map<string, string[]>): string[] {
  const dir = `modules/${name}`;
  if (!existsSync(join(repoRoot, dir, 'module.json'))) {
    return [`${dir} has no module.json`];
  }

  const errors: string[] = [];
  const descriptor = parseModuleDescriptor(
    JSON.parse(read(`${dir}/module.json`)),
    `${dir}/module.json`,
  );
  const packageName = `@govcloud-mfe/${descriptor.name}`;

  if (descriptor.name !== name) {
    errors.push(`${dir}/module.json is named "${descriptor.name}"; it must match its directory`);
  }
  if ((JSON.parse(read(`${dir}/package.json`)) as { name: string }).name !== packageName) {
    errors.push(`${dir}/package.json must be named ${packageName}`);
  }

  const expectedOwner = `${CODEOWNERS_ORG}/${descriptor.owner}`;
  const actualOwners = owners.get(`/${dir}/`) ?? [];
  if (actualOwners.length !== 1 || actualOwners[0] !== expectedOwner) {
    errors.push(
      `.github/CODEOWNERS must assign /${dir}/ to ${expectedOwner} only (found: ${actualOwners.join(' ') || 'nothing'})`,
    );
  }

  const webDependencies =
    (JSON.parse(read('apps/web/package.json')) as { dependencies?: Record<string, string> })
      .dependencies ?? {};
  if (!(packageName in webDependencies)) {
    errors.push(`apps/web/package.json does not depend on ${packageName}`);
  }
  if (!read('apps/web/src/modules.ts').includes(`from '${packageName}'`)) {
    errors.push(`apps/web/src/modules.ts does not import ${packageName}`);
  }
  return errors;
}

const owners = codeOwners();
const modules = readdirSync(join(repoRoot, 'modules'));
const errors = modules.flatMap((name) => checkModule(name, owners));

if (errors.length > 0) {
  console.error(`Ownership check failed:\n${errors.map((e) => `  ✖ ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`Ownership check passed for ${modules.length} modules: ${modules.join(', ')}`);
