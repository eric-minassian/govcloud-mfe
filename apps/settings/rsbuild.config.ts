import { assetPrefix, devServer, federation, loadAppDescriptor } from '@govcloud-mfe/mf-config';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

const appDir = import.meta.dirname;
const app = loadAppDescriptor(appDir);

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation(federation(app, { appDir, rootComponent: './src/App.tsx' })),
  ],
  html: { title: `${app.displayName} (standalone)` },
  output: { assetPrefix: assetPrefix(app) },
  server: devServer(app),
});
