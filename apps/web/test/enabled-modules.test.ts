import type { ModuleDefinition } from '@govcloud-mfe/platform-sdk';
import { describe, expect, it } from 'vitest';
import { enabledModules } from '../src/routing/enabled-modules';

const moduleNamed = (name: string): ModuleDefinition => ({
  name,
  displayName: name,
  route: `/${name}`,
  owner: 'team',
  component: () => null,
});
const modules = [moduleNamed('dashboard'), moduleNamed('settings')];

describe('enabledModules', () => {
  it('hides a module whose team switched off moduleEnabled', () => {
    const visible = enabledModules(modules, { dashboard: { moduleEnabled: { enabled: false } } });
    expect(visible.map((m) => m.name)).toEqual(['settings']);
  });

  it('fails open when flags are unavailable or the flag is missing', () => {
    expect(enabledModules(modules, undefined)).toHaveLength(2);
    expect(enabledModules(modules, { dashboard: {} })).toHaveLength(2);
  });
});
