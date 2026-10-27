import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AppDescriptor, parseAppDescriptor } from '@govcloud-mfe/contracts';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export const appDir = (app: string) => join(repoRoot, 'apps', app);
export const featureFlagsFile = (app: string) => join(appDir(app), 'feature-flags.json');

/**
 * Every directory under `apps/` with a `microfrontend.json` is an independently deployable app.
 * Adding a folder is all it takes to get its own runtime stack and pipeline.
 */
export function loadAppDescriptors(): AppDescriptor[] {
  return readdirSync(join(repoRoot, 'apps'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(repoRoot, 'apps', entry.name, 'microfrontend.json'))
    .filter((file) => existsSync(file))
    .map((file) => {
      const descriptor = parseAppDescriptor(JSON.parse(readFileSync(file, 'utf8')), file);
      if (!file.endsWith(join('apps', descriptor.name, 'microfrontend.json'))) {
        throw new Error(`${file}: the directory name must equal the app name "${descriptor.name}"`);
      }
      return descriptor;
    });
}
