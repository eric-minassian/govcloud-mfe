import { Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadModules } from '../lib/paths';
import { WebPipelineStack } from '../lib/web-pipeline-stack';
import { buildSpecOf, createTestApp, type PipelineProperties, pipelineNamed } from './helpers';

describe('WebPipelineStack', () => {
  let template: Template;
  let delivery: PipelineProperties;

  beforeAll(() => {
    const { app, config } = createTestApp();
    const stack = new WebPipelineStack(app, 'WebPipeline', {
      env: config.tooling,
      source: config.source,
      stages: config.stages,
      modules: loadModules(),
    });
    template = Template.fromStack(stack);
    delivery = pipelineNamed(template, 'govcloud-mfe-web');
  });

  it("ships every module's code, but not the modules' flags", () => {
    const filePaths = delivery.Triggers[0]?.GitConfiguration.Push?.[0]?.FilePaths;
    expect(filePaths?.Includes).toEqual(
      expect.arrayContaining(['apps/web/**', 'modules/**', 'packages/**']),
    );
    expect(filePaths?.Excludes).toEqual(['modules/*/feature-flags.json']);
  });

  it('promotes through dev, a manual approval, then prod with a bake', () => {
    expect(delivery.Stages.map((s) => s.Name)).toEqual([
      'Source',
      'Build',
      'Deploy-dev',
      'Approve-prod',
      'Deploy-prod',
    ]);
    const prod = delivery.Stages.find((s) => s.Name === 'Deploy-prod');
    expect(prod?.Actions.map((a) => a.Name)).toEqual(['Deploy', 'Bake']);
  });

  it('rolls every deploy stage back automatically when it fails', () => {
    for (const stage of delivery.Stages.filter((s) => s.Name.startsWith('Deploy-'))) {
      expect(stage.OnFailure).toEqual({ Result: 'ROLLBACK' });
    }
  });

  it('deploys only the WebStack, never a module stack', () => {
    const deploy = buildSpecOf(template, 'govcloud-mfe-web-deploy');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: ${STAGE} is expanded by bash in the buildspec
    expect(deploy).toContain('GovcloudMfe-${STAGE}-Web');
    expect(deploy).not.toContain('Module');
    expect(buildSpecOf(template, 'govcloud-mfe-web-build')).toContain('-c target=web');
  });

  it('runs platform pull-request checks in parallel, one execution per PR', () => {
    const checks = pipelineNamed(template, 'govcloud-mfe-web-checks');
    expect(checks.ExecutionMode).toBe('PARALLEL');
    expect(checks.Triggers[0]?.GitConfiguration.PullRequest?.[0]?.FilePaths.Includes).toContain(
      'packages/**',
    );
  });
});
