import { platformQueries } from '@govcloud-mfe/platform-sdk';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Applies the user's theme and density to the document. Preferences are platform-owned data
 * edited by the Settings module; because the query cache is shared, a change saved there is
 * reflected here immediately — no cross-module events needed.
 */
export function useApplyPreferences() {
  const { data: preferences } = useQuery(platformQueries.preferences());

  useEffect(() => {
    if (!preferences) return;
    const root = document.documentElement;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme =
      preferences.theme === 'system' ? (prefersDark ? 'dark' : 'light') : preferences.theme;
    root.dataset.theme = theme;
    root.dataset.density = preferences.density;
  }, [preferences]);
}
