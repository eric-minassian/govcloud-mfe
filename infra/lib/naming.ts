/**
 * Names other parts of the system depend on (release CLI, frontend-api, pipelines).
 * Source of truth: docs/contracts.md §5, §6 and §8 — change them there first.
 */
export const naming = {
  platformStack: (stage: string) => `GovcloudMfe-${stage}-Platform`,
  appStack: (stage: string, app: string) => `GovcloudMfe-${stage}-App-${app}`,
  pipelineStack: (app: string) => `GovcloudMfe-Pipeline-${app}`,

  pipeline: (app: string) => `govcloud-mfe-${app}`,
  /** Role the pipeline's deploy/bake CodeBuild projects run as (tooling account). */
  pipelineDeployRole: (app: string) => `govcloud-mfe-${app}-pipeline-deploy`,
  /** Role in each stage account that the pipeline assumes to publish and promote releases. */
  releaseRole: (app: string, stage: string) => `govcloud-mfe-${app}-${stage}-release`,

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
