import {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { AppDescriptor } from '@govcloud-mfe/contracts';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { promote } from '../src/promote';
import { publish } from '../src/publish';
import { rollback } from '../src/rollback';
import { buildOutput, manifestFor, remoteRecord, testContext } from './helpers';

const s3 = mockClient(S3Client);

/** Makes the version's upload marker exist (or not) as far as `objectExists` can tell. */
function markerExists(exists: boolean) {
  s3.on(ListObjectsV2Command).callsFake(({ Prefix }) => ({
    Contents: exists ? [{ Key: Prefix }] : [],
  }));
}

const shell: AppDescriptor = {
  name: 'shell',
  kind: 'shell',
  displayName: 'Shell',
  owner: 'team-platform',
  devPort: 3000,
};

beforeEach(() => {
  s3.reset();
  s3.on(PutObjectCommand).resolves({});
  s3.on(CopyObjectCommand).resolves({});
});

const putKeys = () => s3.commandCalls(PutObjectCommand).map((call) => call.args[0].input.Key);

describe('publish', () => {
  it('uploads every file as immutable and writes the upload marker last', async () => {
    markerExists(false);
    const assetsDir = buildOutput({
      'mf-manifest.json': manifestFor('/apps/dashboard/v2/'),
      'static/js/main.js': '1',
    });

    await publish(testContext('dashboard'), { version: 'v2', commit: 'c', assetsDir });

    expect(putKeys()).toEqual([
      'apps/dashboard/v2/mf-manifest.json',
      'apps/dashboard/v2/static/js/main.js',
      'apps/dashboard/v2/.upload-complete',
    ]);
    const js = s3.commandCalls(PutObjectCommand)[1]?.args[0].input;
    expect(js).toMatchObject({
      ContentType: 'text/javascript; charset=utf-8',
      CacheControl: 'public, max-age=31536000, immutable',
    });
  });

  it('refuses a build that was compiled for a different version', async () => {
    markerExists(false);
    const assetsDir = buildOutput({ 'mf-manifest.json': manifestFor('/apps/dashboard/v1/') });

    await expect(
      publish(testContext('dashboard'), { version: 'v2', commit: 'c', assetsDir }),
    ).rejects.toThrow('was built for /apps/dashboard/v1/, not /apps/dashboard/v2/');
    expect(putKeys()).toEqual([]);
  });

  it('skips the upload when the version is already published', async () => {
    markerExists(true);

    await publish(testContext('dashboard'), { version: 'v2', commit: 'c', assetsDir: '/nope' });

    expect(putKeys()).toEqual([]);
  });
});

describe('promote', () => {
  it('refuses to promote a version that was never published', async () => {
    markerExists(false);

    await expect(
      promote(testContext('shell'), { descriptor: shell, version: 'v2', commit: 'c' }),
    ).rejects.toThrow('shell@v2 has not been published to prod');
  });

  it('swaps the shell entry document, then writes the release record', async () => {
    markerExists(true);

    await promote(testContext('shell'), { descriptor: shell, version: 'v2', commit: 'c' });

    expect(s3.commandCalls(CopyObjectCommand)[0]?.args[0].input).toMatchObject({
      CopySource: 'assets-bucket/apps/shell/v2/index.html',
      Key: 'index.html',
      CacheControl: 'no-cache',
    });
    const record = JSON.parse(String(s3.commandCalls(PutObjectCommand)[0]?.args[0].input.Body));
    expect(record).toMatchObject({
      app: 'shell',
      version: 'v2',
      entry: '/apps/shell/v2/index.html',
    });
  });
});

describe('rollback', () => {
  beforeEach(() => {
    markerExists(true);
    s3.on(ListObjectVersionsCommand).resolves({
      Versions: [
        { Key: 'releases/dashboard.json', VersionId: 's3v3', IsLatest: true },
        { Key: 'releases/dashboard.json', VersionId: 's3v2' },
        { Key: 'releases/dashboard.json', VersionId: 's3v1' },
      ],
    });
    // v3 was deployed twice in a row (e.g. a pipeline re-run), so "previous" must skip it.
    const bodies: Record<string, string> = { s3v3: 'v3', s3v2: 'v3', s3v1: 'v1' };
    for (const [versionId, version] of Object.entries(bodies)) {
      s3.on(GetObjectCommand, { VersionId: versionId }).resolves({
        Body: { transformToString: async () => JSON.stringify(remoteRecord(version)) },
      } as never);
    }
  });

  const liveVersion = () =>
    JSON.parse(String(s3.commandCalls(PutObjectCommand)[0]?.args[0].input.Body)).version;

  it('returns to the most recent different version by default', async () => {
    await rollback(testContext('dashboard'), {});
    expect(liveVersion()).toBe('v1');
  });

  it('returns to an explicit version', async () => {
    await rollback(testContext('dashboard'), { toVersion: 'v1' });
    expect(liveVersion()).toBe('v1');
  });

  it('fails clearly for an unknown version', async () => {
    await expect(rollback(testContext('dashboard'), { toVersion: 'v0' })).rejects.toThrow(
      'v0 is not among the last 25 releases of dashboard',
    );
  });
});
