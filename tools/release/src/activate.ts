import { CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { bucketLayout, type ReleaseRecord } from '@govcloud-mfe/contracts';
import type { ReleaseContext } from './context';
import { objectExists } from './s3';

/**
 * Makes `record.version` the live release. Used by deploy and rollback.
 *
 * nginx serves `/index.html` for every route, so that object is the live pointer: it's replaced by
 * a copy of the build's own index.html (a single, atomic PUT). The release record is written after
 * it, so the record always describes what users are actually being served.
 */
export async function activate(ctx: ReleaseContext, record: ReleaseRecord): Promise<void> {
  if (!(await objectExists(ctx.s3, ctx.bucket, bucketLayout.uploadMarker(record.version)))) {
    throw new Error(`Build ${record.version} has not been uploaded to ${ctx.stage}`);
  }

  await ctx.s3.send(
    new CopyObjectCommand({
      Bucket: ctx.bucket,
      CopySource: `${ctx.bucket}/${bucketLayout.buildPrefix(record.version)}index.html`,
      Key: bucketLayout.entryDocument,
      MetadataDirective: 'REPLACE',
      ContentType: 'text/html; charset=utf-8',
      // Browsers must revalidate the entry document on every load or they'd never see a release.
      CacheControl: 'no-cache',
    }),
  );
  await ctx.s3.send(
    new PutObjectCommand({
      Bucket: ctx.bucket,
      Key: bucketLayout.releaseRecord,
      Body: JSON.stringify(record, null, 2),
      ContentType: 'application/json',
      CacheControl: 'no-cache',
    }),
  );
  ctx.log(`${record.version} is live in ${ctx.stage}`);
}
