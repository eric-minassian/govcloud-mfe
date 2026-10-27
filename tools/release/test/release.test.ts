import {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ReleaseRecord } from '@govcloud-mfe/contracts';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { deploy } from '../src/deploy';
import { describeChanges } from '../src/describe-changes';
import { rollback } from '../src/rollback';
import { buildOutput, dashboard, releaseRecord, settings, testContext } from './helpers';

const s3 = mockClient(S3Client);

/** Makes the build's upload marker exist (or not) as far as `objectExists` can tell. */
function uploaded(exists: boolean) {
  s3.on(ListObjectsV2Command).callsFake(({ Prefix }) => ({
    Contents: exists ? [{ Key: Prefix }] : [],
  }));
}

const putKeys = () => s3.commandCalls(PutObjectCommand).map((call) => call.args[0].input.Key);
const liveRecord = (): ReleaseRecord =>
  JSON.parse(String(s3.commandCalls(PutObjectCommand).at(-1)?.args[0].input.Body));

beforeEach(() => {
  s3.reset();
  s3.on(PutObjectCommand).resolves({});
  s3.on(CopyObjectCommand).resolves({});
});

describe('deploy', () => {
  const modules = [dashboard('aaa'), settings('bbb')];

  it('uploads the build, then swaps index.html, then writes the release record', async () => {
    uploaded(false);
    const assetsDir = buildOutput('v2', modules);
    // After the upload the marker exists, which `activate` checks before swapping.
    s3.on(PutObjectCommand, { Key: 'builds/v2/.upload-complete' }).callsFake(() => uploaded(true));

    await deploy(testContext(), { version: 'v2', commit: 'c2', assetsDir });

    // Files upload concurrently; only the marker and the record have a fixed order.
    const keys = putKeys();
    expect(keys.slice(0, -2).sort()).toEqual([
      'builds/v2/composition.json',
      'builds/v2/index.html',
      'builds/v2/static/js/index.js',
    ]);
    expect(keys.slice(-2)).toEqual(['builds/v2/.upload-complete', 'releases/web.json']);
    expect(s3.commandCalls(CopyObjectCommand)[0]?.args[0].input).toMatchObject({
      CopySource: 'assets-bucket/builds/v2/index.html',
      Key: 'index.html',
      CacheControl: 'no-cache',
    });
    expect(liveRecord()).toMatchObject({ version: 'v2', commit: 'c2', modules });
  });

  it('skips the upload when the build is already there', async () => {
    uploaded(true);

    await deploy(testContext(), { version: 'v2', commit: 'c2', assetsDir: buildOutput('v2', []) });

    expect(putKeys()).toEqual(['releases/web.json']);
  });

  it('refuses a build compiled for a different version', async () => {
    uploaded(false);

    await expect(
      deploy(testContext(), { version: 'v2', commit: 'c2', assetsDir: buildOutput('v1', []) }),
    ).rejects.toThrow('was not built for /builds/v2/');
    expect(putKeys()).toEqual([]);
  });
});

describe('rollback', () => {
  beforeEach(() => {
    uploaded(true);
    s3.on(ListObjectVersionsCommand).resolves({
      Versions: [
        { Key: 'releases/web.json', VersionId: 's3v3', IsLatest: true },
        { Key: 'releases/web.json', VersionId: 's3v2' },
        { Key: 'releases/web.json', VersionId: 's3v1' },
      ],
    });
    // v3 changed only the dashboard; v2 was a redeploy of v3 (e.g. a pipeline re-run).
    const records: Record<string, ReleaseRecord> = {
      s3v3: releaseRecord('v3', [dashboard('new'), settings('same')]),
      s3v2: releaseRecord('v3', [dashboard('new'), settings('same')]),
      s3v1: releaseRecord('v1', [dashboard('old'), settings('same')]),
    };
    for (const [versionId, record] of Object.entries(records)) {
      s3.on(GetObjectCommand, { VersionId: versionId }).resolves({
        Body: { transformToString: async () => JSON.stringify(record) },
      } as never);
    }
  });

  it('returns to the most recent different release', async () => {
    await rollback(testContext(), {});
    expect(liveRecord().version).toBe('v1');
  });

  it('says whose changes it reverts', async () => {
    const messages: string[] = [];
    await rollback({ ...testContext(), log: (m) => messages.push(m) }, { toVersion: 'v1' });
    expect(messages).toContain('Reverts: dashboard (team-insights)');
  });

  it('fails clearly for an unknown version', async () => {
    await expect(rollback(testContext(), { toVersion: 'v0' })).rejects.toThrow(
      'v0 is not among the last 25 releases',
    );
  });
});

describe('describeChanges', () => {
  it('names the teams whose modules changed', () => {
    expect(describeChanges([dashboard('a'), settings('b')], [dashboard('a'), settings('c')])).toBe(
      'settings (team-accounts)',
    );
    expect(describeChanges([dashboard('a')], [dashboard('a')])).toBe('no module changes');
  });
});
