import { GetObjectCommand, ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import { bucketLayout, type ReleaseRecord } from '@govcloud-mfe/contracts';
import type { ReleaseContext } from './context';

export interface ReleaseHistoryEntry {
  record: ReleaseRecord;
  /** Whether this is the current version of the release record, i.e. the live release. */
  isLive: boolean;
}

/**
 * Past releases, newest first. There is no separate history store: the bucket is versioned, so
 * every write of `releases/web.json` is kept as an object version.
 */
export async function releaseHistory(
  ctx: ReleaseContext,
  limit: number,
): Promise<ReleaseHistoryEntry[]> {
  const key = bucketLayout.releaseRecord;
  const { Versions = [] } = await ctx.s3.send(
    new ListObjectVersionsCommand({ Bucket: ctx.bucket, Prefix: key }),
  );

  // S3 lists the versions of a key newest first. `Prefix` also matches longer keys; drop those.
  const versions = Versions.filter((v) => v.Key === key && v.VersionId).slice(0, limit);

  return Promise.all(
    versions.map(async (version) => {
      const object = await ctx.s3.send(
        new GetObjectCommand({ Bucket: ctx.bucket, Key: key, VersionId: version.VersionId }),
      );
      const body = await object.Body?.transformToString();
      if (!body) throw new Error(`Release record ${key}@${version.VersionId} is empty`);
      return { record: JSON.parse(body) as ReleaseRecord, isLive: version.IsLatest === true };
    }),
  );
}
