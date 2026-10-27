import { Alert } from '@govcloud-mfe/ui';
import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <Alert tone="warning" title="Page not found">
      <p>
        This page doesn't exist, or the module that owns it is currently disabled.{' '}
        <Link to="/">Go home</Link>
      </p>
    </Alert>
  );
}
