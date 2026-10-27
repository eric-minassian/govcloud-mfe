import { renderWithPlatform } from '@govcloud-mfe/platform-sdk/testing';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App';

describe('settings module', () => {
  it('offers the compact density only when compactDensity is on', async () => {
    const { unmount } = renderWithPlatform(<App basePath="/" />);
    await screen.findByText('Comfortable');
    expect(screen.queryByText('Compact')).toBeNull();
    unmount();

    renderWithPlatform(<App basePath="/" />, {
      flags: { settings: { compactDensity: { enabled: true } } },
    });
    expect(await screen.findByText('Compact')).toBeDefined();
  });

  it("lists the build's modules as pinnable", async () => {
    renderWithPlatform(<App basePath="/" />, {
      buildInfo: {
        version: 'test',
        modules: [
          { name: 'dashboard', owner: 'team-insights', revision: 'a' },
          { name: 'settings', owner: 'team-accounts', revision: 'b' },
        ],
      },
    });
    expect(await screen.findByLabelText('dashboard')).toBeDefined();
  });

  it('shows flags for every app on the flags page', async () => {
    renderWithPlatform(<App basePath="/" />, {
      route: '/flags',
      flags: { web: { environmentBanner: { enabled: true } } },
    });
    expect(await screen.findByText('environmentBanner')).toBeDefined();
  });
});
