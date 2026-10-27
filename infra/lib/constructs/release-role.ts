import { Aws } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { naming } from '../naming';

export interface ReleaseRoleProps {
  readonly appName: string;
  readonly kind: 'shell' | 'remote';
  readonly stageName: string;
  readonly toolingAccount: string;
  /** Watched by the pipeline's bake step. */
  readonly alarmArn: string;
}

/**
 * The only identity allowed to change what's live for one app in one stage. The pipeline assumes
 * it to run the release CLI (publish, promote, rollback) and to watch the app's alarm while baking.
 * It can't touch other apps' files, so a broken pipeline can only break its own app.
 */
export class ReleaseRole extends Construct {
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: ReleaseRoleProps) {
    super(scope, id);
    const { appName, stageName } = props;

    // Resolved at deploy time from the parameter the platform stack publishes. No cross-stack
    // export means the platform and each app can be deployed independently.
    const bucketParameterName = naming.assetsBucketParameter(stageName);
    const bucket = s3.Bucket.fromBucketName(
      this,
      'ArtifactBucket',
      ssm.StringParameter.valueForStringParameter(this, bucketParameterName),
    );

    const pipelineDeployRoleArn = `arn:${Aws.PARTITION}:iam::${props.toolingAccount}:role/${naming.pipelineDeployRole(appName)}`;
    this.role = new iam.Role(this, 'Role', {
      roleName: naming.releaseRole(appName, stageName),
      description: `Publishes and promotes ${appName} releases in ${stageName}`,
      // Trust the tooling account and require the exact role ARN in a condition. Unlike a role-ARN
      // principal, this doesn't need the role to exist first and still works after it is recreated.
      assumedBy: new iam.AccountPrincipal(props.toolingAccount).withConditions({
        ArnEquals: { 'aws:PrincipalArn': pipelineDeployRoleArn },
      }),
    });

    const releaseRecord = `releases/${appName}.json`;
    const ownObjects = [bucket.arnForObjects(`apps/${appName}/*`)];
    if (props.kind === 'shell') {
      // The shell's promote step also copies its index.html to the bucket root, where nginx serves it.
      ownObjects.push(bucket.arnForObjects('index.html'));
    }

    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PublishOwnBuilds',
        actions: ['s3:PutObject', 's3:GetObject'],
        resources: ownObjects,
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
        sid: 'ListOwnPrefixesAndReleaseHistory',
        actions: ['s3:ListBucket', 's3:ListBucketVersions'],
        resources: [bucket.bucketArn],
        conditions: { StringLike: { 's3:prefix': [`apps/${appName}/*`, releaseRecord] } },
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'WatchAlarmWhileBaking',
        actions: ['cloudwatch:DescribeAlarms'],
        resources: [props.alarmArn],
      }),
    );
    ssm.StringParameter.fromStringParameterName(
      this,
      'BucketParameter',
      bucketParameterName,
    ).grantRead(this.role);
  }
}
