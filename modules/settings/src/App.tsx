import type { ModuleProps } from '@govcloud-mfe/contracts';
import { NavLink, Route, Routes } from 'react-router';
import { FeatureFlagsPage } from './pages/FeatureFlagsPage';
import { PreferencesPage } from './pages/PreferencesPage';
import styles from './settings.module.css';

/** Root of the settings module, mounted by the app at `/settings/*`. */
export default function App(_props: ModuleProps) {
  return (
    <>
      <nav className={styles.tabs} aria-label="Settings sections">
        <NavLink to="." end>
          Preferences
        </NavLink>
        <NavLink to="flags">Feature flags</NavLink>
      </nav>
      <Routes>
        <Route index element={<PreferencesPage />} />
        <Route path="flags" element={<FeatureFlagsPage />} />
      </Routes>
    </>
  );
}
