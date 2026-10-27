import { join } from 'node:path';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import type * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { repoRoot } from '../paths';
import {
  CONTAINER_PORT,
  containerLogging,
  createArmTaskDefinition,
  WebService,
} from './web-service';

/** The Amazon-provided DNS resolver, available at this address in every VPC. */
const VPC_DNS_RESOLVER = '169.254.169.253';

export interface EdgeServiceProps {
  readonly cluster: ecs.ICluster;
  readonly assetsBucket: s3.IBucket;
}

/**
 * nginx serving the frontends straight from the artifact bucket (services/edge-nginx). It stands in
 * for CloudFront, which GovCloud doesn't offer: immutable versioned assets, an uncached index.html,
 * and security headers. It runs behind the ALB, so every asset request is authenticated.
 */
export class EdgeService extends Construct {
  readonly targetGroup: elbv2.ApplicationTargetGroup;

  constructor(scope: Construct, id: string, props: EdgeServiceProps) {
    super(scope, id);

    const taskDefinition = createArmTaskDefinition(this, 'Task');
    const nginx = taskDefinition.addContainer('nginx', {
      image: ecs.ContainerImage.fromAsset(join(repoRoot, 'services/edge-nginx'), {
        platform: Platform.LINUX_ARM64,
      }),
      portMappings: [{ containerPort: CONTAINER_PORT }],
      environment: {
        // Regional virtual-hosted endpoint. Traffic stays on the S3 gateway endpoint, which is what
        // the bucket policy's aws:SourceVpce condition checks.
        ASSETS_BUCKET_HOST: props.assetsBucket.bucketRegionalDomainName,
        DNS_RESOLVER: VPC_DNS_RESOLVER,
      },
      readonlyRootFilesystem: true,
      logging: containerLogging(this, 'Logs', 'edge'),
    });

    // With a read-only root filesystem, nginx can only write to these scratch volumes:
    // its proxy cache and its temp/pid files.
    for (const [name, containerPath] of [
      ['nginx-cache', '/var/cache/nginx'],
      ['nginx-tmp', '/tmp'],
    ] as const) {
      taskDefinition.addVolume({ name });
      nginx.addMountPoints({ sourceVolume: name, containerPath, readOnly: false });
    }

    const web = new WebService(this, 'Web', {
      cluster: props.cluster,
      taskDefinition,
      container: nginx,
      healthCheckPath: '/nginx-health',
    });
    this.targetGroup = web.targetGroup;
  }
}
