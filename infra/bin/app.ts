import type { ModuleDescriptor } from '@govcloud-mfe/contracts';
import { App, Tags } from 'aws-cdk-lib';
import { loadConfig } from '../lib/config';
import { ModulePipelineStack } from '../lib/module-pipeline-stack';
import { ModuleStack } from '../lib/module-stack';
import { naming, WEB_APP } from '../lib/naming';
import { loadModules } from '../lib/paths';
import { PlatformStack } from '../lib/platform-stack';
import { WebPipelineStack } from '../lib/web-pipeline-stack';
import { WebStack } from '../lib/web-stack';

const cdkApp = new App();
const config = loadConfig(cdkApp);
const modules = loadModules();

/**
 * What to synthesize, from `-c target=...`. Each pipeline synthesizes only the stacks it deploys,
 * so its bundle can't contain (or accidentally deploy) anybody else's:
 *
 *   (none)            everything: platform, web and module stacks, and all pipelines
 *   web               the WebStack of every stage (delivery pipeline)
 *   module:<name>     that module's ModuleStack of every stage (its flags pipeline)
 */
type Target = { kind: 'all' } | { kind: 'web' } | { kind: 'module'; module: ModuleDescriptor };

function parseTarget(value: string | undefined): Target {
  if (value === undefined) return { kind: 'all' };
  if (value === WEB_APP) return { kind: 'web' };
  const name = value.startsWith('module:') ? value.slice('module:'.length) : undefined;
  const module = modules.find((m) => m.name === name);
  if (module) return { kind: 'module', module };
  const known = [WEB_APP, ...modules.map((m) => `module:${m.name}`)].join(', ');
  throw new Error(`Unknown target "${value}". Known targets: ${known}`);
}

const target = parseTarget(cdkApp.node.tryGetContext('target'));
const everything = target.kind === 'all';

for (const stage of config.stages) {
  const env = { account: stage.account, region: stage.region };

  if (everything) {
    new PlatformStack(cdkApp, naming.platformStack(stage.name), {
      env,
      stage,
      appNames: [WEB_APP, ...modules.map((m) => m.name)],
      appConfigAgentImage: config.appConfigAgentImage,
      description: `Shared platform (${stage.name}): ALB + OIDC, nginx, frontend-api`,
    });
  }

  if (everything || target.kind === 'web') {
    new WebStack(cdkApp, naming.webStack(stage.name), {
      env,
      stage,
      toolingAccount: config.tooling.account,
      description: `Web app (${stage.name}): web app flags, alarm, release role`,
    });
  }

  for (const module of modules) {
    if (everything || (target.kind === 'module' && target.module.name === module.name)) {
      new ModuleStack(cdkApp, naming.moduleStack(stage.name, module.name), {
        env,
        module,
        stage,
        description: `${module.displayName} module (${stage.name}): feature flags, alarm. Owner: ${module.owner}`,
      });
    }
  }
}

if (everything) {
  new WebPipelineStack(cdkApp, naming.webPipelineStack, {
    env: config.tooling,
    source: config.source,
    stages: config.stages,
    modules,
    description: 'Delivery pipeline for the composed web app, and platform pull-request checks',
  });

  for (const module of modules) {
    new ModulePipelineStack(cdkApp, naming.modulePipelineStack(module.name), {
      env: config.tooling,
      module,
      source: config.source,
      stages: config.stages,
      description: `${module.displayName} pull-request checks and flags pipeline. Owner: ${module.owner}`,
    });
  }
}

Tags.of(cdkApp).add('project', 'govcloud-mfe');
