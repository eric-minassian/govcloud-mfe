import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import type * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface ArtifactBucketProps {
  /** The S3 gateway endpoint nginx reads through. Only requests via this endpoint may read assets. */
  readonly edgeEndpoint: ec2.IGatewayVpcEndpoint;
}

/**
 * Holds every composed build plus the release pointer (docs/contracts.md §3).
 * There is no CloudFront in GovCloud, so nginx proxies to this bucket from inside the VPC.
 */
export class ArtifactBucket extends Construct {
  readonly bucket: s3.Bucket;
  /** Also used for ALB access logs (which only support SSE-S3 buckets). */
  readonly logsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: ArtifactBucketProps) {
    super(scope, id);

    this.logsBucket = new s3.Bucket(this, 'Logs', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      lifecycleRules: [{ expiration: Duration.days(365) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.bucket = new s3.Bucket(this, 'Bucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      // SSE-S3, not SSE-KMS: nginx reads anonymously through the VPC endpoint, and anonymous
      // requests cannot use a KMS key to decrypt objects.
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // Versioning turns the object history of releases/web.json into the release history
      // that rollbacks read.
      versioned: true,
      lifecycleRules: [
        {
          // Build output is never overwritten, so this only trims old release pointers.
          // Current objects (every build) are kept so open tabs never 404.
          noncurrentVersionExpiration: Duration.days(90),
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
      serverAccessLogsBucket: this.logsBucket,
      serverAccessLogsPrefix: 's3-artifacts/',
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // nginx sends unsigned requests, so it needs no AWS credentials or SigV4 support. Only builds and
    // the entry document are readable this way. Release records stay private.
    // Block Public Access still applies in full: S3 does not count a policy as public when it is
    // limited to a fixed aws:SourceVpce.
    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowEdgeReadsThroughVpcEndpoint',
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:GetObject'],
        resources: [this.bucket.arnForObjects('builds/*'), this.bucket.arnForObjects('index.html')],
        conditions: { StringEquals: { 'aws:SourceVpce': props.edgeEndpoint.vpcEndpointId } },
      }),
    );
  }
}
