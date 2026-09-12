import { defineConfig } from 'vite';
import { globSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-ignore: plain-JS Vite plugin (owner C); it ships no type declarations.
import { devPagesPlugin } from './scripts/dev-pages-plugin.mjs';

/**
 * Entries: the app shell (index.html) and every page-type template in `templates/`
 * (partials excluded). Vite bundles their scripts/styles and emits the built shells to
 * `dist/templates/<type>.html`; `scripts/gen-pages.mjs --dist` then stamps out the thousands of
 * SEO pages (roads, places, municipalities, bridges, lists, static pages) from those shells
 * and removes `dist/templates/`. In dev, `devPagesPlugin` renders the same pages on request.
 */
const root = resolve(import.meta.dirname);
const templateInputs = globSync('templates/*.html', { cwd: root });

export default defineConfig({
  root,
  base: '/',
  appType: 'mpa',
  plugins: [devPagesPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    cssTarget: 'chrome100',
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        ...Object.fromEntries(
          templateInputs.map((p) => [
            'templates/' + p.replace(/^templates[\\/]/, '').replace(/\.html$/, ''),
            resolve(root, p),
          ]),
        ),
      },
      output: {
        // Vite 8 / rolldown only accepts the function form of `manualChunks`.
        manualChunks: (id: string): string | undefined =>
          id.includes('node_modules/maplibre-gl') ? 'maplibre' : undefined,
      },
    },
  },
  optimizeDeps: {
    // MapLibre 6 spawns its worker with `new Worker(new URL('./maplibre-gl-worker.mjs', ...))`.
    // The dev-time dep optimizer does not copy that file, so the worker 404s and the style
    // never finishes loading. Serving maplibre-gl unbundled in dev fixes it.
    exclude: ['maplibre-gl'],
  },
  server: {
    port: 5173,
    strictPort: false,
    open: false,
  },
});
