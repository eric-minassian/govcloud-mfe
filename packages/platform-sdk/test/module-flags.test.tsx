import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createModuleFlags } from '../src/module-flags';
import { PlatformProvider } from '../src/platform-provider';
import { platformQueries } from '../src/platform-queries';
import { createPlatformQueryClient } from '../src/query-client';

interface DashboardFlags {
  flags: { releaseTimeline: unknown; moduleEnabled: unknown };
}
const dashboard = createModuleFlags<DashboardFlags>('dashboard');

function renderFlagHook<T>(hook: () => T) {
  const queryClient = createPlatformQueryClient();
  queryClient.setQueryData(platformQueries.featureFlags().queryKey, {
    dashboard: { releaseTimeline: { enabled: true, _variant: 'QA testers' } },
    settings: { releaseTimeline: { enabled: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlatformProvider queryClient={queryClient} buildInfo={{ version: 'test', modules: [] }}>
      {children}
    </PlatformProvider>
  );
  return renderHook(hook, { wrapper }).result;
}

describe('createModuleFlags', () => {
  it("reads only the bound app's flags", () => {
    expect(renderFlagHook(() => dashboard.useFlag('releaseTimeline')).current).toBe(true);
  });

  it('treats flags missing from AppConfig as off', () => {
    expect(renderFlagHook(() => dashboard.useFlag('moduleEnabled')).current).toBe(false);
  });

  it('exposes attributes and the evaluated variant', () => {
    const value = renderFlagHook(() => dashboard.useFlagValue('releaseTimeline'));
    expect(value.current).toEqual({ enabled: true, _variant: 'QA testers' });
  });

  it('only accepts flag keys from the definitions', () => {
    expectTypeOf(dashboard.useFlag)
      .parameter(0)
      .toEqualTypeOf<'releaseTimeline' | 'moduleEnabled'>();
  });
});
