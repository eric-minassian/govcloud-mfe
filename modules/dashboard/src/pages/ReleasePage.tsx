import { Alert, PageHeader } from '@govcloud-mfe/ui';
import { Link } from 'react-router';
import { ModuleRevisions } from '../components/ModuleRevisions';
import { flags } from '../flags';

export function ReleasePage() {
  const showRevisions = flags.useFlag('releaseTimeline');

  return (
    <>
      <PageHeader title="Release" description={<Link to="..">← Back to dashboard</Link>} />
      {showRevisions ? (
        <ModuleRevisions />
      ) : (
        <Alert title="Module revisions are not enabled for you yet">
          They're behind the <code>releaseTimeline</code> feature flag, rolled out to a percentage
          of users through AppConfig.
        </Alert>
      )}
    </>
  );
}
