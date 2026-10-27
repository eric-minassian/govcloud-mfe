import { platformQueries } from '@govcloud-mfe/platform-sdk';
import { Alert, Button, Spinner } from '@govcloud-mfe/ui';
import { useQuery } from '@tanstack/react-query';
import { Route, Routes } from 'react-router';
import { ShellLayout } from './layout/ShellLayout';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { RemoteModuleRoute } from './remotes/RemoteModuleRoute';

/**
 * Routes are built from the module registry at runtime. The shell has no compile-time knowledge
 * of which remotes exist: a module appears when its pipeline publishes a release record and
 * disappears when its `moduleEnabled` kill switch is turned off in AppConfig.
 */
export function App() {
  const registry = useQuery(platformQueries.modules());

  if (registry.isPending) {
    return <Spinner label="Loading modules" />;
  }
  if (registry.isError) {
    return (
      <main className="shell-main">
        <Alert tone="error" title="The application could not start">
          <p>The module registry is unavailable.</p>
          <Button onClick={() => registry.refetch()}>Try again</Button>
        </Alert>
      </main>
    );
  }

  const { modules } = registry.data;
  return (
    <Routes>
      <Route element={<ShellLayout modules={modules} />}>
        <Route index element={<HomePage registry={registry.data} />} />
        {modules.map((module) => (
          <Route
            key={module.name}
            path={`${module.route}/*`}
            element={<RemoteModuleRoute module={module} />}
          />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
