import { createModuleFlags } from '@govcloud-mfe/platform-sdk';

/** Typed hooks for this module's own flags. Keys come from ../feature-flags.json at compile time. */
export const flags = createModuleFlags<typeof import('../feature-flags.json')>('settings');
