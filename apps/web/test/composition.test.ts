// @vitest-environment node
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readComposition } from '../build/composition-plugin';
import { modules } from '../src/modules';

const appDir = join(import.meta.dirname, '..');

describe('composition', () => {
  it('gives every module a unique name and route', () => {
    expect(new Set(modules.map((m) => m.name)).size).toBe(modules.length);
    expect(new Set(modules.map((m) => m.route)).size).toBe(modules.length);
  });

  it('records a revision for exactly the modules the app depends on', () => {
    const composition = readComposition(appDir);
    expect(composition.modules.map((m) => m.name)).toEqual(modules.map((m) => m.name).sort());
    for (const module of composition.modules) {
      expect(module.revision).toMatch(/^[0-9a-f]{12}$/);
    }
  });
});
