import { publicPathFor } from '@govcloud-mfe/contracts';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginComposition } from './build/composition-plugin';

/** CI sets RELEASE_VERSION to the 12-character commit SHA; local builds use `local`. */
const version = process.env.RELEASE_VERSION ?? 'local';

export default defineConfig({
  plugins: [pluginReact(), pluginComposition({ appDir: import.meta.dirname, version })],
  html: { title: 'GovCloud MFE' },
  output: {
    // Compiled against the immutable, versioned path the build is served from, so activating or
    // rolling back a release is just swapping which index.html is live.
    assetPrefix: publicPathFor(version),
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: { '/api': 'http://localhost:8080' },
    historyApiFallback: true,
  },
});
