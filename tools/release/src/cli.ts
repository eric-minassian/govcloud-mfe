#!/usr/bin/env node
/**
 * Release CLI for micro-frontends. Used by each app's pipeline, and by humans for break-glass
 * rollbacks. See docs/runbooks/deploy-and-rollback.md.
 *
 *   release deploy   --app dashboard --stage prod --version 3f9c2a1b7d4e --commit <sha> --assets dist
 *   release rollback --app dashboard --stage prod [--to 1a2b3c4d5e6f]
 *   release status   --app dashboard --stage prod
 */
import { readFileSync } from 'node:fs';
import { parseAppDescriptor } from '@govcloud-mfe/contracts';
import { Command, Option } from 'commander';
import { createReleaseContext, type ReleaseContextOptions } from './context';
import { promote } from './promote';
import { publish } from './publish';
import { releaseHistory } from './release-history';
import { rollback } from './rollback';

const program = new Command('release').description(
  'Publish, promote and roll back micro-frontend versions',
);

/** Options every command needs to find the right bucket with the right credentials. */
function withTarget(command: Command): Command {
  return command
    .requiredOption('--app <name>', 'app name from microfrontend.json')
    .requiredOption('--stage <stage>', 'deployment stage, e.g. dev or prod')
    .option('--region <region>', 'AWS region', process.env.AWS_REGION ?? 'us-gov-west-1')
    .option(
      '--role-arn <arn>',
      "role to assume, normally the app's release role in the stage account",
    )
    .addOption(
      new Option('--bucket <name>', 'skip the SSM lookup of the artifact bucket').hideHelp(),
    );
}

withTarget(program.command('deploy'))
  .description('upload a build (idempotent) and make it the live version')
  .requiredOption('--version <version>', 'release version (12-char commit SHA)')
  .requiredOption('--commit <sha>', 'full commit SHA')
  .requiredOption('--assets <dir>', 'build output directory')
  .option('--descriptor <path>', 'path to microfrontend.json')
  .action(async (options) => {
    const ctx = await createReleaseContext(options as ReleaseContextOptions);
    const descriptorPath = options.descriptor ?? `apps/${options.app}/microfrontend.json`;
    const descriptor = parseAppDescriptor(
      JSON.parse(readFileSync(descriptorPath, 'utf8')),
      descriptorPath,
    );
    if (descriptor.name !== options.app) {
      throw new Error(`--app ${options.app} does not match ${descriptorPath} (${descriptor.name})`);
    }

    await publish(ctx, {
      version: options.version,
      commit: options.commit,
      assetsDir: options.assets,
    });
    await promote(ctx, { descriptor, version: options.version, commit: options.commit });
  });

withTarget(program.command('rollback'))
  .description('make a previously released version live again')
  .option('--to <version>', 'version to roll back to (default: the previous release)')
  .action(async (options) => {
    const ctx = await createReleaseContext(options as ReleaseContextOptions);
    await rollback(ctx, { toVersion: options.to });
  });

withTarget(program.command('status'))
  .description('show the live version and recent releases')
  .action(async (options) => {
    const ctx = await createReleaseContext(options as ReleaseContextOptions);
    const history = await releaseHistory(ctx, 10);
    if (history.length === 0) {
      console.log(`${ctx.app} has never been released to ${ctx.stage}.`);
      return;
    }
    console.table(
      history.map((entry, index) => ({
        live: index === 0 ? '▶' : '',
        version: entry.record.version,
        commit: entry.record.commit.slice(0, 12),
        releasedAt: entry.record.releasedAt,
        releasedBy: entry.record.releasedBy,
      })),
    );
  });

program.parseAsync().catch((error: unknown) => {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
