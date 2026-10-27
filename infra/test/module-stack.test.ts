import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, it } from 'vitest';
import { ModuleStack } from '../lib/module-stack';
import { createTestApp, moduleDescriptor, stage } from './helpers';

describe('ModuleStack', () => {
  let template: Template;

  beforeAll(() => {
    const { app, config } = createTestApp();
    const prod = stage(config.stages, 'prod');
    const stack = new ModuleStack(app, 'Module-dashboard', {
      env: { account: prod.account, region: prod.region },
      module: moduleDescriptor('dashboard'),
      stage: prod,
    });
    template = Template.fromStack(stack);
  });

  it("gives the module its own AppConfig application with the team's flags", () => {
    template.hasResourceProperties('AWS::AppConfig::Application', {
      Name: 'govcloud-mfe-dashboard',
    });
    template.hasResourceProperties('AWS::AppConfig::ConfigurationProfile', {
      Name: 'feature-flags',
      Type: 'AWS.AppConfig.FeatureFlags',
    });
    template.resourceCountIs('AWS::AppConfig::Deployment', 1);
  });

  it("rolls flag changes back on the module's own alarm", () => {
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'govcloud-mfe-dashboard-prod-client-errors',
      Namespace: 'GovcloudMfe/Frontend',
      MetricName: 'ClientErrors',
      Dimensions: [{ Name: 'App', Value: 'dashboard' }],
    });
    template.hasResourceProperties('AWS::AppConfig::Environment', {
      Name: 'prod',
      Monitors: [
        Match.objectLike({
          AlarmArn: { 'Fn::GetAtt': [Match.stringLikeRegexp('ClientErrorsAlarm'), 'Arn'] },
        }),
      ],
    });
  });

  it('has no release role: modules publish nothing on their own', () => {
    template.resourceCountIs('AWS::IAM::Role', 1); // only AppConfig's role for reading the alarm
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [Match.objectLike({ Principal: { Service: 'appconfig.amazonaws.com' } })],
      },
    });
  });
});
