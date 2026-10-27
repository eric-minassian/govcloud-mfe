import type { ModuleDescriptor } from '@govcloud-mfe/contracts';
import { Aws, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as actions from 'aws-cdk-lib/aws-codepipeline-actions';
import type { Construct } from 'constructs';
import type { SourceConfig, StageConfig } from './config';
import { naming, PLATFORM_TEAM, WEB_APP } from './naming';
import { bakeSpec, deliveryBuildSpec, deliveryDeploySpec } from './pipelines/buildspecs';
import { ChecksPipeline } from './pipelines/checks-pipeline';
import {
  BUILD_IMAGE,
  cdkBootstrapRolesArn,
  connectionSource,
  createDeployRole,
} from './pipelines/common';

export interface WebPipelineStackProps extends StackProps {
  readonly source: SourceConfig;
  /** Promotion order, e.g. [dev, prod]. */
  readonly stages: StageConfig[];
  /** Every module compiled into the app; the production bake watches each one's alarm. */
  readonly modules: ModuleDescriptor[];
}

/** How long production watches real-user errors before a release counts as good. */
const PROD_BAKE_MINUTES = 10;

/**
 * The platform team's pipelines:
 *
 * 1. **Delivery** (`govcloud-mfe-web`) — the release train. Every merge to main that changes the
 *    app, any module's code or shared code is compiled into one build and shipped:
 *
 *      Source ─▶ Build ─▶ Deploy-dev ─▶ Approve-prod ─▶ Deploy-prod (deploy, bake)
 *
 *    A failed deploy or bake rolls the stage back to the last successful execution. Because every
 *    module ships together, a rollback undoes every change in the release, not just the faulty one.
 *
 * 2. **Platform checks** (`govcloud-mfe-web-checks`) — the pull-request gate for the web app, shared
 *    packages and tooling. Modules have their own gates (ModulePipelineStack).
 */
export class WebPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: WebPipelineStackProps) {
    super(scope, id, props);

    this.createDeliveryPipeline(props);

    new ChecksPipeline(this, 'Checks', {
      pipelineName: naming.webChecksPipeline,
      source: props.source,
      filePathsIncludes: [
        'apps/web/**',
        'packages/**',
        'tools/**',
        'infra/**',
        'turbo.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
      ],
      commands: [
        'pnpm lint',
        'pnpm turbo run typecheck test build --filter=@govcloud-mfe/web... --filter=@govcloud-mfe/infra',
      ],
    });

    Tags.of(this).add('app', WEB_APP);
    Tags.of(this).add('owner', PLATFORM_TEAM);
  }

  private createDeliveryPipeline({ source, stages, modules }: WebPipelineStackProps) {
    const sourceOutput = new codepipeline.Artifact('Source');
    const releaseBundle = new codepipeline.Artifact('ReleaseBundle');
    const sourceAction = connectionSource(source, sourceOutput);

    const pipeline = new codepipeline.Pipeline(this, 'Delivery', {
      pipelineName: naming.deliveryPipeline,
      // V2 is required for path-filtered triggers and stage conditions (automatic rollback).
      pipelineType: codepipeline.PipelineType.V2,
      // A newer execution overtakes an older one waiting at a stage boundary, so the train carries
      // everything merged since the last departure instead of queueing one execution per merge.
      executionMode: codepipeline.ExecutionMode.SUPERSEDED,
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
                filePathsIncludes: [
                  'apps/web/**',
                  'modules/**',
                  'packages/**',
                  'tools/release/**',
                  'infra/**',
                  'pnpm-lock.yaml',
                  'pnpm-workspace.yaml',
                  'turbo.json',
                ],
                // Flag changes ride the module's own flags pipeline, not the train: they change no
                // compiled code, and shipping them here would let one team's merge redeploy
                // another team's flags.
                filePathsExcludes: ['modules/*/feature-flags.json'],
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
            projectName: `${naming.deliveryPipeline}-build`,
            environment: { buildImage: BUILD_IMAGE, computeType: codebuild.ComputeType.LARGE },
            buildSpec: deliveryBuildSpec(),
          }),
          input: sourceOutput,
          outputs: [releaseBundle],
          environmentVariables: { COMMIT_ID: { value: sourceAction.variables.commitId } },
        }),
      ],
    });

    const deployRole = createDeployRole(
      this,
      naming.deliveryDeployRole,
      stages.flatMap((stage) => [releaseRoleArn(stage), cdkBootstrapRolesArn(stage)]),
    );
    const deployProject = new codebuild.PipelineProject(this, 'DeployProject', {
      projectName: `${naming.deliveryPipeline}-deploy`,
      role: deployRole,
      environment: { buildImage: BUILD_IMAGE },
      buildSpec: deliveryDeploySpec(),
    });
    const bakeProject = new codebuild.PipelineProject(this, 'BakeProject', {
      projectName: `${naming.deliveryPipeline}-bake`,
      role: deployRole,
      environment: { buildImage: BUILD_IMAGE, computeType: codebuild.ComputeType.SMALL },
      buildSpec: bakeSpec(),
    });

    for (const stage of stages) {
      const stageVariables = {
        STAGE: { value: stage.name },
        STAGE_REGION: { value: stage.region },
        RELEASE_ROLE_ARN: { value: releaseRoleArn(stage) },
      };

      if (stage.production) {
        pipeline.addStage({
          stageName: `Approve-${stage.name}`,
          actions: [
            new actions.ManualApprovalAction({
              actionName: 'Approve',
              additionalInformation: `Release the web app (all modules) to ${stage.name}?`,
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
              ALARMS: { value: JSON.stringify(watchedAlarms(stage, modules)) },
              BAKE_MINUTES: { value: String(PROD_BAKE_MINUTES) },
            },
            runOrder: 2,
          }),
        );
      }

      pipeline.addStage({
        stageName: `Deploy-${stage.name}`,
        actions: stageActions,
        // If the deploy or the bake fails, CodePipeline redeploys this stage with the artifacts of
        // the last successful execution: the previous WebStack and the previous build.
        onFailure: { result: codepipeline.Result.ROLLBACK },
      });
    }
  }
}

function releaseRoleArn(stage: StageConfig): string {
  return `arn:${Aws.PARTITION}:iam::${stage.account}:role/${naming.releaseRole(stage.name)}`;
}

/** The web alarm plus every module's, with the owner to page when one fires. */
function watchedAlarms(stage: StageConfig, modules: ModuleDescriptor[]) {
  return [
    { app: WEB_APP, owner: PLATFORM_TEAM },
    ...modules.map((module) => ({ app: module.name, owner: module.owner })),
  ].map(({ app, owner }) => ({ alarm: naming.clientErrorsAlarm(app, stage.name), app, owner }));
}
