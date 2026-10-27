import { Aws } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { naming } from '../naming';

export interface ReleaseRoleProps {
  readonly stageName: string;
  readonly toolingAccount: string;
}

/**
 * The only identity allowed to change what's live in one stage. The delivery pipeline assumes it to
 * run the release CLI (publish, promote, rollback) and to watch every app's alarm while baking.
 * Modules have no equivalent: their code only reaches users inside a composed build.
 */
export class ReleaseRole extends Construct {
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: ReleaseRoleProps) {
    super(scope, id);
    const { stageName } = props;

    // Resolved at deploy time from the parameter the platform stack publishes. No cross-stack
    // export, so the platform and the web stack deploy independently.
    const bucketParameterName = naming.assetsBucketParameter(stageName);
    const bucket = s3.Bucket.fromBucketName(
      this,
      'ArtifactBucket',
      ssm.StringParameter.valueForStringParameter(this, bucketParameterName),
    );

    const deployRoleArn = `arn:${Aws.PARTITION}:iam::${props.toolingAccount}:role/${naming.deliveryDeployRole}`;
    this.role = new iam.Role(this, 'Role', {
      roleName: naming.releaseRole(stageName),
      description: `Publishes, promotes and bakes web releases in ${stageName}`,
      // Trust the tooling account and require the exact role ARN in a condition. Unlike a role-ARN
      // principal, this doesn't need the role to exist first and still works after it is recreated.
      assumedBy: new iam.AccountPrincipal(props.toolingAccount).withConditions({
        ArnEquals: { 'aws:PrincipalArn': deployRoleArn },
      }),
    });

    const releaseRecord = 'releases/web.json';
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PublishBuildsAndSwapEntryDocument',
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: [bucket.arnForObjects('builds/*'), bucket.arnForObjects('index.html')],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PromoteAndRollBack',
        actions: ['s3:PutObject', 's3:GetObject', 's3:GetObjectVersion'],
        resources: [bucket.arnForObjects(releaseRecord)],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ListBuildsAndReleaseHistory',
        actions: ['s3:ListBucket', 's3:ListBucketVersions'],
        resources: [bucket.bucketArn],
        conditions: { StringLike: { 's3:prefix': ['builds/*', releaseRecord] } },
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'WatchEveryAlarmWhileBaking',
        actions: ['cloudwatch:DescribeAlarms'],
        // The web alarm and every module's alarm in this stage: a release contains all of them.
        resources: [
          `arn:${Aws.PARTITION}:cloudwatch:${Aws.REGION}:${Aws.ACCOUNT_ID}:alarm:${naming.clientErrorsAlarm('*', stageName)}`,
        ],
      }),
    );
    ssm.StringParameter.fromStringParameterName(
      this,
      'BucketParameter',
      bucketParameterName,
    ).grantRead(this.role);
  }
}
