import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { useFeatureFlag, useFeatureFlagValue } from '../src/feature-flags';
import { MicroFrontendProvider } from '../src/micro-frontend-context';
import { PlatformProvider } from '../src/platform-provider';
import { platformQueries } from '../src/platform-queries';
import { createPlatformQueryClient } from '../src/query-client';

function renderInModule<T>(moduleName: string, hook: () => T) {
  const queryClient = createPlatformQueryClient();
  queryClient.setQueryData(platformQueries.featureFlags().queryKey, {
    dashboard: { releaseTimeline: { enabled: true, _variant: 'QA testers' } },
    settings: { releaseTimeline: { enabled: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PlatformProvider queryClient={queryClient}>
      <MicroFrontendProvider name={moduleName} version="test">
        {children}
      </MicroFrontendProvider>
    </PlatformProvider>
  );
  return renderHook(hook, { wrapper }).result;
}

describe('useFeatureFlag', () => {
  it("reads the calling module's own flags", () => {
    expect(renderInModule('dashboard', () => useFeatureFlag('releaseTimeline')).current).toBe(true);
    expect(renderInModule('settings', () => useFeatureFlag('releaseTimeline')).current).toBe(false);
  });

  it('treats unknown flags as off', () => {
    expect(renderInModule('dashboard', () => useFeatureFlag('doesNotExist')).current).toBe(false);
  });

  it('exposes attributes and the evaluated variant', () => {
    const value = renderInModule('dashboard', () => useFeatureFlagValue('releaseTimeline'));
    expect(value.current).toEqual({ enabled: true, _variant: 'QA testers' });
  });
});
