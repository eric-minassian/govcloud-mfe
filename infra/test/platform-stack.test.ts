import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { PlatformStack } from '../lib/platform-stack';
import { createTestApp, stage } from './helpers';

describe('PlatformStack', () => {
  let template: Template;

  beforeAll(() => {
    const { app, config } = createTestApp();
    const prod = stage(config.stages, 'prod');
    const stack = new PlatformStack(app, 'Platform', {
      env: { account: prod.account, region: prod.region },
      stage: prod,
      appConfigAgentImage: config.appConfigAgentImage,
    });
    template = Template.fromStack(stack);
  });

  it('authenticates every request to nginx, redirecting browsers to the IdP', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      DefaultActions: [
        Match.objectLike({
          Type: 'authenticate-oidc',
          AuthenticateOidcConfig: Match.objectLike({
            OnUnauthenticatedRequest: 'authenticate',
            SessionCookieName: 'govcloud-mfe-session',
          }),
        }),
        Match.objectLike({ Type: 'forward' }),
      ],
    });
  });

  it('authenticates /api/* but answers 401 instead of redirecting, so fetch() can react', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
      Conditions: [{ Field: 'path-pattern', PathPatternConfig: { Values: ['/api/*'] } }],
      Actions: [
        Match.objectLike({
          Type: 'authenticate-oidc',
          AuthenticateOidcConfig: Match.objectLike({ OnUnauthenticatedRequest: 'deny' }),
        }),
        Match.objectLike({ Type: 'forward' }),
      ],
    });
  });

  it('serves the post-logout page without authentication', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
      Conditions: [{ Field: 'path-pattern', PathPatternConfig: { Values: ['/signed-out'] } }],
      Actions: [Match.objectLike({ Type: 'fixed-response' })],
    });
  });

  it('encrypts the artifact bucket with SSE-S3 so anonymous VPC-endpoint reads work', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
    });
  });

  it('lets only the S3 gateway endpoint read build output and the shell entry document', () => {
    const policies = template.findResources('AWS::S3::BucketPolicy');
    const statements = Object.values(policies).flatMap(
      (policy) => policy.Properties.PolicyDocument.Statement,
    );
    const edgeRead = statements.find((s) => s.Sid === 'AllowEdgeReadsThroughVpcEndpoint');

    expect(edgeRead).toMatchObject({
      Effect: 'Allow',
      Principal: { AWS: '*' },
      Action: 's3:GetObject',
      Condition: { StringEquals: { 'aws:SourceVpce': { Ref: expect.stringMatching(/^VpcS3/) } } },
    });
    expect(JSON.stringify(edgeRead.Resource)).toContain('/apps/*');
    expect(JSON.stringify(edgeRead.Resource)).toContain('/index.html');
    expect(JSON.stringify(edgeRead.Resource)).not.toContain('releases');
  });

  it('publishes the bucket name for app stacks and the release CLI', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/govcloud-mfe/prod/assets-bucket-name',
    });
  });
});
