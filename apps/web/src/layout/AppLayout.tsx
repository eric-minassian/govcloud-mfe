import { type ModuleDefinition, platformQueries } from '@govcloud-mfe/platform-sdk';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router';
import { flags } from '../flags';
import { useApplyPreferences } from './useApplyPreferences';

export function AppLayout({ modules }: { modules: readonly ModuleDefinition[] }) {
  const { data: user } = useQuery(platformQueries.currentUser());
  const banner = flags.useFlagValue('environmentBanner');
  useApplyPreferences();

  return (
    <div>
      {banner?.enabled && typeof banner.message === 'string' && (
        <div className="app-banner" role="note">
          {banner.message}
        </div>
      )}
      <header className="app-header">
        <NavLink to="/" className="app-brand">
          GovCloud MFE
        </NavLink>
        <nav aria-label="Modules" className="app-nav">
          {modules.map((module) => (
            <NavLink key={module.name} to={module.route}>
              {module.displayName}
            </NavLink>
          ))}
        </nav>
        <div className="app-user">
          {user && <span>{user.name ?? user.email ?? user.sub}</span>}
          {/* A plain link, not fetch: logout clears the ALB cookies and redirects to the IdP. */}
          <a href="/api/auth/logout">Sign out</a>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
