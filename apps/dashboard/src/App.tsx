import type { MicroFrontendProps } from '@govcloud-mfe/contracts';
import { Route, Routes } from 'react-router';
import { OverviewPage } from './pages/OverviewPage';
import { ReleasesPage } from './pages/ReleasesPage';

/**
 * Root component exposed to the shell as `dashboard/App`.
 *
 * The shell mounts it at `/dashboard/*`; routes here are relative to that, so the module never
 * needs to know where it is mounted.
 */
export default function App(_props: MicroFrontendProps) {
  return (
    <Routes>
      <Route index element={<OverviewPage />} />
      <Route path="releases" element={<ReleasesPage />} />
    </Routes>
  );
}
