import { useBuildInfo } from '@govcloud-mfe/platform-sdk';
import { Badge, Card } from '@govcloud-mfe/ui';
import styles from '../dashboard.module.css';
import { flags } from '../flags';

/**
 * Feature-flagged widget (`releaseTimeline`, a multi-variant AppConfig flag). It shows what's
 * inside the running build: one version for the whole app, and a content revision per module, so
 * you can see which teams' code changed between two releases.
 */
export function ModuleRevisions() {
  const build = useBuildInfo();
  const flag = flags.useFlagValue('releaseTimeline');

  return (
    <Card title={`Build ${build.version}`}>
      <ol className={styles.timeline}>
        {build.modules.map((module) => (
          <li key={module.name}>
            <strong>{module.name}</strong> <Badge>{module.revision}</Badge>{' '}
            <span>owned by {module.owner}</span>
          </li>
        ))}
      </ol>
      {typeof flag?._variant === 'string' && (
        <p>
          You are seeing this through the <em>{flag._variant}</em> variant.
        </p>
      )}
    </Card>
  );
}
