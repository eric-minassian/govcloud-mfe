import type { RemoteModule } from '@govcloud-mfe/contracts';
import { MicroFrontendProvider } from '@govcloud-mfe/platform-sdk';
import { Spinner } from '@govcloud-mfe/ui';
import { Suspense } from 'react';
import { remoteComponent } from './load-remote-component';
import { RemoteErrorBoundary } from './RemoteErrorBoundary';

/** Mounts one remote at its route, with loading and failure handling owned by the shell. */
export function RemoteModuleRoute({ module }: { module: RemoteModule }) {
  return (
    <MicroFrontendProvider name={module.name} version={module.version}>
      {/* Keyed so that navigating to another module resets a previous module's error. */}
      <RemoteErrorBoundary key={module.name} module={module}>
        <Suspense fallback={<Spinner label={`Loading ${module.displayName}`} />}>
          <RemoteRoot module={module} />
        </Suspense>
      </RemoteErrorBoundary>
    </MicroFrontendProvider>
  );
}

/**
 * Resolves the lazy component *inside* the error boundary, so that when the boundary resets
 * after a failure this remounts and picks up a fresh loader instead of the rejected one.
 */
function RemoteRoot({ module }: { module: RemoteModule }) {
  const RootComponent = remoteComponent(module);
  return <RootComponent basePath={module.route} />;
}
