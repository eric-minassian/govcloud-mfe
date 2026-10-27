import type { ModuleRegistry } from '@govcloud-mfe/contracts';
import { useFeatureFlagValue } from '@govcloud-mfe/platform-sdk';
import { Badge, Card } from '@govcloud-mfe/ui';
import styles from '../dashboard.module.css';

/** Feature-flagged widget (`releaseTimeline`), demonstrating a multi-variant AppConfig flag. */
export function ReleaseTimeline({ registry }: { registry: ModuleRegistry }) {
  const flag = useFeatureFlagValue('releaseTimeline');

  return (
    <Card title="Live versions">
      <ol className={styles.timeline}>
        <li>
          <strong>Shell</strong> <Badge>{registry.shell?.version ?? 'unknown'}</Badge>
        </li>
        {registry.modules.map((module) => (
          <li key={module.name}>
            <strong>{module.displayName}</strong> <Badge>{module.version}</Badge>
            <div>
              <code>{module.entry}</code>
            </div>
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
