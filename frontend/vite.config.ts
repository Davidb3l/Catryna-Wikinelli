import path from 'path';
import fs from 'fs';
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

import { createDocsApi, defaultScanRoots, findProjects } from './docs-api';

// Plugin to serve .docs folder as API.
// Set DOCS_ROOT env var to point to a different project's .docs folder.
//
// The request handling itself lives in ./docs-api.ts so it can be exercised by
// `docs-api.test.ts` without booting a dev server. Only the on-disk wiring
// (which needs __dirname) is decided here.
function docsApiPlugin(): Plugin {
  // __dirname is /frontend, so go up 2 levels to reach sibling projects.
  const scanRoots = defaultScanRoots(path.resolve(__dirname, '../..'));

  const api = createDocsApi({
    docsRoot: process.env.DOCS_ROOT || path.resolve(__dirname, '../.docs'),
    findProjects: () => findProjects(scanRoots),
  });

  return {
    name: 'docs-api',
    configureServer(server) {
      for (const middleware of api.middlewares) {
        server.middlewares.use(middleware);
      }
    },
  };
}

export default defineConfig(() => {
  // SUITE_CONTRACTS §3.2: `catryna doctor` advertises the viewer at
  // http://localhost:<CATRYNA_VIEWER_PORT, default 1307>, so the viewer MUST
  // actually bind that exact port — otherwise the advertised `ui` URL lies.
  // Keep this parse in lockstep with `viewerPort()` in src/doctor.ts (empty,
  // non-numeric, out of 1..65535, or 0 falls back to the default).
  const DEFAULT_VIEWER_PORT = 1307;
  const rawPort = process.env.CATRYNA_VIEWER_PORT?.trim();
  const viewerPort =
    rawPort && /^\d+$/.test(rawPort) && Number(rawPort) >= 1 && Number(rawPort) <= 65535
      ? Number(rawPort)
      : DEFAULT_VIEWER_PORT;

  // The sidebar used to hardcode "v2.5.0" while package.json said 1.3.0 — the
  // same fabrication class as the fake coverage numbers. Read it at build time
  // so it cannot drift again.
  const pkgVersion = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'),
  ).version;

  return {
    define: {
      __CATRYNA_VERSION__: JSON.stringify(pkgVersion),
    },
    server: {
      port: viewerPort,
      // strictPort: fail loudly if the advertised port is taken, rather than
      // silently moving off the address doctor told the hub to frame.
      strictPort: true,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      docsApiPlugin(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
