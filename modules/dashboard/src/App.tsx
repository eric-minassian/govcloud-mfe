import type { ModuleProps } from '@govcloud-mfe/contracts';
import { Route, Routes } from 'react-router';
import { OverviewPage } from './pages/OverviewPage';
import { ReleasePage } from './pages/ReleasePage';

/**
 * Root of the dashboard module. The app mounts it at `/dashboard/*`; routes here are relative,
 * so the module doesn't need to know where it's mounted.
 */
export default function App(_props: ModuleProps) {
  return (
    <Routes>
      <Route index element={<OverviewPage />} />
      <Route path="release" element={<ReleasePage />} />
    </Routes>
  );
}
