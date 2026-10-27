import { platformQueries } from '@govcloud-mfe/platform-sdk';
import { Spinner } from '@govcloud-mfe/ui';
import { useQuery } from '@tanstack/react-query';
import { Route, Routes } from 'react-router';
import { AppLayout } from './layout/AppLayout';
import { modules } from './modules';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { enabledModules } from './routing/enabled-modules';
import { ModuleRoute } from './routing/ModuleRoute';

/**
 * Routes come from the compile-time composition, minus any module whose team has switched off its
 * `moduleEnabled` flag. That kill switch is the one per-module runtime control left once modules
 * are compiled in, so the app waits for flags before rendering navigation.
 */
export function App() {
  const flags = useQuery(platformQueries.featureFlags());
  if (flags.isPending) {
    return <Spinner label="Loading" />;
  }

  // If flags can't be loaded, `flags.data` is undefined and every module stays enabled (fail open).
  const visible = enabledModules(modules, flags.data);
  return (
    <Routes>
      <Route element={<AppLayout modules={visible} />}>
        <Route index element={<HomePage modules={visible} />} />
        {visible.map((module) => (
          <Route
            key={module.name}
            path={`${module.route}/*`}
            element={<ModuleRoute module={module} />}
          />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
