import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import type { ReleaseRecord } from '@govcloud-mfe/contracts';
import type { ReleaseContext } from '../src/context';

export function testContext(app: string): ReleaseContext {
  return {
    app,
    stage: 'prod',
    bucket: 'assets-bucket',
    s3: new S3Client({ region: 'us-gov-west-1' }),
    releasedBy: 'test',
    log: () => {},
  };
}

export function buildOutput(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'release-test-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

/** The part of a Module Federation manifest that records where the build expects to be served. */
export function manifestFor(publicPath: string): string {
  return JSON.stringify({ metaData: { publicPath } });
}

export function remoteRecord(version: string): ReleaseRecord {
  return {
    schemaVersion: 1,
    app: 'dashboard',
    kind: 'remote',
    version,
    entry: `/apps/dashboard/${version}/mf-manifest.json`,
    displayName: 'Dashboard',
    route: '/dashboard',
    exposedModule: './App',
    commit: `${version}0000`,
    releasedAt: '2026-10-01T00:00:00.000Z',
    releasedBy: 'pipeline',
  };
}
