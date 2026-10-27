import type { ModuleRegistry } from '@govcloud-mfe/contracts';
import { platformQueries } from '@govcloud-mfe/platform-sdk';
import { Badge, Card, PageHeader } from '@govcloud-mfe/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

export function HomePage({ registry }: { registry: ModuleRegistry }) {
  const { data: user } = useQuery(platformQueries.currentUser());

  return (
    <>
      <PageHeader
        title={`Welcome${user?.name ? `, ${user.name}` : ''}`}
        description="Each module below is built, deployed and rolled back by its own pipeline."
      />
      <div className="shell-grid">
        {registry.modules.map((module) => (
          <Card key={module.name} title={<Link to={module.route}>{module.displayName}</Link>}>
            <p>
              Version <Badge>{module.version}</Badge>
            </p>
            <p className="shell-muted">
              Loaded at runtime from <code>{module.entry}</code>
            </p>
          </Card>
        ))}
      </div>
      <p className="shell-muted">Shell version {registry.shell?.version ?? 'unknown'}</p>
    </>
  );
}
