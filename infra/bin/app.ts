import { App, Tags } from 'aws-cdk-lib';
import { AppStack } from '../lib/app-stack';
import { loadConfig } from '../lib/config';
import { naming } from '../lib/naming';
import { loadAppDescriptors } from '../lib/paths';
import { PipelineStack } from '../lib/pipeline-stack';
import { PlatformStack } from '../lib/platform-stack';

const cdkApp = new App();
const config = loadConfig(cdkApp);
const apps = loadAppDescriptors();

// A pipeline's build stage runs `cdk synth -c app=<name>` and gets only that app's stacks.
// Its release bundle then can't contain (or accidentally deploy) anything else.
const onlyApp: string | undefined = cdkApp.node.tryGetContext('app');
if (onlyApp && !apps.some((app) => app.name === onlyApp)) {
  throw new Error(`Unknown app "${onlyApp}". Known apps: ${apps.map((a) => a.name).join(', ')}`);
}

for (const stage of config.stages) {
  const env = { account: stage.account, region: stage.region };

  if (!onlyApp) {
    new PlatformStack(cdkApp, naming.platformStack(stage.name), {
      env,
      stage,
      appConfigAgentImage: config.appConfigAgentImage,
      description: `Shared micro-frontend platform (${stage.name}): ALB + OIDC, nginx, frontend-api`,
    });
  }

  for (const app of apps.filter((a) => !onlyApp || a.name === onlyApp)) {
    new AppStack(cdkApp, naming.appStack(stage.name, app.name), {
      env,
      app,
      stage,
      toolingAccount: config.tooling.account,
      description: `${app.displayName} (${stage.name}): feature flags, alarm, release role`,
    });
  }
}

if (!onlyApp) {
  for (const app of apps) {
    new PipelineStack(cdkApp, naming.pipelineStack(app.name), {
      env: config.tooling,
      app,
      source: config.source,
      stages: config.stages,
      description: `Build, deploy and roll back ${app.displayName}`,
    });
  }
}

Tags.of(cdkApp).add('project', 'govcloud-mfe');
