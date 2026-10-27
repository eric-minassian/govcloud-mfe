import { renderWithPlatform } from '@govcloud-mfe/platform-sdk/testing';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../src/App';

const build = {
  version: 'abc123def456',
  modules: [{ name: 'dashboard', owner: 'team-insights', revision: 'a41c09e2d3b7' }],
};

describe('dashboard module', () => {
  it('shows the signed-in user on the overview', async () => {
    renderWithPlatform(<App basePath="/" />, {
      user: { sub: 'u-123', email: 'jane@example.gov', groups: ['analysts'] },
    });
    expect(await screen.findByText('u-123')).toBeDefined();
    expect(screen.getByText('analysts')).toBeDefined();
  });

  it('keeps module revisions dark until releaseTimeline is on', () => {
    renderWithPlatform(<App basePath="/" />, { route: '/release', buildInfo: build });
    expect(screen.getByText(/not enabled for you yet/)).toBeDefined();
  });

  it('lists module revisions when releaseTimeline is on', async () => {
    renderWithPlatform(<App basePath="/" />, {
      route: '/release',
      buildInfo: build,
      flags: { dashboard: { releaseTimeline: { enabled: true, _variant: 'QA testers' } } },
    });
    expect(await screen.findByText('a41c09e2d3b7')).toBeDefined();
    expect(screen.getByText(/QA testers/)).toBeDefined();
  });
});
