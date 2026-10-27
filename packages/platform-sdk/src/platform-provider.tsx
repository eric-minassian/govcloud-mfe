import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { type BuildInfo, BuildInfoContext } from './build-info';

/**
 * Root provider for everything platform-related. The app renders it once at the root; module
 * tests get it from `renderWithPlatform`. Modules never render it themselves.
 */
export function PlatformProvider({
  queryClient,
  buildInfo,
  children,
}: {
  queryClient: QueryClient;
  buildInfo: BuildInfo;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <BuildInfoContext.Provider value={buildInfo}>{children}</BuildInfoContext.Provider>
    </QueryClientProvider>
  );
}
