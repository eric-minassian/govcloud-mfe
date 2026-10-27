import { Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { ModulePipelineStack } from '../lib/module-pipeline-stack';
import { buildSpecOf, createTestApp, moduleDescriptor, pipelineNamed } from './helpers';

describe('ModulePipelineStack', () => {
  let template: Template;

  beforeAll(() => {
    const { app, config } = createTestApp();
    const stack = new ModulePipelineStack(app, 'DashboardPipelines', {
      env: config.tooling,
      module: moduleDescriptor('dashboard'),
      source: config.source,
      stages: config.stages,
    });
    template = Template.fromStack(stack);
  });

  it("gates pull requests that touch the team's module, in parallel", () => {
    const checks = pipelineNamed(template, 'govcloud-mfe-dashboard-checks');
    const pullRequest = checks.Triggers[0]?.GitConfiguration.PullRequest?.[0];

    expect(checks.ExecutionMode).toBe('PARALLEL');
    expect(pullRequest?.Events).toEqual(['OPEN', 'UPDATED']);
    expect(pullRequest?.FilePaths.Includes).toEqual(['modules/dashboard/**']);
    expect(checks.Triggers[0]?.GitConfiguration.Push).toBeUndefined();
  });

  it('proves the whole app still builds with the change', () => {
    expect(buildSpecOf(template, 'govcloud-mfe-dashboard-checks')).toContain(
      'pnpm turbo run build --filter=@govcloud-mfe/web',
    );
  });

  it("deploys the module's flags on its own, and nothing else", () => {
    const flags = pipelineNamed(template, 'govcloud-mfe-dashboard-flags');
    expect(flags.Triggers[0]?.GitConfiguration.Push?.[0]?.FilePaths.Includes).toContain(
      'modules/dashboard/feature-flags.json',
    );
    expect(flags.Stages.map((s) => s.Name)).toEqual([
      'Source',
      'Synth',
      'Deploy-dev',
      'Approve-prod',
      'Deploy-prod',
    ]);
    expect(buildSpecOf(template, 'govcloud-mfe-dashboard-flags-synth')).toContain(
      '-c target=module:dashboard',
    );
    const deploy = buildSpecOf(template, 'govcloud-mfe-dashboard-flags-deploy');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: ${STAGE} is expanded by bash in the buildspec
    expect(deploy).toContain('GovcloudMfe-${STAGE}-Module-dashboard');
    expect(deploy).not.toMatch(/-Web\b/);
  });
});
