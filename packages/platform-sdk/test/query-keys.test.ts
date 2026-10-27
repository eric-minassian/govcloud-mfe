import { describe, expect, it } from 'vitest';
import { moduleQueryKey } from '../src/query-keys';

describe('moduleQueryKey', () => {
  it('prefixes keys with the owning module', () => {
    expect(moduleQueryKey('dashboard', 'service-health', 1)).toEqual([
      'dashboard',
      'service-health',
      1,
    ]);
  });
});
