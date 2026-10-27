import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changedModules, parseModuleDescriptor } from '../src';

const modulesDir = join(import.meta.dirname, '../../../modules');

const descriptor = {
  name: 'dashboard',
  displayName: 'Dashboard',
  route: '/dashboard',
  owner: 'team-insights',
};

describe('parseModuleDescriptor', () => {
  it.each(readdirSync(modulesDir))('accepts modules/%s/module.json', (name) => {
    const path = join(modulesDir, name, 'module.json');
    expect(parseModuleDescriptor(JSON.parse(readFileSync(path, 'utf8')), path).name).toBe(name);
  });

  it('rejects names that are not valid package or AppConfig suffixes', () => {
    expect(() => parseModuleDescriptor({ ...descriptor, name: 'My-Module' })).toThrow(/name/);
  });

  it('requires an absolute route and an owner', () => {
    expect(() => parseModuleDescriptor({ ...descriptor, route: 'dashboard' })).toThrow(/route/);
    expect(() => parseModuleDescriptor({ ...descriptor, owner: '' })).toThrow(/owner/);
  });
});

describe('changedModules', () => {
  const dashboard = { name: 'dashboard', owner: 'team-insights', revision: 'aaa' };
  const settings = { name: 'settings', owner: 'team-accounts', revision: 'bbb' };

  it('reports only modules whose code changed', () => {
    const next = [{ ...dashboard, revision: 'ccc' }, settings];
    expect(changedModules([dashboard, settings], next)).toEqual([next[0]]);
  });

  it('reports added and removed modules', () => {
    expect(changedModules([dashboard], [settings]).map((m) => m.name)).toEqual([
      'settings',
      'dashboard',
    ]);
  });
});
