import { join } from 'node:path';
import { Stack } from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import type * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import type { ProjectConfig, StageConfig } from '../config';
import { clientErrorsMetric, naming, SESSION_COOKIE_NAME } from '../naming';
import { repoRoot } from '../paths';
import {
  CONTAINER_PORT,
  containerLogging,
  createArmTaskDefinition,
  WebService,
} from './web-service';

export interface FrontendApiServiceProps {
  readonly cluster: ecs.ICluster;
  readonly stage: StageConfig;
  readonly assetsBucket: s3.IBucket;
  /** Expected `signer` of the ALB's x-amzn-oidc-data JWT. */
  readonly loadBalancerArn: string;
  readonly appConfigAgentImage: ProjectConfig['appConfigAgentImage'];
}

/**
 * The Rust same-origin API (services/frontend-api) with the AWS AppConfig Agent as a sidecar.
 * The agent owns the AppConfig sessions, polling, caching and multi-variant flag evaluation. The API
 * makes plain HTTP calls to localhost:2772. Configuration contract: docs/contracts.md §7.
 */
export class FrontendApiService extends Construct {
  readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: FrontendApiServiceProps) {
    super(scope, id);
    const { stage, assetsBucket } = props;

    const taskDefinition = createArmTaskDefinition(this, 'Task');

    const agent = taskDefinition.addContainer('appconfig-agent', {
      image: ecs.ContainerImage.fromEcrRepository(
        ecr.Repository.fromRepositoryName(
          this,
          'AppConfigAgentRepository',
          props.appConfigAgentImage.repositoryName,
        ),
        props.appConfigAgentImage.tag,
      ),
      environment: {
        SERVICE_REGION: Stack.of(this).region,
        POLL_INTERVAL: '30',
        LOG_LEVEL: 'info',
      },
      readonlyRootFilesystem: true,
      logging: containerLogging(this, 'AgentLogs', 'appconfig-agent'),
    });

    const api = taskDefinition.addContainer('frontend-api', {
      image: ecs.ContainerImage.fromAsset(join(repoRoot, 'services/frontend-api'), {
        platform: Platform.LINUX_ARM64,
      }),
      portMappings: [{ containerPort: CONTAINER_PORT }],
      environment: {
        APP_ENV: 'aws',
        PORT: String(CONTAINER_PORT),
        AUTH_MODE: 'alb',
        ALB_ARN: props.loadBalancerArn,
        SESSION_COOKIE_NAME,
        LOGOUT_REDIRECT_URL: stage.oidc.logoutUrl,
        RELEASES_SOURCE: 's3',
        ASSETS_BUCKET: assetsBucket.bucketName,
        FLAGS_SOURCE: 'appconfig-agent',
        APPCONFIG_AGENT_URL: 'http://localhost:2772',
        APPCONFIG_APPLICATION_PREFIX: naming.appConfigApplicationPrefix,
        APPCONFIG_ENVIRONMENT: stage.name,
        APPCONFIG_PROFILE: naming.appConfigProfile,
        METRICS_NAMESPACE: clientErrorsMetric.namespace,
        RUST_LOG: 'info',
      },
      readonlyRootFilesystem: true,
      // Client error events are written to stdout as Embedded Metric Format lines. CloudWatch Logs
      // turns them into the ClientErrors metric that each app's rollback alarm watches.
      logging: containerLogging(this, 'Logs', 'frontend-api'),
    });
    // The agent image has no shell for a container health check, so wait for it to start. The API
    // treats flags as optional (fail-open) during the few hundred milliseconds before the first poll.
    api.addContainerDependencies({
      container: agent,
      condition: ecs.ContainerDependencyCondition.START,
    });

    // Read the release records (the module registry) and nothing else in the bucket.
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [assetsBucket.bucketArn],
        conditions: { StringLike: { 's3:prefix': ['releases/*'] } },
      }),
    );
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [assetsBucket.arnForObjects('releases/*')],
      }),
    );

    // Used by the agent sidecar, which shares the task role. AppConfig ARNs contain generated IDs
    // (application/a1b2c3d/...), not names, so the govcloud-mfe-* applications can't be selected
    // by name. The boundary is "AppConfig applications in this account and region". Each app stack
    // creates its own application, so the list is open-ended by design.
    taskDefinition.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ['appconfig:StartConfigurationSession', 'appconfig:GetLatestConfiguration'],
        resources: [
          Stack.of(this).formatArn({
            service: 'appconfig',
            resource: 'application',
            resourceName: '*',
          }),
        ],
      }),
    );

    const web = new WebService(this, 'Web', {
      cluster: props.cluster,
      taskDefinition,
      container: api,
      healthCheckPath: '/api/health',
    });
    this.targetGroup = web.targetGroup;
  }
}
