import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { bucketLayout, publicPathFor } from '@govcloud-mfe/contracts';
import { contentTypeFor } from './content-type';
import type { ReleaseContext } from './context';
import { mapWithConcurrency, objectExists } from './s3';

/** Everything under a version prefix is content-addressed by version, so it can be cached forever. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

interface PublishInput {
  version: string;
  commit: string;
  assetsDir: string;
}

/**
 * Uploads a build to its immutable prefix, `apps/<app>/<version>/`.
 *
 * Idempotent: if the version's upload marker already exists the upload is skipped. That makes
 * re-running a deploy (including CodePipeline's stage rollback, which re-runs the deploy action
 * with an older artifact) a fast pointer swap rather than a re-upload.
 *
 * Publishing does not change what users see — `promote` does.
 */
export async function publish(ctx: ReleaseContext, input: PublishInput): Promise<void> {
  const prefix = bucketLayout.versionPrefix(ctx.app, input.version);
  const marker = bucketLayout.uploadMarker(ctx.app, input.version);

  if (await objectExists(ctx.s3, ctx.bucket, marker)) {
    ctx.log(`${input.version} is already published, skipping upload`);
    return;
  }

  await assertBuiltFor(input.assetsDir, ctx.app, input.version);
  const files = await listFiles(input.assetsDir);
  ctx.log(`Uploading ${files.length} files to s3://${ctx.bucket}/${prefix}`);

  await mapWithConcurrency(files, 8, async (file) => {
    await ctx.s3.send(
      new PutObjectCommand({
        Bucket: ctx.bucket,
        Key: prefix + file,
        Body: await readFile(join(input.assetsDir, file)),
        ContentType: contentTypeFor(file),
        CacheControl: IMMUTABLE,
      }),
    );
  });

  // Written last: a version only counts as published once every one of its files is in place.
  await ctx.s3.send(
    new PutObjectCommand({
      Bucket: ctx.bucket,
      Key: marker,
      Body: JSON.stringify({
        app: ctx.app,
        version: input.version,
        commit: input.commit,
        files: files.length,
        publishedAt: new Date().toISOString(),
      }),
      ContentType: 'application/json',
    }),
  );
}

/**
 * A build only works when served from the prefix it was compiled for, so refuse to publish it
 * anywhere else. Both the shell and remotes emit `mf-manifest.json`, which records that prefix.
 */
async function assertBuiltFor(assetsDir: string, app: string, version: string): Promise<void> {
  const manifestPath = join(assetsDir, 'mf-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    metaData?: { publicPath?: string };
  };
  const builtFor = manifest.metaData?.publicPath;
  const expected = publicPathFor(app, version);
  if (builtFor !== expected) {
    throw new Error(
      `${manifestPath} was built for ${builtFor}, not ${expected}. Rebuild with RELEASE_VERSION=${version}.`,
    );
  }
}

/** Relative, `/`-separated paths of every file under `dir`. */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}
