import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sharedDependencies } from '../src/shared';

const shellDir = fileURLToPath(new URL('../../../apps/shell', import.meta.url));

describe('sharedDependencies', () => {
  const shared = sharedDependencies(shellDir) as Record<string, Record<string, unknown>>;

  it('shares every stateful package as a singleton', () => {
    for (const name of ['react', 'react-dom', 'react-router', '@tanstack/react-query']) {
      expect(shared[name]).toMatchObject({ singleton: true });
    }
  });

  it('requires the installed major version', () => {
    const react = shared.react as { version: string; requiredVersion: string };
    expect(react.requiredVersion).toBe(`^${react.version.split('.')[0]}`);
  });

  it('treats the minor version as breaking for 0.x workspace packages', () => {
    expect(shared['@govcloud-mfe/platform-sdk']).toMatchObject({
      version: '0.1.0',
      requiredVersion: '^0.1',
    });
  });
});
