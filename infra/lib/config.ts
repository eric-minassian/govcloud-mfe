import type { App } from 'aws-cdk-lib';

/**
 * Deployment configuration, read from the `govcloud-mfe` key of the CDK context (cdk.json).
 * The committed values are placeholders so `cdk synth` works offline; real environments
 * override them with `-c` or a cdk.context.json that is not committed.
 */
export interface ProjectConfig {
  /** Account/region that hosts the pipelines. */
  tooling: Environment;
  source: SourceConfig;
  /**
   * Private ECR mirror of public.ecr.aws/aws-appconfig/aws-appconfig-agent. Tasks run in isolated
   * subnets with no internet path, and GovCloud has no private route to ECR Public.
   */
  appConfigAgentImage: { repositoryName: string; tag: string };
  /** Ordered: pipelines promote through stages in this order. */
  stages: StageConfig[];
}

export interface Environment {
  account: string;
  region: string;
}

export interface SourceConfig {
  /**
   * CodeConnections connection to the Git host. In GovCloud, CodeConnections is only available in
   * us-gov-east-1, which is why the tooling region defaults there. Alternatives: an S3 source fed by
   * an external CI, or CodeCommit.
   */
  connectionArn: string;
  owner: string;
  repo: string;
  branch: string;
}

export interface StageConfig extends Environment {
  name: string;
  /** Production stages get a manual approval, a bake period and gradual flag rollouts. */
  production: boolean;
  /** `false` places the ALB in private subnets; it then needs a route to the IdP's token endpoint. */
  internetFacing: boolean;
  domainName: string;
  certificateArn: string;
  oidc: OidcConfig;
}

export interface OidcConfig {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
  clientId: string;
  /** Secrets Manager secret whose SecretString is the OIDC client secret. */
  clientSecretArn: string;
  /** IdP end-session URL; should redirect back to https://<domainName>/signed-out. */
  logoutUrl: string;
}

export function loadConfig(app: App): ProjectConfig {
  const config = app.node.tryGetContext('govcloud-mfe') as ProjectConfig | undefined;
  if (!config) {
    throw new Error('Missing "govcloud-mfe" in the CDK context. See infra/cdk.json.');
  }
  if (config.stages.length === 0) {
    throw new Error('At least one stage must be configured.');
  }
  return config;
}
