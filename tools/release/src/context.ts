import { S3Client } from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';

export interface ReleaseContextOptions {
  stage: string;
  region: string;
  roleArn?: string;
  bucket?: string;
}

/** Everything a release command needs: which stage, and a client for its artifact bucket. */
export interface ReleaseContext {
  stage: string;
  bucket: string;
  s3: S3Client;
  /** Recorded in the release record. CloudTrail has the authoritative principal. */
  releasedBy: string;
  log: (message: string) => void;
}

/**
 * Builds a context for one stage. In the pipeline, `--role-arn` is the stage's release role, which
 * can write builds and the release pointer and nothing else.
 */
export async function createReleaseContext(
  options: ReleaseContextOptions,
): Promise<ReleaseContext> {
  const credentials = options.roleArn
    ? fromTemporaryCredentials({
        params: { RoleArn: options.roleArn, RoleSessionName: `release-web-${options.stage}` },
        clientConfig: { region: options.region },
      })
    : undefined;
  const clientConfig = { region: options.region, credentials };

  const bucket =
    options.bucket ?? (await lookupBucketName(new SSMClient(clientConfig), options.stage));

  return {
    stage: options.stage,
    bucket,
    s3: new S3Client(clientConfig),
    releasedBy: process.env.CODEBUILD_BUILD_ARN ?? `${process.env.USER ?? 'unknown'} (manual)`,
    log: (message) => console.log(`[web/${options.stage}] ${message}`),
  };
}

/** The platform stack publishes the bucket name to SSM so tools don't hardcode it. */
async function lookupBucketName(ssm: SSMClient, stage: string): Promise<string> {
  const name = `/govcloud-mfe/${stage}/assets-bucket-name`;
  const { Parameter } = await ssm.send(new GetParameterCommand({ Name: name }));
  if (!Parameter?.Value) throw new Error(`SSM parameter ${name} is empty`);
  return Parameter.Value;
}
