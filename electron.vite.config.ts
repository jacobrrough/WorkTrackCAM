import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
// vite-plugin-monaco-editor is a CJS module — its `default` export is the
// plugin factory. Hoist the interop dance into a local const so the
// renderer plugin list stays clean. The CAD Design workspace
// (`src/renderer/design/CadQueryEditor.tsx`) self-hosts Monaco's web
// workers via this plugin so the Electron app stays offline-capable —
// the alternative (`@monaco-editor/react`'s default CDN loader) would
// require internet at runtime, which CLAUDE.md rules out for a desktop
// app shipped to a single shop.
//
// Bundle-size note: Monaco adds ~3 MB to the renderer bundle. Acceptable
// trade-off for V1 — this app is desktop Electron, not a web app, and
// the editor is the central surface of the CAD workspace.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import monacoEditorPluginModule from 'vite-plugin-monaco-editor'

// Handle both ESM-default and CJS-interop shapes so the plugin loads
// reliably across the electron-vite + Vite tooling chain. The CJS build
// in `node_modules/vite-plugin-monaco-editor/dist/index.js` ships the
// factory on `module.exports.default`, which Node's ESM interop wraps
// into `{ default: { default: fn } }` depending on the loader.
const monacoEditorPlugin =
  (monacoEditorPluginModule as unknown as { default?: typeof monacoEditorPluginModule }).default ??
  monacoEditorPluginModule

export default defineConfig({
  main: {
    define: {
      __APP_PRODUCT__: JSON.stringify('cam'),
      __APP_SHELL__: JSON.stringify(process.env.WT_SHELL ?? 'legacy')
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    define: {
      __APP_PRODUCT__: JSON.stringify('cam'),
      // Dark-launch flag for the ground-up WorkTrack3D shell (P3). 'legacy'
      // boots the proven ShopApp; `WT_SHELL=next npm run dev` boots the new
      // shell. The default flips to 'next' at the P5 cutover.
      __APP_SHELL__: JSON.stringify(process.env.WT_SHELL ?? 'legacy')
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    // Vite bundles `new Worker(new URL('./*.ts', import.meta.url),
    // { type: 'module' })` automatically; the explicit `worker` block
    // below pins the output format so the plate-thumbnail worker (and
    // any future renderer worker) ships as a true ES module rather
    // than the legacy IIFE format. ESM workers let Three.js + project
    // utilities resolve via the same import graph the main renderer
    // uses, which keeps the bundle size honest (no second Three.js
    // copy) and means the worker code is statically analyzable for
    // tree-shaking. We do NOT register the React plugin in the worker
    // pipeline -- workers never render JSX. Additive-only: the main
    // `plugins` array (react, monaco) is unchanged.
    worker: {
      format: 'es'
    },
    plugins: [
      react(),
      // Only the editor worker is wired — CadQuery scripts are Python,
      // not one of the Monaco-bundled language servers (TS / CSS / JSON
      // / HTML). Keeping the worker list minimal trims ~2 MB off the
      // renderer bundle relative to the default `['editorWorkerService',
      // 'css', 'html', 'json', 'typescript']` set.
      monacoEditorPlugin({
        languageWorkers: ['editorWorkerService'],
        // electron-vite sets the renderer `build.outDir` to an ABSOLUTE path.
        // vite-plugin-monaco-editor's default worker-output path is
        // `path.join(root, buildOutDir, 'monacoeditorwork')`, and joining the
        // renderer root with an absolute `buildOutDir` on Windows yields a
        // malformed nested path (`src/renderer/C:/.../out/renderer/...`) that
        // `mkdirSync` then fails on (ENOENT). Pin the dist path to the
        // (absolute) buildOutDir only, so the workers land at
        // `out/renderer/monacoeditorwork` — which the renderer base (`./`) +
        // the default `monacoeditorwork` publicPath resolves to at runtime.
        customDistPath: (_root: string, outDir: string): string =>
          resolve(outDir, 'monacoeditorwork')
      })
    ]
  }
})
