import { platformQueries } from '@govcloud-mfe/platform-sdk';
import { Badge, Card, PageHeader, Spinner } from '@govcloud-mfe/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import styles from '../dashboard.module.css';
import { dashboardQueries } from '../queries';

export function OverviewPage() {
  // Platform data comes from the cache the app already filled; no extra request is made.
  const user = useQuery(platformQueries.currentUser());
  const health = useQuery(dashboardQueries.serviceHealth());

  return (
    <>
      <PageHeader title="Dashboard" description="Owned by team-insights." />
      <div className={styles.grid}>
        <Card title="Your session">
          {user.data ? (
            <dl>
              <dt>Subject</dt>
              <dd>
                <code>{user.data.sub}</code>
              </dd>
              <dt>Email</dt>
              <dd>{user.data.email ?? '—'}</dd>
              <dt>Groups</dt>
              <dd>{user.data.groups.join(', ') || '—'}</dd>
            </dl>
          ) : (
            <Spinner />
          )}
        </Card>
        <Card title="Frontend API">
          <p>
            Status{' '}
            {health.isPending ? (
              <Badge>checking</Badge>
            ) : (
              <Badge tone={health.data?.status === 'ok' ? 'success' : 'warning'}>
                {health.data?.status ?? 'unreachable'}
              </Badge>
            )}
          </p>
          <p>Polled every 15 seconds with TanStack Query.</p>
        </Card>
        <Card title="Release">
          <p>See which revision of each module is in this build.</p>
          <Link to="release">View release →</Link>
        </Card>
      </div>
    </>
  );
}
