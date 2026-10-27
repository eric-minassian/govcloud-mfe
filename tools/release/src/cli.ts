#!/usr/bin/env node
/**
 * Release CLI for the composed web app. Used by the delivery pipeline, and by the platform on-call
 * for break-glass rollbacks. See docs/runbooks/deploy-and-rollback.md.
 *
 *   release deploy   --stage prod --version 3f9c2a1b7d4e --commit <sha> --assets apps/web/dist
 *   release rollback --stage prod [--to 1a2b3c4d5e6f]
 *   release status   --stage prod
 */
import { Command, Option } from 'commander';
import { createReleaseContext, type ReleaseContextOptions } from './context';
import { deploy } from './deploy';
import { describeChanges } from './describe-changes';
import { releaseHistory } from './release-history';
import { rollback } from './rollback';

const program = new Command('release').description(
  'Deploy, roll back and inspect releases of the composed web app',
);

/** Options every command needs to find the stage's bucket with the right credentials. */
function withTarget(command: Command): Command {
  return command
    .requiredOption('--stage <stage>', 'deployment stage, e.g. dev or prod')
    .option('--region <region>', 'AWS region', process.env.AWS_REGION ?? 'us-gov-west-1')
    .option('--role-arn <arn>', "role to assume, normally the stage's release role")
    .addOption(
      new Option('--bucket <name>', 'skip the SSM lookup of the artifact bucket').hideHelp(),
    );
}

withTarget(program.command('deploy'))
  .description('upload a build (idempotent) and make it live')
  .requiredOption('--version <version>', 'release version (12-char commit SHA)')
  .requiredOption('--commit <sha>', 'full commit SHA')
  .requiredOption('--assets <dir>', 'build output directory (apps/web/dist)')
  .action(async (options) => {
    const ctx = await createReleaseContext(options as ReleaseContextOptions);
    await deploy(ctx, {
      version: options.version,
      commit: options.commit,
      assetsDir: options.assets,
    });
  });

withTarget(program.command('rollback'))
  .description('make a previous release live again')
  .option('--to <version>', 'version to roll back to (default: the previous release)')
  .action(async (options) => {
    const ctx = await createReleaseContext(options as ReleaseContextOptions);
    await rollback(ctx, { toVersion: options.to });
  });

withTarget(program.command('status'))
  .description('show the live release and recent history, with which modules each one changed')
  .action(async (options) => {
    const ctx = await createReleaseContext(options as ReleaseContextOptions);
    const history = await releaseHistory(ctx, 10);
    if (history.length === 0) {
      console.log(`Nothing has been released to ${ctx.stage} yet.`);
      return;
    }
    console.table(
      history.map((entry, index) => ({
        live: entry.isLive ? '▶' : '',
        version: entry.record.version,
        releasedAt: entry.record.releasedAt,
        // Compared with the release before it, i.e. what this release changed.
        changed: describeChanges(history[index + 1]?.record.modules ?? [], entry.record.modules),
      })),
    );
  });

program.parseAsync().catch((error: unknown) => {
  console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
