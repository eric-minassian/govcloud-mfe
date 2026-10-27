import { readFileSync } from 'node:fs';
import type { AppDescriptor } from '@govcloud-mfe/contracts';
import { App } from 'aws-cdk-lib';
import { loadConfig, type StageConfig } from '../lib/config';
import { loadAppDescriptors } from '../lib/paths';

/** A CDK app with the committed placeholder configuration from cdk.json. */
export function createTestApp() {
  const cdkJson = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'));
  const app = new App({ context: cdkJson.context });
  return { app, config: loadConfig(app) };
}

export function appDescriptor(name: string): AppDescriptor {
  const descriptor = loadAppDescriptors().find((a) => a.name === name);
  if (!descriptor) throw new Error(`No app named ${name}`);
  return descriptor;
}

export function stage(stages: StageConfig[], name: string): StageConfig {
  const found = stages.find((s) => s.name === name);
  if (!found) throw new Error(`No stage named ${name}`);
  return found;
}
