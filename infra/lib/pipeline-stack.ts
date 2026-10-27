import type { AppDescriptor } from '@govcloud-mfe/contracts';
import { Aws, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { BUILD_IMAGE, bakeSpec, buildSpec, deploySpec } from './buildspecs';
import type { SourceConfig, StageConfig } from './config';
import { naming } from './naming';

export interface PipelineStackProps extends StackProps {
  readonly app: AppDescriptor;
  readonly source: SourceConfig;
  /** Promotion order, e.g. [dev, prod]. */
  readonly stages: StageConfig[];
}

/** How long production watches real-user errors before a release counts as good. */
const PROD_BAKE_MINUTES = 10;

/**
 * One pipeline per app, so each team ships and rolls back on its own:
 *
 *   Source ─▶ Build ─▶ Deploy-dev ─▶ Approve-prod ─▶ Deploy-prod (deploy, bake)
 *
 * Rollback is automatic: a failed deploy or bake rolls the stage back to the last successful
 * execution. A person can trigger the same thing with `aws codepipeline rollback-stage`, or use
 * the release CLI's `rollback` command as a break-glass option when the pipeline itself is broken.
 */
export class PipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);
    const { app, source, stages } = props;

    const sourceOutput = new codepipeline.Artifact('Source');
    const releaseBundle = new codepipeline.Artifact('ReleaseBundle');

    const sourceAction = new actions.CodeStarConnectionsSourceAction({
      actionName: 'Source',
      connectionArn: source.connectionArn,
      owner: source.owner,
      repo: source.repo,
      branch: source.branch,
      output: sourceOutput,
      // The pipeline-level trigger below starts executions, filtered to this app's paths.
      triggerOnPush: false,
    });

    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: naming.pipeline(app.name),
      // V2 is required for path-filtered triggers and stage conditions (automatic rollback).
      pipelineType: codepipeline.PipelineType.V2,
      // Every action runs in this account; stage accounts are reached by assuming roles from CodeBuild.
      crossAccountKeys: false,
      triggers: [
        {
          providerType: codepipeline.ProviderType.CODE_STAR_SOURCE_CONNECTION,
          gitConfiguration: {
            sourceAction,
            pushFilter: [
              {
                branchesIncludes: [source.branch],
                // In the monorepo, only changes that can affect this app's output start its pipeline.
                filePathsIncludes: [
                  `apps/${app.name}/**`,
                  'packages/**',
                  'tools/release/**',
                  'infra/**',
                  'pnpm-lock.yaml',
                  'pnpm-workspace.yaml',
                ],
              },
            ],
          },
        },
      ],
    });

    pipeline.addStage({ stageName: 'Source', actions: [sourceAction] });

    pipeline.addStage({
      stageName: 'Build',
      actions: [
        new actions.CodeBuildAction({
          actionName: 'Build',
          project: new codebuild.PipelineProject(this, 'BuildProject', {
            projectName: `${naming.pipeline(app.name)}-build`,
            environment: { buildImage: BUILD_IMAGE, computeType: codebuild.ComputeType.MEDIUM },
            buildSpec: buildSpec(app),
          }),
          input: sourceOutput,
          outputs: [releaseBundle],
          environmentVariables: { COMMIT_ID: { value: sourceAction.variables.commitId } },
        }),
      ],
    });

    const deployRole = this.createDeployRole(app, stages);
    const deployProject = new codebuild.PipelineProject(this, 'DeployProject', {
      projectName: `${naming.pipeline(app.name)}-deploy`,
      role: deployRole,
      environment: { buildImage: BUILD_IMAGE },
      buildSpec: deploySpec(app),
    });
    const bakeProject = new codebuild.PipelineProject(this, 'BakeProject', {
      projectName: `${naming.pipeline(app.name)}-bake`,
      role: deployRole,
      environment: { buildImage: BUILD_IMAGE, computeType: codebuild.ComputeType.SMALL },
      buildSpec: bakeSpec(),
    });

    for (const stage of stages) {
      const stageVariables = {
        STAGE: { value: stage.name },
        STAGE_REGION: { value: stage.region },
        RELEASE_ROLE_ARN: { value: releaseRoleArn(app, stage) },
      };

      if (stage.production) {
        pipeline.addStage({
          stageName: `Approve-${stage.name}`,
          actions: [
            new actions.ManualApprovalAction({
              actionName: 'Approve',
              additionalInformation: `Promote ${app.displayName} to ${stage.name}?`,
            }),
          ],
        });
      }

      const stageActions: codepipeline.IAction[] = [
        new actions.CodeBuildAction({
          actionName: 'Deploy',
          project: deployProject,
          input: releaseBundle,
          environmentVariables: stageVariables,
          runOrder: 1,
        }),
      ];
      if (stage.production) {
        stageActions.push(
          new actions.CodeBuildAction({
            actionName: 'Bake',
            project: bakeProject,
            input: releaseBundle,
            environmentVariables: {
              ...stageVariables,
              ALARM_NAME: { value: naming.clientErrorsAlarm(app.name, stage.name) },
              BAKE_MINUTES: { value: String(PROD_BAKE_MINUTES) },
            },
            runOrder: 2,
          }),
        );
      }

      pipeline.addStage({
        stageName: `Deploy-${stage.name}`,
        actions: stageActions,
        // If any action fails (deploy or bake), CodePipeline redeploys this stage with the artifacts
        // of the last successful execution: the previous AppStack and the previous version.
        onFailure: { result: codepipeline.Result.ROLLBACK },
      });
    }

    Tags.of(this).add('app', app.name);
    Tags.of(this).add('owner', app.owner);
  }

  /**
   * Identity of the deploy and bake steps. It has no direct permissions in stage accounts. It can
   * only assume (a) the CDK bootstrap roles, to deploy the AppStack, and (b) this app's release
   * roles, which trust exactly this role by name.
   */
  private createDeployRole(app: AppDescriptor, stages: StageConfig[]): iam.Role {
    const role = new iam.Role(this, 'DeployRole', {
      roleName: naming.pipelineDeployRole(app.name),
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: stages.flatMap((stage) => [
          releaseRoleArn(app, stage),
          // Default bootstrap qualifier. Covers the deploy, file-publishing and lookup roles.
          `arn:${Aws.PARTITION}:iam::${stage.account}:role/cdk-hnb659fds-*`,
        ]),
      }),
    );
    return role;
  }
}

function releaseRoleArn(app: AppDescriptor, stage: StageConfig): string {
  return `arn:${Aws.PARTITION}:iam::${stage.account}:role/${naming.releaseRole(app.name, stage.name)}`;
}
