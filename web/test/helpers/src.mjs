/**
 * Loads the TypeScript modules of web/src/ into the node:test process.
 *
 * Node 24 strips TypeScript types on the fly, but its ESM resolver does not add file
 * extensions and knows nothing about Vite's `?raw` imports — both of which the sources use.
 * Two synchronous module hooks (node:module registerHooks, in-process, no extra dependency)
 * bridge that gap:
 *   1. a relative specifier without an extension resolves to the `.ts` file;
 *   2. `<pkg>/x.svg?raw` is loaded as a module exporting the file contents as a string,
 *      exactly like Vite does, so ui/icons.ts works unchanged.
 *
 * Because the hooks must be installed before any TS module is resolved, the modules are
 * imported dynamically here and re-exported as namespaces. Test files import from this
 * helper only — never from ../src/**.ts directly.
 */
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAW_FORMAT = 'wegwerk-raw';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.svg?raw')) {
      if (specifier.startsWith('.')) {
        return { url: new URL(specifier, context.parentURL).href, format: RAW_FORMAT, shortCircuit: true };
      }
      const resolved = nextResolve(specifier.replace(/\?raw$/, ''), context);
      return { url: `${resolved.url}?raw`, format: RAW_FORMAT, shortCircuit: true };
    }
    if (/^\.{1,2}\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (context.format === RAW_FORMAT || url.endsWith('.svg?raw')) {
      const file = fileURLToPath(url.replace(/\?raw$/, ''));
      return { format: 'module', source: `export default ${JSON.stringify(readFileSync(file, 'utf8'))};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const SRC = new URL('../../src/', import.meta.url);
const load = (rel) => import(new URL(rel, SRC).href);

export const types = await load('data/types.ts');
export const time = await load('data/time.ts');
export const periods = await load('data/periods.ts');
export const timeline = await load('data/timeline.ts');
export const version = await load('data/version.ts');
export const filter = await load('data/filter.ts');
export const urlState = await load('data/url-state.ts');
export const searchIndex = await load('data/search-index.ts');
export const dataIndex = await load('data/index.ts');
export const dataLoad = await load('data/load.ts');
export const entity = await load('data/entity.ts');
export const entityGeometry = await load('data/entity-geometry.ts');
export const format = await load('ui/format.ts');
export const badge = await load('ui/badge.ts');
export const listSummary = await load('ui/list-summary.ts');
export const categories = await load('ui/categories.ts');
export const verdict = await load('data/verdict.ts');
export const forecast = await load('data/forecast.ts');
export const answer = await load('data/answer.ts');
export const entityFile = await load('data/entity-file.ts');
export const listItem = await load('ui/list-item.ts');
export const uiDetail = await load('ui/detail.ts');
export const uiSearch = await load('ui/search.ts');
export const mapLayers = await load('map/layers.ts');
