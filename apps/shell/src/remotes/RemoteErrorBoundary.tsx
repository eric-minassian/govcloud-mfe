import type { RemoteModule } from '@govcloud-mfe/contracts';
import { reportClientEvent } from '@govcloud-mfe/platform-sdk';
import { Alert, Button } from '@govcloud-mfe/ui';
import { Component, type ReactNode } from 'react';
import { forgetRemoteComponent, RemoteLoadError } from './load-remote-component';

interface Props {
  module: RemoteModule;
  children: ReactNode;
}

/**
 * Isolates a failing remote: the shell and other modules keep working, and the failure is
 * reported as a `ClientErrors` metric for the module that caused it. That metric drives the
 * module's alarm, which in turn triggers automated rollback of its pipeline or flag deployment.
 */
export class RemoteErrorBoundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    const { module } = this.props;
    reportClientEvent({
      type: error instanceof RemoteLoadError ? 'module-load-failure' : 'render-error',
      app: module.name,
      version: module.version,
      message: error.message,
    });
  }

  private retry = () => {
    forgetRemoteComponent(this.props.module);
    this.setState({ error: null });
  };

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <Alert tone="error" title={`${this.props.module.displayName} is unavailable right now`}>
        <p>
          The rest of the application is unaffected. The team that owns this module has been
          notified.
        </p>
        <Button onClick={this.retry}>Try again</Button>
      </Alert>
    );
  }
}
