import type { ModuleDescriptor } from '@govcloud-mfe/contracts';
import { Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as actions from 'aws-cdk-lib/aws-codepipeline-actions';
import type { Construct } from 'constructs';
import type { SourceConfig, StageConfig } from './config';
import { naming } from './naming';
import { moduleDeploySpec, moduleSynthSpec } from './pipelines/buildspecs';
import { ChecksPipeline } from './pipelines/checks-pipeline';
import {
  BUILD_IMAGE,
  cdkBootstrapRolesArn,
  connectionSource,
  createDeployRole,
} from './pipelines/common';

export interface ModulePipelineStackProps extends StackProps {
  readonly module: ModuleDescriptor;
  readonly source: SourceConfig;
  /** Promotion order, e.g. [dev, prod]. */
  readonly stages: StageConfig[];
}

/**
 * The pipelines one team owns for its module. The module's *code* ships on the shared delivery
 * pipeline; what the team controls on its own is:
 *
 * 1. **Checks** (`govcloud-mfe-<module>-checks`) — its pull-request gate. Runs the module's own
 *    lint, typecheck and tests, and builds the whole app to prove the change still composes.
 *
 * 2. **Flags** (`govcloud-mfe-<module>-flags`) — its release controls. A merge that changes the
 *    module's feature flags deploys its ModuleStack, independently of every other team:
 *
 *      Source ─▶ Synth ─▶ Deploy-dev ─▶ Approve-prod ─▶ Deploy-prod
 *
 *    There is no bake action: in each stage, AppConfig rolls the change out with the module's
 *    deployment strategy and reverts it by itself if the module's alarm fires.
 */
export class ModulePipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: ModulePipelineStackProps) {
    super(scope, id, props);
    const { module } = props;

    new ChecksPipeline(this, 'Checks', {
      pipelineName: naming.moduleChecksPipeline(module.name),
      source: props.source,
      filePathsIncludes: [`modules/${module.name}/**`],
      commands: [
        'pnpm lint',
        `pnpm turbo run typecheck test --filter=@govcloud-mfe/${module.name}`,
        // The module is only ever released inside the composed app, so that's what has to build.
        'pnpm turbo run build --filter=@govcloud-mfe/web',
      ],
    });

    this.createFlagsPipeline(props);

    Tags.of(this).add('module', module.name);
    Tags.of(this).add('owner', module.owner);
  }

  private createFlagsPipeline({ module, source, stages }: ModulePipelineStackProps) {
    const sourceOutput = new codepipeline.Artifact('Source');
    const moduleBundle = new codepipeline.Artifact('ModuleBundle');
    const sourceAction = connectionSource(source, sourceOutput);

    const pipeline = new codepipeline.Pipeline(this, 'Flags', {
      pipelineName: naming.moduleFlagsPipeline(module.name),
      pipelineType: codepipeline.PipelineType.V2,
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
                  `modules/${module.name}/feature-flags.json`,
                  `modules/${module.name}/module.json`,
                  // Changes to how module stacks are defined roll out to every module's stacks.
                  'infra/lib/module-stack.ts',
                  'infra/lib/constructs/feature-flags-app.ts',
                ],
              },
            ],
          },
        },
      ],
    });

    pipeline.addStage({ stageName: 'Source', actions: [sourceAction] });
    pipeline.addStage({
      stageName: 'Synth',
      actions: [
        new actions.CodeBuildAction({
          actionName: 'Synth',
          input: sourceOutput,
          outputs: [moduleBundle],
          project: new codebuild.PipelineProject(this, 'SynthProject', {
            projectName: `${naming.moduleFlagsPipeline(module.name)}-synth`,
            environment: { buildImage: BUILD_IMAGE },
            buildSpec: moduleSynthSpec(module.name),
          }),
        }),
      ],
    });

    // Deploys through the stage accounts' CDK bootstrap roles. Those roles can deploy any stack, so
    // a production setup would give each team its own bootstrap qualifier or a permissions boundary.
    const deployProject = new codebuild.PipelineProject(this, 'DeployProject', {
      projectName: `${naming.moduleFlagsPipeline(module.name)}-deploy`,
      role: createDeployRole(
        this,
        naming.moduleFlagsDeployRole(module.name),
        stages.map(cdkBootstrapRolesArn),
      ),
      environment: { buildImage: BUILD_IMAGE },
      buildSpec: moduleDeploySpec(module.name),
    });

    for (const stage of stages) {
      if (stage.production) {
        pipeline.addStage({
          stageName: `Approve-${stage.name}`,
          actions: [
            new actions.ManualApprovalAction({
              actionName: 'Approve',
              additionalInformation: `Deploy ${module.displayName} flag changes to ${stage.name}?`,
            }),
          ],
        });
      }
      pipeline.addStage({
        stageName: `Deploy-${stage.name}`,
        actions: [
          new actions.CodeBuildAction({
            actionName: 'Deploy',
            input: moduleBundle,
            project: deployProject,
            environmentVariables: { STAGE: { value: stage.name } },
          }),
        ],
        onFailure: { result: codepipeline.Result.ROLLBACK },
      });
    }
  }
}
