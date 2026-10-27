import dashboard from '@govcloud-mfe/dashboard';
import type { ModuleDefinition } from '@govcloud-mfe/platform-sdk';
import settings from '@govcloud-mfe/settings';

/**
 * The composition: every team's module compiled into this app, in navigation order.
 *
 * This list (with apps/web/package.json) is the only place modules are wired in. Adding, removing
 * or re-routing a module is a pull request here, reviewed by the platform team (.github/CODEOWNERS).
 * Everything under modules/<name>/ belongs to that module's team.
 */
export const modules: readonly ModuleDefinition[] = [dashboard, settings];
