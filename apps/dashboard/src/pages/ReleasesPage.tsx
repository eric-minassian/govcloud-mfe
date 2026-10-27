import { platformQueries, useFeatureFlag } from '@govcloud-mfe/platform-sdk';
import { Alert, PageHeader, Spinner } from '@govcloud-mfe/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ReleaseTimeline } from '../components/ReleaseTimeline';

export function ReleasesPage() {
  const registry = useQuery(platformQueries.modules());
  const showTimeline = useFeatureFlag('releaseTimeline');

  return (
    <>
      <PageHeader title="Releases" description={<Link to="..">← Back to dashboard</Link>} />
      {registry.isPending && <Spinner />}
      {registry.isError && <Alert tone="error" title="Could not load releases" />}
      {registry.data &&
        (showTimeline ? (
          <ReleaseTimeline registry={registry.data} />
        ) : (
          <Alert title="Release timeline is not enabled for you yet">
            It is behind the <code>releaseTimeline</code> feature flag, rolled out to a percentage
            of users through AppConfig.
          </Alert>
        ))}
    </>
  );
}
