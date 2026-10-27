import {
  assetPrefix,
  devServer,
  federation,
  loadAppDescriptor,
  releaseVersion,
} from '@govcloud-mfe/mf-config';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

const appDir = import.meta.dirname;
const app = loadAppDescriptor(appDir);

export default defineConfig({
  plugins: [pluginReact(), pluginModuleFederation(federation(app, { appDir }))],
  source: {
    define: { __RELEASE_VERSION__: JSON.stringify(releaseVersion()) },
  },
  html: { title: 'GovCloud MFE' },
  output: { assetPrefix: assetPrefix(app) },
  server: devServer(app),
});
