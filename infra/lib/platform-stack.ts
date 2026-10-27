import { CfnOutput, Fn, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { ProjectConfig, StageConfig } from './config';
import { ArtifactBucket } from './constructs/artifact-bucket';
import { AuthenticatedLoadBalancer } from './constructs/authenticated-load-balancer';
import { EdgeService } from './constructs/edge-service';
import { FrontendApiService } from './constructs/frontend-api-service';
import { naming } from './naming';

export interface PlatformStackProps extends StackProps {
  readonly stage: StageConfig;
  /** `web` plus every module name. */
  readonly appNames: string[];
  readonly appConfigAgentImage: ProjectConfig['appConfigAgentImage'];
}

/** Served by the ALB itself: the IdP's post-logout landing page must not require a session. */
const SIGNED_OUT_PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Signed out</title></head>' +
  '<body style="font-family:system-ui;margin:4rem auto;max-width:32rem">' +
  '<h1>You have been signed out</h1><p><a href="/">Sign in again</a></p></body></html>';

/**
 * Shared, rarely changing infrastructure for one stage, owned by the platform team:
 *
 *   browser ──HTTPS──▶ ALB (OIDC on every request) ──┬─ /api/*  ▶ frontend-api (Rust) + AppConfig Agent
 *                                                    └─ /*      ▶ edge (nginx) ──VPC endpoint──▶ S3
 *
 * The delivery pipeline never deploys this stack. It writes builds to the artifact bucket and
 * deploys the WebStack; the two are joined only by the SSM parameter that holds the bucket name.
 */
export class PlatformStack extends Stack {
  /**
   * The account's first two AZs, resolved by CloudFormation at deploy time instead of looked up at
   * synth time, so `cdk synth` needs no AWS credentials.
   */
  override get availabilityZones(): string[] {
    return [Fn.select(0, Fn.getAzs()), Fn.select(1, Fn.getAzs())];
  }

  constructor(scope: Construct, id: string, props: PlatformStackProps) {
    super(scope, id, props);
    const { stage } = props;

    // No NAT: tasks reach AWS only through VPC endpoints, and the public subnets hold only the ALB.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC },
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      ],
    });
    vpc.addFlowLog('FlowLogs');

    // Also carries ECR image layers, and the ALB public keys the frontend-api uses to verify
    // x-amzn-oidc-data. In GovCloud those keys are served from S3.
    const s3Endpoint = vpc.addGatewayEndpoint('S3', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
    });
    const interfaceEndpoints = {
      EcrApi: ec2.InterfaceVpcEndpointAwsService.ECR,
      EcrDocker: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      Logs: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      AppConfigData: ec2.InterfaceVpcEndpointAwsService.APPCONFIGDATA,
    };
    for (const [endpointId, service] of Object.entries(interfaceEndpoints)) {
      vpc.addInterfaceEndpoint(endpointId, {
        service,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      });
    }

    const artifacts = new ArtifactBucket(this, 'Artifacts', { edgeEndpoint: s3Endpoint });

    // The web stack and the release CLI look the bucket up by this name. Loose coupling keeps the
    // web stack deployable without a CloudFormation export tying it to this stack.
    new ssm.StringParameter(this, 'AssetsBucketNameParameter', {
      parameterName: naming.assetsBucketParameter(stage.name),
      stringValue: artifacts.bucket.bucketName,
      description: 'Artifact bucket for composed web builds and the release record',
    });

    const alb = new AuthenticatedLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: stage.internetFacing,
      certificateArn: stage.certificateArn,
      oidc: stage.oidc,
      accessLogsBucket: artifacts.logsBucket,
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENHANCED,
    });

    const edge = new EdgeService(this, 'Edge', { cluster, assetsBucket: artifacts.bucket });

    const api = new FrontendApiService(this, 'FrontendApi', {
      cluster,
      stage,
      loadBalancerArn: alb.loadBalancer.loadBalancerArn,
      appNames: props.appNames,
      appConfigAgentImage: props.appConfigAgentImage,
    });

    // ── Request routing ──────────────────────────────────────────────────────────────────────────
    alb.listener.addAction('SignedOut', {
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/signed-out'])],
      action: elbv2.ListenerAction.fixedResponse(200, {
        contentType: 'text/html',
        messageBody: SIGNED_OUT_PAGE,
      }),
    });
    alb.listener.addAction('Api', {
      priority: 20,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/*'])],
      action: alb.authenticated(
        elbv2.ListenerAction.forward([api.targetGroup]),
        elbv2.UnauthenticatedAction.DENY,
      ),
    });
    // Everything else (index.html for any client-side route, and /builds/** assets) goes to nginx.
    alb.listener.addAction('Default', {
      action: alb.authenticated(elbv2.ListenerAction.forward([edge.targetGroup])),
    });

    new CfnOutput(this, 'LoadBalancerDnsName', {
      value: alb.loadBalancer.loadBalancerDnsName,
      description: `Point ${stage.domainName} at this (alias record)`,
    });
  }
}
