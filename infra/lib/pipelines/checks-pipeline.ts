import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as actions from 'aws-cdk-lib/aws-codepipeline-actions';
import { Construct } from 'constructs';
import type { SourceConfig } from '../config';
import { checksSpec } from './buildspecs';
import { BUILD_IMAGE, connectionSource } from './common';

export interface ChecksPipelineProps {
  readonly pipelineName: string;
  readonly source: SourceConfig;
  /** Only pull requests that touch these paths start the pipeline (max 8 patterns). */
  readonly filePathsIncludes: string[];
  readonly commands: string[];
}

/**
 * A team's pull-request gate: runs when a pull request into the main branch touches the team's
 * paths, and fails if the change breaks the team's code or the composed app.
 *
 * PARALLEL execution mode, because pull requests are independent of each other: one PR's run must
 * not supersede or queue behind another's.
 *
 * CodePipeline doesn't post commit statuses back to GitHub. To make this a *required* check, add an
 * EventBridge rule on this pipeline's execution state changes that invokes a small Lambda calling
 * the GitHub commit statuses API (out of scope for the POC).
 */
export class ChecksPipeline extends Construct {
  constructor(scope: Construct, id: string, props: ChecksPipelineProps) {
    super(scope, id);

    const sourceOutput = new codepipeline.Artifact('Source');
    const sourceAction = connectionSource(props.source, sourceOutput);

    new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: props.pipelineName,
      pipelineType: codepipeline.PipelineType.V2,
      executionMode: codepipeline.ExecutionMode.PARALLEL,
      crossAccountKeys: false,
      triggers: [
        {
          providerType: codepipeline.ProviderType.CODE_STAR_SOURCE_CONNECTION,
          gitConfiguration: {
            sourceAction,
            pullRequestFilter: [
              {
                events: [
                  codepipeline.GitPullRequestEvent.OPEN,
                  codepipeline.GitPullRequestEvent.UPDATED,
                ],
                branchesIncludes: [props.source.branch],
                filePathsIncludes: props.filePathsIncludes,
              },
            ],
          },
        },
      ],
      stages: [
        { stageName: 'Source', actions: [sourceAction] },
        {
          stageName: 'Verify',
          actions: [
            new actions.CodeBuildAction({
              actionName: 'Verify',
              input: sourceOutput,
              project: new codebuild.PipelineProject(this, 'Project', {
                projectName: props.pipelineName,
                environment: { buildImage: BUILD_IMAGE, computeType: codebuild.ComputeType.MEDIUM },
                buildSpec: checksSpec(props.commands),
              }),
            }),
          ],
        },
      ],
    });
  }
}
