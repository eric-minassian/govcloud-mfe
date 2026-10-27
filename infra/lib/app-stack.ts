import type { AppDescriptor } from '@govcloud-mfe/contracts';
import { Duration, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';
import { AppFeatureFlags } from './constructs/app-feature-flags';
import { ReleaseRole } from './constructs/release-role';
import { clientErrorsMetric, naming } from './naming';

export interface AppStackProps extends StackProps {
  readonly app: AppDescriptor;
  readonly stage: StageConfig;
  readonly toolingAccount: string;
}

/**
 * Everything one app owns in one stage, deployed by that app's own pipeline:
 *
 * - its client-error alarm, which drives both rollback paths (pipeline bake, AppConfig monitor),
 * - its AppConfig application with its feature flags,
 * - the release role its pipeline uses to publish, promote and roll back.
 *
 * The built assets go to the shared bucket through the release CLI, not through CloudFormation.
 * That keeps releases and rollbacks to seconds and keeps old versions available.
 */
export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { app, stage } = props;

    const clientErrors = new cloudwatch.Metric({
      namespace: clientErrorsMetric.namespace,
      metricName: clientErrorsMetric.metricName,
      dimensionsMap: { [clientErrorsMetric.appDimension]: app.name },
      statistic: cloudwatch.Stats.SUM,
      period: Duration.minutes(1),
    });
    const alarm = new cloudwatch.Alarm(this, 'ClientErrorsAlarm', {
      alarmName: naming.clientErrorsAlarm(app.name, stage.name),
      alarmDescription: `Browsers are failing to load or render ${app.displayName} in ${stage.name}.`,
      metric: clientErrors,
      threshold: 5,
      evaluationPeriods: 5,
      datapointsToAlarm: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      // No events means nothing is broken.
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    new AppFeatureFlags(this, 'FeatureFlags', {
      appName: app.name,
      stageName: stage.name,
      rollbackAlarm: alarm,
      gradualRollout: stage.production,
    });

    new ReleaseRole(this, 'ReleaseRole', {
      appName: app.name,
      kind: app.kind,
      stageName: stage.name,
      toolingAccount: props.toolingAccount,
      alarmArn: alarm.alarmArn,
    });

    Tags.of(this).add('app', app.name);
    Tags.of(this).add('owner', app.owner);
  }
}
