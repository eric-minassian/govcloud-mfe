import type { CurrentUser, FeatureFlags, UserPreferences } from '@govcloud-mfe/contracts';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import type { BuildInfo } from './build-info';
import { PlatformProvider } from './platform-provider';
import { platformQueries } from './platform-queries';
import { createPlatformQueryClient } from './query-client';

interface PlatformTestOptions {
  /** Evaluated flags, keyed by app then flag, exactly as `/api/feature-flags` returns them. */
  flags?: FeatureFlags;
  user?: CurrentUser;
  preferences?: UserPreferences;
  buildInfo?: BuildInfo;
  /** Initial URL for the in-memory router. */
  route?: string;
}

const defaultUser: CurrentUser = { sub: 'test-user', email: 'test@example.gov', groups: [] };
const defaultPreferences: UserPreferences = {
  theme: 'system',
  density: 'comfortable',
  pinnedModules: [],
};

/**
 * Renders a module's UI with the same providers the app gives it, with platform data seeded in the
 * query cache instead of fetched. This lets a team test its module in isolation, without the app
 * or the frontend API.
 *
 * @example
 * renderWithPlatform(<App basePath="/" />, { flags: { dashboard: { releaseTimeline: { enabled: true } } } });
 */
export function renderWithPlatform(ui: ReactElement, options: PlatformTestOptions = {}) {
  const queryClient = createPlatformQueryClient();
  queryClient.setQueryData(platformQueries.featureFlags().queryKey, options.flags ?? {});
  queryClient.setQueryData(platformQueries.currentUser().queryKey, options.user ?? defaultUser);
  queryClient.setQueryData(
    platformQueries.preferences().queryKey,
    options.preferences ?? defaultPreferences,
  );

  return render(
    <PlatformProvider
      queryClient={queryClient}
      buildInfo={options.buildInfo ?? { version: 'test', modules: [] }}
    >
      <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
    </PlatformProvider>,
  );
}
