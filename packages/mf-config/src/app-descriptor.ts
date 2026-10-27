import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AppDescriptor, parseAppDescriptor } from '@govcloud-mfe/contracts';

/** Reads and validates `<appDir>/microfrontend.json`. */
export function loadAppDescriptor(appDir: string): AppDescriptor {
  const path = join(appDir, 'microfrontend.json');
  return parseAppDescriptor(JSON.parse(readFileSync(path, 'utf8')), path);
}
