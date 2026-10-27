import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAppDescriptor } from '../src/app-descriptor';

const appsDir = fileURLToPath(new URL('../../../apps', import.meta.url));

const remote = {
  name: 'dashboard',
  kind: 'remote',
  displayName: 'Dashboard',
  route: '/dashboard',
  exposedModule: './App',
  owner: 'team',
  devPort: 3001,
};

describe('parseAppDescriptor', () => {
  it.each(readdirSync(appsDir))('accepts apps/%s/microfrontend.json', (app) => {
    const path = join(appsDir, app, 'microfrontend.json');
    const descriptor = parseAppDescriptor(JSON.parse(readFileSync(path, 'utf8')), path);
    expect(descriptor.name).toBe(app);
  });

  it('rejects names that are not valid Module Federation container names', () => {
    expect(() => parseAppDescriptor({ ...remote, name: 'my-app' })).toThrow(/name must match/);
  });

  it('requires remotes to declare where they mount and what they expose', () => {
    expect(() => parseAppDescriptor({ ...remote, route: 'dashboard' })).toThrow(/route/);
    expect(() => parseAppDescriptor({ ...remote, exposedModule: 'App' })).toThrow(/exposedModule/);
  });
});
