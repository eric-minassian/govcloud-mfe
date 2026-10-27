import type { ModuleDefinition } from '@govcloud-mfe/platform-sdk';
import { Spinner } from '@govcloud-mfe/ui';
import { Suspense } from 'react';
import { ModuleErrorBoundary } from './ModuleErrorBoundary';

/** Mounts one module at its route. Loading and failure handling belong to the platform. */
export function ModuleRoute({ module }: { module: ModuleDefinition }) {
  const Root = module.component;

  return (
    // Keyed so that navigating to another module clears a previous module's error.
    <ModuleErrorBoundary key={module.name} module={module}>
      <Suspense fallback={<Spinner label={`Loading ${module.displayName}`} />}>
        <Root basePath={module.route} />
      </Suspense>
    </ModuleErrorBoundary>
  );
}
