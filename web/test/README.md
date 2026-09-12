# Web tests

```bash
npm test -w @wegwerk/web        # node --test test/*.test.mjs
node --test "test/*.test.mjs"   # same thing from web/
node --test "test/filter.test.mjs"
```

No test dependencies: `node:test` + `node:assert/strict` only.

## How the TypeScript sources are loaded

The sources are TypeScript, the tests are `.mjs`. Node 24.14 strips TypeScript types on the
fly, so `import('./src/data/time.ts')` works out of the box — but two things in the sources
are Vite-isms that Node's resolver does not understand:

1. **extensionless relative imports** (`import { toMs } from './time'`) — Node's ESM resolver
   never guesses an extension, so this throws `ERR_MODULE_NOT_FOUND`;
2. **`?raw` imports** (`import flag from 'lucide-static/icons/flag.svg?raw'` in `ui/icons.ts`,
   used by `ui/categories.ts`) — a Vite feature, unknown to Node.

Options considered: compiling with `tsc` into a temp directory (the emitted JS keeps the
extensionless specifiers, so it needs post-processing anyway, and `?raw` still breaks), or
bundling with Vite before testing (slow, and a build step between source and assertion).

**Chosen: two synchronous module hooks** (`node:module` `registerHooks`, in-process, no extra
dependency), installed by `test/helpers/src.mjs`:

- a relative specifier without an extension resolves to the `.ts` file;
- `*.svg?raw` is loaded as a module whose default export is the file contents, exactly like
  Vite does.

Because hooks must be installed before any TS module is resolved, `src.mjs` imports the
modules dynamically and re-exports them as namespaces. **Test files import from
`./helpers/src.mjs`, never from `../src/**.ts` directly.**

```js
import { filter, format, time } from './helpers/src.mjs';
assert.equal(format.fmtDuration(135 * 60_000), '2 u 15 min');
```

The hooks live in the test process only; nothing in `web/src` or the Vite build changes.

## What is covered

| File | Module under test |
|------|-------------------|
| `time.test.mjs` | `data/time.ts` — active vs upcoming, time windows, weekend across DST, Europe/Amsterdam calendar |
| `periods.test.mjs` | `data/periods.ts` — recurring nightly pattern detection and summaries |
| `filter.test.mjs` | `data/filter.ts` — geometry helpers, category/time/bbox/query filtering, sort orders |
| `url-state.test.mjs` | `data/url-state.ts` — parse/serialise round trip, unknown values ignored |
| `search-index.test.mjs` | `data/search-index.ts` + the pure helpers of `data/index.ts` — matching, ranking, row mapping |
| `types.test.mjs` | `data/types.ts` — `slugify`, `shardFromHashPrefix`, `DATA_FILES`, constants |
| `format.test.mjs` | `ui/format.ts` — Dutch dates, durations, status lines, impact labels, numbers |
| `categories.test.mjs` | `ui/categories.ts` — the MapLibre hex values must equal the `--c-*` tokens in `src/styles/tokens.css` (both themes; the stylesheet is parsed) |
| `fixtures.test.mjs` | `fixtures/data/**` part 1 — file set, manifest sha1 per file, `meta.json`, the three GeoJSON collections (ids, properties, NL bbox, active vs upcoming) |
| `fixtures-index.test.mjs` | `fixtures/data/**` part 2 — index rows vs features and geometry midpoints, province partitioning, detail shards vs `sha1(id) % 32`, recurring periods, `bruggen.json`, generator determinism |

Not covered (and why):

- `data/load.ts`, `data/detail.ts`, `data/index.ts` loaders — `fetch`, `crypto.subtle` and
  `import.meta.env`; only their pure validators and row helpers are tested here.
  `fixtures.test.mjs` runs every validator against the real fixture files.
- `search-index.ts` PDOK Locatieserver calls (`suggestPlaces`, `lookupPlace`) — network.
- `map/**` and the DOM parts of `ui/**` (`panel`, `list`, `detail`, `topbar`, `search`,
  `chips`, `controls`, `theme`, `toast`, `ads`, `analytics`, `badge`, `icons`, `list-item`) —
  they need a browser (MapLibre needs WebGL2). These belong in a Playwright suite.

## Fixtures

`web/fixtures/data/**` is generated, not hand-edited:

```bash
npm run fixtures -w @wegwerk/web      # node scripts/make-fixtures.mjs
node scripts/make-fixtures.mjs --now 2026-12-24T08:30:00Z --out /tmp/fx
```

The generator is deterministic: every timestamp is an offset from one base timestamp
(`--now`, default `2026-09-09T12:00:00Z`), and two runs produce byte-identical files.
`fixtures-index.test.mjs` re-runs it in memory and fails when the committed files are stale, so
after changing `web/fixtures/source/items.mjs` you must regenerate.
