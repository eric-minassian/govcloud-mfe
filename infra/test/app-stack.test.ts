import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AppStack } from '../lib/app-stack';
import { appDescriptor, createTestApp, stage } from './helpers';

function synth(appName: string, stageName = 'prod') {
  const { app, config } = createTestApp();
  const target = stage(config.stages, stageName);
  const stack = new AppStack(app, `App-${appName}-${stageName}`, {
    env: { account: target.account, region: target.region },
    app: appDescriptor(appName),
    stage: target,
    toolingAccount: config.tooling.account,
  });
  return Template.fromStack(stack);
}

/** All statements of the release role's policy, with resources flattened to strings. */
function releaseRoleStatements(template: Template) {
  const policies = Object.values(template.findResources('AWS::IAM::Policy')).filter((policy) =>
    JSON.stringify(policy.Properties.Roles).includes('ReleaseRole'),
  );
  return policies
    .flatMap((policy) => policy.Properties.PolicyDocument.Statement)
    .map((s) => ({ ...s, Resource: JSON.stringify(s.Resource) }));
}

describe('AppStack', () => {
  it('gives the app its own AppConfig application, environment and feature-flag profile', () => {
    const template = synth('dashboard');
    template.hasResourceProperties('AWS::AppConfig::Application', {
      Name: 'govcloud-mfe-dashboard',
    });
    template.hasResourceProperties('AWS::AppConfig::Environment', {
      Name: 'prod',
      Monitors: [
        Match.objectLike({
          AlarmArn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^ClientErrorsAlarm'), 'Arn'] },
        }),
      ],
    });
    template.hasResourceProperties('AWS::AppConfig::ConfigurationProfile', {
      Name: 'feature-flags',
      Type: 'AWS.AppConfig.FeatureFlags',
    });
    template.resourceCountIs('AWS::AppConfig::Deployment', 1);
  });

  it('alarms on client errors reported for this app only', () => {
    synth('dashboard').hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'govcloud-mfe-dashboard-prod-client-errors',
      Namespace: 'GovcloudMfe/Frontend',
      MetricName: 'ClientErrors',
      Dimensions: [{ Name: 'App', Value: 'dashboard' }],
    });
  });

  it("limits a remote's release role to its own files", () => {
    const statements = releaseRoleStatements(synth('dashboard'));
    const s3Resources = statements.filter((s) => s.Resource.includes('s3')).map((s) => s.Resource);

    expect(s3Resources.join()).toContain('/apps/dashboard/*');
    expect(s3Resources.join()).toContain('/releases/dashboard.json');
    expect(s3Resources.join()).not.toContain('index.html');
    expect(s3Resources.join()).not.toMatch(/apps\/(shell|settings)/);
  });

  it("lets only the shell's release role replace index.html", () => {
    const statements = releaseRoleStatements(synth('shell'));
    expect(statements.map((s) => s.Resource).join()).toContain('/index.html');
  });

  it('is assumable only by the app pipeline deploy role in the tooling account', () => {
    synth('dashboard').hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'govcloud-mfe-dashboard-prod-release',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { AWS: 'arn:aws-us-gov:iam::111111111111:root' },
            Condition: {
              ArnEquals: {
                'aws:PrincipalArn': {
                  'Fn::Join': [
                    '',
                    [
                      'arn:',
                      { Ref: 'AWS::Partition' },
                      ':iam::111111111111:role/govcloud-mfe-dashboard-pipeline-deploy',
                    ],
                  ],
                },
              },
            },
          }),
        ],
      },
    });
  });
});
