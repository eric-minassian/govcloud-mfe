import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import type { ComposedModule, ReleaseRecord } from '@govcloud-mfe/contracts';
import type { ReleaseContext } from '../src/context';

export function testContext(): ReleaseContext {
  return {
    stage: 'prod',
    bucket: 'assets-bucket',
    s3: new S3Client({ region: 'us-gov-west-1' }),
    releasedBy: 'test',
    log: () => {},
  };
}

export const dashboard = (revision: string): ComposedModule => ({
  name: 'dashboard',
  owner: 'team-insights',
  revision,
});
export const settings = (revision: string): ComposedModule => ({
  name: 'settings',
  owner: 'team-accounts',
  revision,
});

/** A build output directory as the web build produces it, compiled for `builtFor`. */
export function buildOutput(builtFor: string, modules: ComposedModule[]): string {
  const files: Record<string, string> = {
    'index.html': `<script defer src="/builds/${builtFor}/static/js/index.js"></script>`,
    'composition.json': JSON.stringify({ modules }),
    'static/js/index.js': 'console.log(1)',
  };
  const dir = mkdtempSync(join(tmpdir(), 'release-test-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

export function releaseRecord(version: string, modules: ComposedModule[]): ReleaseRecord {
  return {
    schemaVersion: 1,
    version,
    commit: `${version}0000`,
    modules,
    releasedAt: '2026-10-01T00:00:00.000Z',
    releasedBy: 'pipeline',
  };
}
