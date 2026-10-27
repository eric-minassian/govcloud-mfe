import type { ReleaseContext } from './context';
import { activate } from './promote';
import { releaseHistory } from './release-history';

/** How far back `rollback` looks for a version to return to. */
const HISTORY_DEPTH = 25;

/**
 * Re-activates a previous release. Nothing is rebuilt or re-uploaded — the old version's files
 * are still in its immutable prefix — so this takes seconds.
 *
 * Without `toVersion`, rolls back to the most recent release with a different version than the
 * live one. Note that straight after a rollback, that is the version you just rolled back *from*;
 * use `release status` and `--to` when in doubt.
 *
 * This is the break-glass path. Normally rollback happens in the pipeline (see
 * docs/runbooks/deploy-and-rollback.md); after using this, pause the pipeline's prod transition
 * so the next run doesn't re-release the bad version.
 */
export async function rollback(
  ctx: ReleaseContext,
  options: { toVersion?: string },
): Promise<void> {
  const history = await releaseHistory(ctx, HISTORY_DEPTH);
  const live = history.find((entry) => entry.isLive);
  if (!live) throw new Error(`${ctx.app} has no live release in ${ctx.stage}`);

  const target = options.toVersion
    ? history.find((entry) => entry.record.version === options.toVersion)
    : history.find((entry) => entry.record.version !== live.record.version);

  if (!target) {
    throw new Error(
      options.toVersion
        ? `${options.toVersion} is not among the last ${HISTORY_DEPTH} releases of ${ctx.app}`
        : `${ctx.app} has no earlier release to roll back to`,
    );
  }
  if (target.record.version === live.record.version) {
    ctx.log(`${target.record.version} is already live, nothing to do`);
    return;
  }

  ctx.log(`Rolling back ${live.record.version} → ${target.record.version}`);
  await activate(ctx, {
    ...target.record,
    releasedAt: new Date().toISOString(),
    releasedBy: ctx.releasedBy,
  });
}
