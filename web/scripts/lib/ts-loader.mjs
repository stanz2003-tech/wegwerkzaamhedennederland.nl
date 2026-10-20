/**
 * Lets Node load the TypeScript modules of web/src/ (the build and the tests use the same code
 * as the browser).
 *
 * Node 24 strips TypeScript types on the fly, but its ESM resolver does not add file
 * extensions and knows nothing about Vite's `?raw` imports — both of which the sources use.
 * Two synchronous module hooks (node:module registerHooks, in-process, no extra dependency)
 * bridge that gap:
 *   1. a relative specifier without an extension resolves to the `.ts` file;
 *   2. `<pkg>/x.svg?raw` is loaded as a module exporting the file contents as a string,
 *      exactly like Vite does, so ui/icons.ts works unchanged.
 *
 * The hooks must be installed before any TS module is resolved, so import TS modules with
 * `importSrc()` (dynamic import), never statically.
 */
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const RAW_FORMAT = 'wegwerk-raw';
const INSTALLED = Symbol.for('wegwerk.ts-loader');

if (!globalThis[INSTALLED]) {
  globalThis[INSTALLED] = true;
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
}

const SRC = new URL('../../src/', import.meta.url);

/** `importSrc('ui/entity-snapshot.ts')` → that module of web/src/. */
export function importSrc(rel) {
  return import(new URL(rel, SRC).href);
}
