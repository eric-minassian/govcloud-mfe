import { defineModule } from '@govcloud-mfe/platform-sdk';
import { lazy } from 'react';
import descriptor from '../module.json';

/**
 * The settings module's public API — the only thing other packages can import from it.
 * The app's composition list (apps/web/src/modules.ts) picks this up at build time.
 */
export default defineModule({
  ...descriptor,
  component: lazy(() => import(/* webpackChunkName: "module-settings" */ './App')),
});
