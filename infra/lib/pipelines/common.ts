import { createRequire } from 'node:module';
import { Aws } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import type * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import type { SourceConfig, StageConfig } from '../config';

/**
 * Deploy with the same CDK CLI version that synthesized the cloud assembly, so the CLI always
 * understands the assembly's schema.
 */
export const CDK_CLI_VERSION: string = createRequire(import.meta.url)(
  'aws-cdk/package.json',
).version;

/** Node.js 24 is available on the Ubuntu standard:7.0 CodeBuild image. */
export const BUILD_IMAGE = codebuild.LinuxBuildImage.STANDARD_7_0;

/**
 * The monorepo, via CodeConnections. In GovCloud, CodeConnections only exists in us-gov-east-1,
 * which is why the tooling account lives there (alternatives: an S3 source fed by external CI, or
 * CodeCommit). Executions are started by each pipeline's own path-filtered trigger, never by the
 * action's default "any push" behaviour.
 */
export function connectionSource(
  source: SourceConfig,
  output: codepipeline.Artifact,
): actions.CodeStarConnectionsSourceAction {
  return new actions.CodeStarConnectionsSourceAction({
    actionName: 'Source',
    connectionArn: source.connectionArn,
    owner: source.owner,
    repo: source.repo,
    branch: source.branch,
    output,
    triggerOnPush: false,
  });
}

/** Default bootstrap qualifier. Covers the deploy, file-publishing and lookup roles. */
export function cdkBootstrapRolesArn(stage: StageConfig): string {
  return `arn:${Aws.PARTITION}:iam::${stage.account}:role/cdk-hnb659fds-*`;
}

/**
 * Identity of a pipeline's deploy steps. It has no direct permissions in stage accounts; it can
 * only assume the roles listed here (CDK bootstrap roles, and for the delivery pipeline the
 * release roles, which trust exactly this role by name).
 */
export function createDeployRole(
  scope: Construct,
  roleName: string,
  assumableRoleArns: string[],
): iam.Role {
  const role = new iam.Role(scope, 'DeployRole', {
    roleName,
    assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
  });
  role.addToPolicy(
    new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: assumableRoleArns }),
  );
  return role;
}
