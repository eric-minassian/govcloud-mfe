import { platformQueries } from '@govcloud-mfe/platform-sdk';
import { Alert, Badge, Card, PageHeader, Spinner } from '@govcloud-mfe/ui';
import { useQuery } from '@tanstack/react-query';
import styles from '../settings.module.css';

/** Read-only view of every app's flags as evaluated for the current user. */
export function FeatureFlagsPage() {
  const flags = useQuery(platformQueries.featureFlags());

  return (
    <>
      <PageHeader
        title="Feature flags"
        description="Evaluated for you by the AppConfig Agent. Each app owns its own AppConfig application."
      />
      {flags.isPending && <Spinner />}
      {flags.isError && <Alert tone="error" title="Could not load feature flags" />}
      {flags.data && (
        <Card>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>App</th>
                <th>Flag</th>
                <th>State</th>
                <th>Variant</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(flags.data).flatMap(([app, appFlags]) =>
                Object.entries(appFlags).map(([key, value]) => (
                  <tr key={`${app}.${key}`}>
                    <td>{app}</td>
                    <td>
                      <code>{key}</code>
                    </td>
                    <td>
                      <Badge tone={value.enabled ? 'success' : 'neutral'}>
                        {value.enabled ? 'on' : 'off'}
                      </Badge>
                    </td>
                    <td>{typeof value._variant === 'string' ? value._variant : '—'}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
