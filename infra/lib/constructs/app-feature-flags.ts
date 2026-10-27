import { Duration } from 'aws-cdk-lib';
import * as appconfig from 'aws-cdk-lib/aws-appconfig';
import type * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { naming } from '../naming';
import { featureFlagsFile } from '../paths';

export interface AppFeatureFlagsProps {
  readonly appName: string;
  readonly stageName: string;
  /** If this alarm fires during a flag rollout, AppConfig rolls the flags back by itself. */
  readonly rollbackAlarm: cloudwatch.IAlarm;
  /** Roll out gradually with a bake period, instead of all at once. */
  readonly gradualRollout: boolean;
}

/**
 * One AppConfig application per app (docs/contracts.md §5). AppConfig allows only one deployment
 * per environment at a time, so a shared application would make teams queue behind, or roll back,
 * each other's flag changes.
 *
 * Flag definitions are code (apps/<app>/feature-flags.json) and ship with the app's pipeline.
 * An operator can still flip a value in the console in an emergency. The next pipeline run brings
 * it back in line with the file.
 */
export class AppFeatureFlags extends Construct {
  constructor(scope: Construct, id: string, props: AppFeatureFlagsProps) {
    super(scope, id);

    const application = new appconfig.Application(this, 'Application', {
      applicationName: naming.appConfigApplication(props.appName),
    });

    const environment = new appconfig.Environment(this, 'Environment', {
      application,
      environmentName: props.stageName,
      monitors: [appconfig.Monitor.fromCloudWatchAlarm(props.rollbackAlarm)],
    });

    const deploymentStrategy = new appconfig.DeploymentStrategy(this, 'DeploymentStrategy', {
      rolloutStrategy: props.gradualRollout
        ? // Two steps of 50%, then 5 minutes during which the alarm can still trigger a rollback.
          appconfig.RolloutStrategy.linear({
            growthFactor: 50,
            deploymentDuration: Duration.minutes(4),
            finalBakeTime: Duration.minutes(5),
          })
        : // The predefined AllAtOnce strategy bakes for 10 minutes; non-production doesn't need to.
          appconfig.RolloutStrategy.linear({
            growthFactor: 100,
            deploymentDuration: Duration.minutes(0),
            finalBakeTime: Duration.minutes(0),
          }),
    });

    new appconfig.HostedConfiguration(this, 'Flags', {
      application,
      name: naming.appConfigProfile,
      type: appconfig.ConfigurationType.FEATURE_FLAGS,
      content: appconfig.ConfigurationContent.fromFile(featureFlagsFile(props.appName)),
      deploymentStrategy,
      deployTo: [environment],
    });
  }
}
