import { activate } from './activate';
import type { ReleaseContext } from './context';
import { describeChanges } from './describe-changes';
import { releaseHistory } from './release-history';

/** How far back `rollback` looks for a release to return to. */
const HISTORY_DEPTH = 25;

/**
 * Re-activates a previous release in seconds; its build is still in S3.
 *
 * With build-time composition a rollback is all-or-nothing: it reverts *every* module to the
 * target release's revision. It prints which teams' changes it undoes, so they can be told. To
 * take back one module's change and keep everyone else's, revert that change in git (the delivery
 * pipeline ships the revert), or turn the module's feature flag or kill switch off.
 *
 * Without `toVersion`, rolls back to the most recent release with a different version than the
 * live one. After using this, pause the pipeline's prod transition until the fix is merged.
 */
export async function rollback(
  ctx: ReleaseContext,
  options: { toVersion?: string },
): Promise<void> {
  const history = await releaseHistory(ctx, HISTORY_DEPTH);
  const live = history.find((entry) => entry.isLive);
  if (!live) throw new Error(`Nothing is live in ${ctx.stage}`);

  const target = options.toVersion
    ? history.find((entry) => entry.record.version === options.toVersion)
    : history.find((entry) => entry.record.version !== live.record.version);

  if (!target) {
    throw new Error(
      options.toVersion
        ? `${options.toVersion} is not among the last ${HISTORY_DEPTH} releases`
        : `There is no earlier release to roll back to`,
    );
  }
  if (target.record.version === live.record.version) {
    ctx.log(`${target.record.version} is already live, nothing to do`);
    return;
  }

  ctx.log(`Rolling back ${live.record.version} → ${target.record.version}`);
  ctx.log(`Reverts: ${describeChanges(live.record.modules, target.record.modules)}`);
  await activate(ctx, {
    ...target.record,
    releasedAt: new Date().toISOString(),
    releasedBy: ctx.releasedBy,
  });
}
