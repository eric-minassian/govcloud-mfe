import { type ModuleDefinition, platformQueries, useBuildInfo } from '@govcloud-mfe/platform-sdk';
import { Badge, Card, PageHeader } from '@govcloud-mfe/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

export function HomePage({ modules }: { modules: readonly ModuleDefinition[] }) {
  const { data: user } = useQuery(platformQueries.currentUser());
  const build = useBuildInfo();
  const revisionOf = (name: string) => build.modules.find((m) => m.name === name)?.revision;

  return (
    <>
      <PageHeader
        title={`Welcome${user?.name ? `, ${user.name}` : ''}`}
        description="Each module is owned by one team and compiled into this single build."
      />
      <div className="app-grid">
        {modules.map((module) => (
          <Card key={module.name} title={<Link to={module.route}>{module.displayName}</Link>}>
            <p>
              Owned by <strong>{module.owner}</strong>
            </p>
            <p className="app-muted">
              Revision <Badge>{revisionOf(module.name) ?? 'unknown'}</Badge>
            </p>
          </Card>
        ))}
      </div>
      <p className="app-muted">Build {build.version}</p>
    </>
  );
}
