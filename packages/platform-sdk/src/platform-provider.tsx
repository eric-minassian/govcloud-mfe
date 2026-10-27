import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Root provider for anything that renders platform UI. The shell renders it once at the root;
 * remotes render it only in their standalone dev harness — never inside the exposed component,
 * which would shadow the shell's shared query cache.
 */
export function PlatformProvider({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
