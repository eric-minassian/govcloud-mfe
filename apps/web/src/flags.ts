import { createModuleFlags } from '@govcloud-mfe/platform-sdk';

/** The app's own (platform-owned) flags. Keys come from ../feature-flags.json at compile time. */
export const flags = createModuleFlags<typeof import('../feature-flags.json')>('web');
