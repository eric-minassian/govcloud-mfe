/**
 * Names other parts of the system depend on (release CLI, frontend-api, pipelines, docs).
 * Source of truth: docs/contracts.md §7, §8 and §10 — change them there first.
 */

/** The composed application. Also its AppConfig application suffix and metric dimension. */
export const WEB_APP = 'web';

/** Owner tag for everything that isn't a team's module (matches the CODEOWNERS default). */
export const PLATFORM_TEAM = 'team-platform';

export const naming = {
  // Stacks
  platformStack: (stage: string) => `GovcloudMfe-${stage}-Platform`,
  webStack: (stage: string) => `GovcloudMfe-${stage}-Web`,
  moduleStack: (stage: string, module: string) => `GovcloudMfe-${stage}-Module-${module}`,
  webPipelineStack: 'GovcloudMfe-Pipeline-Web',
  modulePipelineStack: (module: string) => `GovcloudMfe-Pipeline-Module-${module}`,

  // Pipelines (tooling account)
  deliveryPipeline: 'govcloud-mfe-web',
  webChecksPipeline: 'govcloud-mfe-web-checks',
  moduleChecksPipeline: (module: string) => `govcloud-mfe-${module}-checks`,
  moduleFlagsPipeline: (module: string) => `govcloud-mfe-${module}-flags`,

  // Roles
  /** Delivery pipeline's deploy and bake steps (tooling account). */
  deliveryDeployRole: 'govcloud-mfe-web-pipeline-deploy',
  /** A module flags pipeline's deploy steps (tooling account). */
  moduleFlagsDeployRole: (module: string) => `govcloud-mfe-${module}-flags-deploy`,
  /** In each stage account; the delivery pipeline assumes it to publish, promote and bake. */
  releaseRole: (stage: string) => `govcloud-mfe-web-${stage}-release`,

  // Runtime
  assetsBucketParameter: (stage: string) => `/govcloud-mfe/${stage}/assets-bucket-name`,
  clientErrorsAlarm: (app: string, stage: string) => `govcloud-mfe-${app}-${stage}-client-errors`,
  appConfigApplicationPrefix: 'govcloud-mfe-',
  appConfigApplication: (app: string) => `govcloud-mfe-${app}`,
  appConfigProfile: 'feature-flags',
} as const;

/** The metric the frontend-api emits (as EMF log lines) for every accepted client error event. */
export const clientErrorsMetric = {
  namespace: 'GovcloudMfe/Frontend',
  metricName: 'ClientErrors',
  appDimension: 'App',
} as const;

/** Must match the ALB authenticate action; the frontend-api expires it on logout. */
export const SESSION_COOKIE_NAME = 'govcloud-mfe-session';
