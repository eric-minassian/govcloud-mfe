import { Duration } from 'aws-cdk-lib';
import * as appconfig from 'aws-cdk-lib/aws-appconfig';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { clientErrorsMetric, naming } from '../naming';

export interface FeatureFlagsAppProps {
  /** `web` or a module name: the AppConfig application suffix and the metric dimension. */
  readonly appName: string;
  /** Used in the alarm description. */
  readonly displayName: string;
  readonly stageName: string;
  /** Path to an `AWS.AppConfig.FeatureFlags` document. */
  readonly flagsFile: string;
  /** Roll out gradually with a bake period, instead of all at once. */
  readonly gradualRollout: boolean;
}

/**
 * One app's runtime safety net in one stage: its client-error alarm and its own AppConfig
 * application with its feature flags (docs/contracts.md §7, §8). Used for the web app and for
 * every module, so they all behave the same.
 *
 * AppConfig allows only one deployment per environment at a time, so a shared application would
 * make teams queue behind, or roll back, each other's flag changes. With one application per app,
 * the alarm is also that app's AppConfig rollback monitor and affects nobody else.
 */
export class FeatureFlagsApp extends Construct {
  /** Fires when browsers fail to load or render this app. Watched by the delivery pipeline's bake. */
  readonly alarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: FeatureFlagsAppProps) {
    super(scope, id);
    const { appName, stageName } = props;

    this.alarm = new cloudwatch.Alarm(this, 'ClientErrorsAlarm', {
      alarmName: naming.clientErrorsAlarm(appName, stageName),
      alarmDescription: `Browsers are failing to load or render ${props.displayName} in ${stageName}.`,
      metric: new cloudwatch.Metric({
        namespace: clientErrorsMetric.namespace,
        metricName: clientErrorsMetric.metricName,
        dimensionsMap: { [clientErrorsMetric.appDimension]: appName },
        statistic: cloudwatch.Stats.SUM,
        period: Duration.minutes(1),
      }),
      threshold: 5,
      evaluationPeriods: 5,
      datapointsToAlarm: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      // No events means nothing is broken.
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const application = new appconfig.Application(this, 'Application', {
      applicationName: naming.appConfigApplication(appName),
    });

    const environment = new appconfig.Environment(this, 'Environment', {
      application,
      environmentName: stageName,
      // If the alarm fires while a flag change is rolling out or baking, AppConfig reverts it.
      monitors: [appconfig.Monitor.fromCloudWatchAlarm(this.alarm)],
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
      content: appconfig.ConfigurationContent.fromFile(props.flagsFile),
      deploymentStrategy,
      deployTo: [environment],
    });
  }
}
