import type { AppDescriptor } from '@govcloud-mfe/contracts';
import type { ServerConfig } from '@rsbuild/core';

/** Where `cargo run` serves the frontend API locally. */
const FRONTEND_API_DEV_URL = 'http://localhost:8080';
/** Where the shell's dev server runs (apps/shell/microfrontend.json → devPort). */
const SHELL_DEV_ORIGIN = 'http://localhost:3000';

/**
 * Local dev server settings. Every app proxies `/api` to the frontend API so it behaves the same
 * when opened standalone as when it runs inside the shell.
 */
export function devServer(app: AppDescriptor): ServerConfig {
  return {
    port: app.devPort,
    strictPort: true,
    proxy: { '/api': FRONTEND_API_DEV_URL },
    // In dev the shell loads remotes from other ports, so remotes allow the shell's origin.
    // In AWS everything is same-origin behind the ALB and no CORS is configured at all.
    cors: app.kind === 'remote' ? { origin: SHELL_DEV_ORIGIN } : false,
    historyApiFallback: true,
  };
}
