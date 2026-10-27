import { ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';

/**
 * Whether `key` exists, checked with a prefix listing rather than HeadObject. The release role may
 * only list its own prefixes, and without unconditional s3:ListBucket, S3 answers HeadObject on a
 * missing key with 403 instead of 404 — indistinguishable from a real permissions problem.
 */
export async function objectExists(s3: S3Client, bucket: string, key: string): Promise<boolean> {
  const { Contents = [] } = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: key, MaxKeys: 1 }),
  );
  return Contents.some((object) => object.Key === key);
}

/** Runs `task` over `items` with at most `limit` in flight. */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await task(item);
    }
  });
  await Promise.all(workers);
}
