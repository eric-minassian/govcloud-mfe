import { CopyObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  type AppDescriptor,
  bucketLayout,
  publicPathFor,
  type ReleaseRecord,
} from '@govcloud-mfe/contracts';
import type { ReleaseContext } from './context';
import { objectExists } from './s3';

interface PromoteInput {
  descriptor: AppDescriptor;
  version: string;
  commit: string;
}

/** Makes a published version the live version of an app in this stage. */
export async function promote(ctx: ReleaseContext, input: PromoteInput): Promise<void> {
  await activate(ctx, releaseRecordFor(ctx, input));
}

export function releaseRecordFor(ctx: ReleaseContext, input: PromoteInput): ReleaseRecord {
  const { descriptor, version, commit } = input;
  const base = {
    schemaVersion: 1,
    app: descriptor.name,
    version,
    displayName: descriptor.displayName,
    commit,
    releasedAt: new Date().toISOString(),
    releasedBy: ctx.releasedBy,
  } as const;

  if (descriptor.kind === 'shell') {
    return {
      ...base,
      kind: 'shell',
      entry: `${publicPathFor(descriptor.name, version)}index.html`,
    };
  }
  return {
    ...base,
    kind: 'remote',
    entry: `${publicPathFor(descriptor.name, version)}mf-manifest.json`,
    route: descriptor.route,
    exposedModule: descriptor.exposedModule,
  };
}

/**
 * Points the app's live pointer(s) at `record.version`. Used by both promote and rollback.
 *
 * - Remotes: the release record is the pointer. The frontend API reads it (cached for a few
 *   seconds) to build `/api/modules`, so the next page load picks up the new version.
 * - Shell: nginx serves `/index.html` for every navigation, so that object is the pointer. It
 *   is replaced by a copy of the version's own index.html, then the record is updated to match.
 *
 * Each pointer is a single S3 PUT, so activation is atomic per object and takes effect without
 * rebuilding anything or invalidating any cache.
 */
export async function activate(ctx: ReleaseContext, record: ReleaseRecord): Promise<void> {
  const marker = bucketLayout.uploadMarker(ctx.app, record.version);
  if (!(await objectExists(ctx.s3, ctx.bucket, marker))) {
    throw new Error(`${ctx.app}@${record.version} has not been published to ${ctx.stage}`);
  }

  if (record.kind === 'shell') {
    const source = `${bucketLayout.versionPrefix(ctx.app, record.version)}index.html`;
    await ctx.s3.send(
      new CopyObjectCommand({
        Bucket: ctx.bucket,
        CopySource: `${ctx.bucket}/${source}`,
        Key: bucketLayout.shellEntryDocument,
        MetadataDirective: 'REPLACE',
        ContentType: 'text/html; charset=utf-8',
        // Browsers must revalidate the entry document on every load or they'd never see a release.
        CacheControl: 'no-cache',
      }),
    );
  }

  await ctx.s3.send(
    new PutObjectCommand({
      Bucket: ctx.bucket,
      Key: bucketLayout.releaseRecord(ctx.app),
      Body: JSON.stringify(record, null, 2),
      ContentType: 'application/json',
      CacheControl: 'no-cache',
    }),
  );
  ctx.log(`${ctx.app}@${record.version} is live in ${ctx.stage}`);
}
