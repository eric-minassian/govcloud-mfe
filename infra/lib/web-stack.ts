import { Stack, type StackProps, Tags } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';
import { FeatureFlagsApp } from './constructs/feature-flags-app';
import { ReleaseRole } from './constructs/release-role';
import { PLATFORM_TEAM, WEB_APP } from './naming';
import { webFeatureFlagsFile } from './paths';

export interface WebStackProps extends StackProps {
  readonly stage: StageConfig;
  readonly toolingAccount: string;
}

/**
 * What the composed web app owns in one stage, deployed by the delivery pipeline before each release:
 *
 * - the app-level client-error alarm and the `govcloud-mfe-web` AppConfig application (the web app's own flags),
 * - the release role the pipeline uses to publish, promote, roll back and bake.
 *
 * Builds go to the shared bucket through the release CLI, not through CloudFormation, so releases
 * and rollbacks take seconds and old builds stay available.
 */
export class WebStack extends Stack {
  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    const { stage } = props;

    new FeatureFlagsApp(this, 'FeatureFlags', {
      appName: WEB_APP,
      displayName: 'the web app',
      stageName: stage.name,
      flagsFile: webFeatureFlagsFile,
      gradualRollout: stage.production,
    });

    new ReleaseRole(this, 'ReleaseRole', {
      stageName: stage.name,
      toolingAccount: props.toolingAccount,
    });

    Tags.of(this).add('app', WEB_APP);
    Tags.of(this).add('owner', PLATFORM_TEAM);
  }
}
