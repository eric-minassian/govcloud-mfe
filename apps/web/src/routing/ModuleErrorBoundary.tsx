import { type ModuleDefinition, reportClientEvent } from '@govcloud-mfe/platform-sdk';
import { Alert, Button } from '@govcloud-mfe/ui';
import { Component, type ReactNode } from 'react';

interface Props {
  module: ModuleDefinition;
  children: ReactNode;
}

/**
 * Contains a failing module: the rest of the app keeps working, and the failure is reported as a
 * `ClientErrors` metric for that module. The delivery pipeline's bake watches every module's alarm,
 * so a release that breaks one module is rolled back — and the alarm says whose module it was.
 */
export class ModuleErrorBoundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    reportClientEvent({
      type: isChunkLoadError(error) ? 'module-load-failure' : 'render-error',
      app: this.props.module.name,
      version: __BUILD_INFO__.version,
      message: error.message,
    });
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <Alert tone="error" title={`${this.props.module.displayName} is unavailable right now`}>
        <p>
          The rest of the application is unaffected. The team that owns this module has been
          notified.
        </p>
        {isChunkLoadError(error) ? (
          // React.lazy remembers a failed import, so only a reload can fetch the chunk again.
          <Button onClick={() => window.location.reload()}>Reload</Button>
        ) : (
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
        )}
      </Alert>
    );
  }
}

/** The bundler raises ChunkLoadError when a lazily loaded chunk can't be fetched. */
function isChunkLoadError(error: Error): boolean {
  return error.name === 'ChunkLoadError';
}
