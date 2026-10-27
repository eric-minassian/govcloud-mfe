import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/** Port every container behind the ALB listens on. Both images run as non-root. */
export const CONTAINER_PORT = 8080;

export interface WebServiceProps {
  readonly cluster: ecs.ICluster;
  readonly taskDefinition: ecs.FargateTaskDefinition;
  /** The container the ALB sends traffic to (on CONTAINER_PORT). */
  readonly container: ecs.ContainerDefinition;
  readonly healthCheckPath: string;
}

/**
 * The parts the edge (nginx) and frontend-api services share: a Fargate service in isolated
 * subnets that rolls back failed deployments on its own, scales on CPU, and is reachable only
 * from the ALB. Each service builds its own task definition; this construct runs it.
 */
export class WebService extends Construct {
  readonly service: ecs.FargateService;
  readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: WebServiceProps) {
    super(scope, id);

    this.service = new ecs.FargateService(this, 'Service', {
      cluster: props.cluster,
      taskDefinition: props.taskDefinition,
      desiredCount: 2,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      // ECS-native rollback for the platform services themselves.
      circuitBreaker: { enable: true, rollback: true },
      minHealthyPercent: 100,
    });

    this.service
      .autoScaleTaskCount({ minCapacity: 2, maxCapacity: 10 })
      .scaleOnCpuUtilization('Cpu', { targetUtilizationPercent: 60 });

    // Attaching this target group to a listener opens the service's security group to the
    // ALB's security group on CONTAINER_PORT — and nothing else.
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc: props.cluster.vpc,
      port: CONTAINER_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [
        this.service.loadBalancerTarget({
          containerName: props.container.containerName,
          containerPort: CONTAINER_PORT,
        }),
      ],
      healthCheck: { path: props.healthCheckPath, healthyHttpCodes: '200' },
      deregistrationDelay: Duration.seconds(30),
    });
  }
}

/** Fargate on Graviton: cheaper per vCPU and available in GovCloud. */
export function createArmTaskDefinition(scope: Construct, id: string): ecs.FargateTaskDefinition {
  return new ecs.FargateTaskDefinition(scope, id, {
    cpu: 512,
    memoryLimitMiB: 1024,
    runtimePlatform: {
      cpuArchitecture: ecs.CpuArchitecture.ARM64,
      operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
    },
  });
}

/** awslogs with an explicit, retained log group. Non-blocking so a logging hiccup can't stall requests. */
export function containerLogging(
  scope: Construct,
  id: string,
  streamPrefix: string,
): ecs.LogDriver {
  const logGroup = new logs.LogGroup(scope, id, {
    retention: logs.RetentionDays.THREE_MONTHS,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  return ecs.LogDrivers.awsLogs({
    logGroup,
    streamPrefix,
    mode: ecs.AwsLogDriverMode.NON_BLOCKING,
  });
}
