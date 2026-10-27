/**
 * The platform's "golden path" for building a micro-frontend with Rsbuild + Module Federation.
 *
 * Every app's `rsbuild.config.ts` composes these helpers so that the things that *must* agree
 * across independently deployed apps — shared singletons, public paths, manifest output — are
 * defined exactly once.
 */
export { loadAppDescriptor } from './app-descriptor';
export { assetPrefix, releaseVersion } from './asset-prefix';
export { devServer } from './dev-server';
export { federation } from './federation';
export { sharedDependencies } from './shared';
