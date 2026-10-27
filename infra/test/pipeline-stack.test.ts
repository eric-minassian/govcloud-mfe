import { Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { PipelineStack } from '../lib/pipeline-stack';
import { appDescriptor, createTestApp } from './helpers';

interface StageDeclaration {
  Name: string;
  Actions: { Name: string; RunOrder?: number }[];
  OnFailure?: { Result: string };
}

/** The parts of AWS::CodePipeline::Pipeline these tests look at. */
interface PipelineProperties {
  PipelineType: string;
  Triggers: { GitConfiguration: { Push: { FilePaths: { Includes: string[] } }[] } }[];
  Stages: StageDeclaration[];
}

describe('PipelineStack', () => {
  let pipeline: PipelineProperties;

  beforeAll(() => {
    const { app, config } = createTestApp();
    const stack = new PipelineStack(app, 'Pipeline', {
      env: config.tooling,
      app: appDescriptor('dashboard'),
      source: config.source,
      stages: config.stages,
    });
    const pipelines = Template.fromStack(stack).findResources('AWS::CodePipeline::Pipeline');
    pipeline = Object.values(pipelines)[0]?.Properties as PipelineProperties;
  });

  it('is a V2 pipeline triggered only by changes that affect the app', () => {
    expect(pipeline.PipelineType).toBe('V2');
    const filePaths = pipeline.Triggers[0]?.GitConfiguration.Push[0]?.FilePaths.Includes ?? [];
    expect(filePaths).toContain('apps/dashboard/**');
    expect(filePaths).toContain('packages/**');
    expect(filePaths.join()).not.toMatch(/apps\/(shell|settings)/);
  });

  it('promotes through dev, a manual approval, then prod', () => {
    const stageNames = pipeline.Stages.map((s) => s.Name);
    expect(stageNames).toEqual(['Source', 'Build', 'Deploy-dev', 'Approve-prod', 'Deploy-prod']);
  });

  it('rolls every deploy stage back automatically when it fails', () => {
    const deployStages = pipeline.Stages.filter((s: StageDeclaration) =>
      s.Name.startsWith('Deploy-'),
    );
    for (const stage of deployStages) {
      expect(stage.OnFailure).toEqual({ Result: 'ROLLBACK' });
    }
  });

  it('bakes production after deploying, so an alarm during the bake triggers the rollback', () => {
    const prod = pipeline.Stages.find((s) => s.Name === 'Deploy-prod');
    expect(prod?.Actions.map((a) => [a.Name, a.RunOrder])).toEqual([
      ['Deploy', 1],
      ['Bake', 2],
    ]);
  });
});
