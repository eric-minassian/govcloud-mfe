import { readFileSync } from 'node:fs';
import type { ModuleDescriptor } from '@govcloud-mfe/contracts';
import { App } from 'aws-cdk-lib';
import type { Template } from 'aws-cdk-lib/assertions';
import { loadConfig, type StageConfig } from '../lib/config';
import { loadModules } from '../lib/paths';

/** A CDK app with the committed placeholder configuration from cdk.json. */
export function createTestApp() {
  const cdkJson = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'));
  const app = new App({ context: cdkJson.context });
  return { app, config: loadConfig(app) };
}

export function moduleDescriptor(name: string): ModuleDescriptor {
  const descriptor = loadModules().find((m) => m.name === name);
  if (!descriptor) throw new Error(`No module named ${name}`);
  return descriptor;
}

export function stage(stages: StageConfig[], name: string): StageConfig {
  const found = stages.find((s) => s.name === name);
  if (!found) throw new Error(`No stage named ${name}`);
  return found;
}

/** The parts of AWS::CodePipeline::Pipeline the pipeline tests look at. */
export interface PipelineProperties {
  Name: string;
  PipelineType: string;
  ExecutionMode?: string;
  Triggers: {
    GitConfiguration: {
      Push?: { FilePaths: { Includes: string[]; Excludes?: string[] } }[];
      PullRequest?: { Events: string[]; FilePaths: { Includes: string[] } }[];
    };
  }[];
  Stages: {
    Name: string;
    Actions: { Name: string; RunOrder?: number }[];
    OnFailure?: { Result: string };
  }[];
}

export function pipelineNamed(template: Template, name: string): PipelineProperties {
  const pipelines = Object.values(template.findResources('AWS::CodePipeline::Pipeline')).map(
    (resource) => resource.Properties as PipelineProperties,
  );
  const pipeline = pipelines.find((p) => p.Name === name);
  if (!pipeline) throw new Error(`No pipeline named ${name}`);
  return pipeline;
}

/** The buildspec of the CodeBuild project with the given name, as a string. */
export function buildSpecOf(template: Template, projectName: string): string {
  const project = Object.values(template.findResources('AWS::CodeBuild::Project')).find(
    (resource) => resource.Properties.Name === projectName,
  );
  if (!project) throw new Error(`No CodeBuild project named ${projectName}`);
  return project.Properties.Source.BuildSpec as string;
}
