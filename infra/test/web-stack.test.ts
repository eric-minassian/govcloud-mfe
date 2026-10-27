import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { WebStack } from '../lib/web-stack';
import { createTestApp, stage } from './helpers';

describe('WebStack', () => {
  let template: Template;

  beforeAll(() => {
    const { app, config } = createTestApp();
    const prod = stage(config.stages, 'prod');
    const stack = new WebStack(app, 'Web', {
      env: { account: prod.account, region: prod.region },
      stage: prod,
      toolingAccount: config.tooling.account,
    });
    template = Template.fromStack(stack);
  });

  /** Statements of the release role's policy, with resources flattened to strings. */
  function releaseRoleStatements() {
    return Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((policy) => JSON.stringify(policy.Properties.Roles).includes('ReleaseRole'))
      .flatMap((policy) => policy.Properties.PolicyDocument.Statement)
      .map((s) => ({ ...s, Resource: JSON.stringify(s.Resource) }));
  }

  it('gives the web app its own AppConfig application, monitored by the web alarm', () => {
    template.hasResourceProperties('AWS::AppConfig::Application', { Name: 'govcloud-mfe-web' });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'govcloud-mfe-web-prod-client-errors',
      Dimensions: [{ Name: 'App', Value: 'web' }],
    });
  });

  it('limits the release role to builds, the entry document and the release record', () => {
    const s3Resources = releaseRoleStatements()
      .filter((s) => s.Resource.includes('s3'))
      .map((s) => s.Resource)
      .join();
    expect(s3Resources).toContain('/builds/*');
    expect(s3Resources).toContain('/index.html');
    expect(s3Resources).toContain('/releases/web.json');
    expect(s3Resources).not.toContain('/apps/');
  });

  it("lets the release role read every app's alarm in its stage for the bake", () => {
    const describeAlarms = releaseRoleStatements().find(
      (s) => s.Action === 'cloudwatch:DescribeAlarms',
    );
    expect(describeAlarms?.Resource).toContain('alarm:govcloud-mfe-*-prod-client-errors');
  });

  it('is assumable only by the delivery pipeline deploy role', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'govcloud-mfe-web-prod-release',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Condition: {
              ArnEquals: {
                'aws:PrincipalArn': Match.objectLike({
                  'Fn::Join': [
                    '',
                    Match.arrayWith([':iam::111111111111:role/govcloud-mfe-web-pipeline-deploy']),
                  ],
                }),
              },
            },
          }),
        ],
      },
    });
  });
});
