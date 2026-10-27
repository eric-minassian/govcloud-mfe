import type { RemoteModule } from '@govcloud-mfe/contracts';
import { platformQueries, useFeatureFlagValue } from '@govcloud-mfe/platform-sdk';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router';
import { useApplyPreferences } from './useApplyPreferences';

export function ShellLayout({ modules }: { modules: RemoteModule[] }) {
  const { data: user } = useQuery(platformQueries.currentUser());
  const banner = useFeatureFlagValue('environmentBanner');
  useApplyPreferences();

  return (
    <div className="shell">
      {banner?.enabled && typeof banner.message === 'string' && (
        <div className="shell-banner" role="note">
          {banner.message}
        </div>
      )}
      <header className="shell-header">
        <NavLink to="/" className="shell-brand">
          GovCloud MFE
        </NavLink>
        <nav aria-label="Modules" className="shell-nav">
          {modules.map((module) => (
            <NavLink key={module.name} to={module.route}>
              {module.displayName}
            </NavLink>
          ))}
        </nav>
        <div className="shell-user">
          {user && <span>{user.name ?? user.email ?? user.sub}</span>}
          {/* A plain link, not fetch: logout clears the ALB cookies and redirects to the IdP. */}
          <a href="/api/auth/logout">Sign out</a>
        </div>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
