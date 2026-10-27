import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  bucketLayout,
  COMPOSITION_FILE,
  type Composition,
  publicPathFor,
} from '@govcloud-mfe/contracts';
import { activate } from './activate';
import { contentTypeFor } from './content-type';
import type { ReleaseContext } from './context';
import { mapWithConcurrency, objectExists } from './s3';

/** Everything under a build prefix is content-addressed by version, so it can be cached forever. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

interface DeployInput {
  version: string;
  commit: string;
  assetsDir: string;
}

/**
 * Uploads a composed build to `builds/<version>/` (once) and makes it live.
 *
 * The upload is idempotent: if the build's marker already exists it's skipped. Re-running a deploy
 * — including CodePipeline's stage rollback, which re-runs it with an older bundle — is then just a
 * pointer swap.
 */
export async function deploy(ctx: ReleaseContext, input: DeployInput): Promise<void> {
  const composition = await readBuild(input.assetsDir, input.version);
  await publish(ctx, input);
  await activate(ctx, {
    schemaVersion: 1,
    version: input.version,
    commit: input.commit,
    modules: composition.modules,
    releasedAt: new Date().toISOString(),
    releasedBy: ctx.releasedBy,
  });
}

/**
 * Reads the build's composition, after checking the build was compiled for this version: a build
 * only works when served from the prefix it was compiled against.
 */
async function readBuild(assetsDir: string, version: string): Promise<Composition> {
  const indexHtml = await readFile(join(assetsDir, 'index.html'), 'utf8');
  const expected = publicPathFor(version);
  if (!indexHtml.includes(`"${expected}`)) {
    throw new Error(
      `${assetsDir} was not built for ${expected}. Rebuild with RELEASE_VERSION=${version}.`,
    );
  }
  return JSON.parse(await readFile(join(assetsDir, COMPOSITION_FILE), 'utf8')) as Composition;
}

async function publish(ctx: ReleaseContext, input: DeployInput): Promise<void> {
  const prefix = bucketLayout.buildPrefix(input.version);
  const marker = bucketLayout.uploadMarker(input.version);

  if (await objectExists(ctx.s3, ctx.bucket, marker)) {
    ctx.log(`${input.version} is already uploaded, skipping upload`);
    return;
  }

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

  // Written last: a build only counts as uploaded once every one of its files is in place.
  await ctx.s3.send(
    new PutObjectCommand({
      Bucket: ctx.bucket,
      Key: marker,
      Body: JSON.stringify({ version: input.version, commit: input.commit, files: files.length }),
      ContentType: 'application/json',
    }),
  );
}

/** Relative, `/`-separated paths of every file under `dir`. */
async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}
