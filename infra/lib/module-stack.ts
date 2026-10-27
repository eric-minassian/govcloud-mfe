import type { ModuleDescriptor } from '@govcloud-mfe/contracts';
import { Stack, type StackProps, Tags } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';
import { FeatureFlagsApp } from './constructs/feature-flags-app';
import { moduleFeatureFlagsFile } from './paths';

export interface ModuleStackProps extends StackProps {
  readonly module: ModuleDescriptor;
  readonly stage: StageConfig;
}

/**
 * What one team's module owns at runtime in one stage: its own AppConfig application (with the
 * `moduleEnabled` kill switch and the team's other flags) and its client-error alarm.
 *
 * Deployed **only** by that module's flags pipeline. The module's code ships inside the composed
 * build on the delivery pipeline, but the delivery pipeline must never deploy this stack: it runs
 * on every team's merges, so redeploying flags from it would overwrite one team's flag values with
 * whatever another team's commit happened to contain.
 *
 * There is no release role: a module has no assets of its own to publish.
 */
export class ModuleStack extends Stack {
  constructor(scope: Construct, id: string, props: ModuleStackProps) {
    super(scope, id, props);
    const { module, stage } = props;

    new FeatureFlagsApp(this, 'FeatureFlags', {
      appName: module.name,
      displayName: `the ${module.displayName} module`,
      stageName: stage.name,
      flagsFile: moduleFeatureFlagsFile(module.name),
      gradualRollout: stage.production,
    });

    Tags.of(this).add('module', module.name);
    Tags.of(this).add('owner', module.owner);
  }
}
