# Build contracts (shared agreements between the parallel implementers) — v2

Read together with `docs/spec.md` (product + design) and `docs/onderzoek.md` (verified research; where it deviates from the spec, **onderzoek.md wins** — see its section 1 "Afwijkingen"). Four implementers work at the same time in disjoint areas; everything they share is defined here. If you need something not defined here, implement the most reasonable version, document it in your report, and never touch files you do not own.

## Ownership

| Owner | Files |
|-------|-------|
| **A — pipeline** | `pipeline/**` (existing: `package.json`, `src/log.js`, `src/sources.js` (outdated list — fix), `static/vild.json` (read-only), `tmp/fx/*.xml` fixtures from a previous attempt — reuse them for tests) |
| **B — web app** | `web/index.html`, `web/src/**` except `web/src/styles/pages.css`, `web/public/**` (except `public/lists/`), `web/fixtures/**`, `web/scripts/ensure-data.mjs`, `web/templates/partials/**`, `web/package.json` (scripts + deps), `web/test/**`. Existing partial files from a previous attempt (keep/finish/refactor freely): `src/data/{filter,load,search-index,time,url-state}.ts`, `src/ui/{ads,badge,categories,chips,format,icons,theme,toast,topbar}.ts`, `public/styles/pdok-{standaard,dark}.json`. Note `src/data/types.ts` changed (v2 contract) — adapt them. |
| **C — content, SEO pages, generator** | `web/templates/*.html` (not `partials/`), `web/scripts/gen-pages.mjs`, `web/scripts/dev-pages-plugin.mjs`, `web/scripts/lib/**`, `web/content/**`, `web/site.config.json`, `web/src/styles/pages.css`, `web/public/lists/**` (copies of the static lists). Existing partial files: `templates/{_head,list,road,static}.html`, `content/*.md`, `site.config.json`. |
| **D — infra & owner docs** | `.github/**`, `infra/**` (R2 upload script, wrangler config), root `README.md`, `docs/handleiding.md`, `.env.example`, `LICENSE` |
| **shared, read-only** | `docs/**` (except D's handleiding), `web/src/data/types.ts`, `web/src/styles/tokens.css` (append-only), `web/vite.config.ts`, `web/tsconfig.json`, root `package.json`, `.gitignore` (request changes in your report). Both shared files have since been extended on purpose: `types.ts` gained `ItemDetail.related` and `Meta.merged` for the de-duplicated RWS double publications, and `tokens.css` gained the appended accessibility block (`--ok-text`, `--warn-text`, `--danger-text`, `--live-*-text`, `--sheet-peek`) plus a darker `--text-3`. |

Tooling (installed, `npm install` done at the root, npm workspaces): Node 24, `web/`: vite 8.2, typescript 7.0, **maplibre-gl 6.8.0 (pinned exact; ESM-only, WebGL2-only)**, lucide-static 1.42, @types/node; `pipeline/`: saxes 6. Add dependencies only when unavoidable and say why. Verify library APIs against the installed typings (`node_modules/maplibre-gl/dist/maplibre-gl.d.ts`, `node_modules/vite/dist/node/index.d.ts`) — do not rely on memory of older versions.

## Data files (pipeline → web) — contract v2

Defined in `web/src/data/types.ts` (read it; the doc comment at the top lists every file). Summary:

| File | Content | Size target |
|------|---------|-------------|
| `meta.json` | `Meta` — generated time, per-source status (ETag, publicationTime, ok, reused), counts active/upcoming per category, **`horizon` {days, until} (v4: how far ahead the dataset reaches)**, dropped, unknownTypes, runMs, peakRssMb | < 5 KB |
| `werk-actueel.geojson` | `ItemCollection`, items active **now** (inside a `validPeriod` if periods exist, else start ≤ now ≤ end): planning items (werk/afsluiting/evenement/overig) + current RWS measures from actueel_beeld | ≈ 0.6 MB gz |
| `werk-gepland.geojson` | `ItemCollection`, not active, start within 30 days | ≈ 1–1.5 MB gz |
| `live.geojson` | `ItemCollection`, `file` (AbnormalTraffic), `incident`, `brug` (bridgeSwingInOperation) valid now, from actueel_beeld | < 100 KB gz |
| `index/all.json` | `IndexFile` — one `IndexRow` per item in the three collections | ≈ 0.4 MB gz |
| `index/prov/<PVxx>.json` | `IndexFile` per province (PV20–PV31, `_` = unknown) | small |
| `detail/<00..31>.json` | `DetailShard` — `ItemDetail` by id; shard = `parseInt(sha1(id).slice(0,8),16) % 32`. v4: `tl` (timeline `[start, end, imp, veh?][]`) and `tlTo` on time-varying items, `periods` derived from `tl` | ≈ 250 KB gz each |
| `bruggen.json` | `BridgeFile` — every bridge from the static registry that has openings now or within 7 days, plus bridges seen in the feeds but not yet in the registry | < 100 KB |
| `manifest.json` | `Record<path, sha1hex>` of all files above; the uploader (D) uploads only changed files | |

### Contract v4 — the verdict gets a time axis (2026-09-23)

v3 flattened every DATEX situation to one window, one period mask and one verdict, and took those
three from different records: the window was the hull over all records, the mask came from the
main record only, and the verdict was computed once over all records without looking at time.
A street works in eight phases — the last of which closed only the cycle path — read "dicht voor
iedereen" for 80 days, and a sports event whose ten closures all fell on the Sunday read "dicht"
from the Thursday on.

v4 adds, without removing anything v3 had:

| Field | Meaning |
|---|---|
| `ItemDetail.tl` | `TimelineSegment[]` = `[start, end, imp, veh?][]`, sorted and non-overlapping. Between two segments the measure does not apply. Built from the validity of every situation record separately. Present only on time-varying items (`per: true`). |
| `ItemDetail.tlTo` | The timeline is complete up to here. A moment after `tlTo` and before `end` is **unknown**, never "no hindrance". |
| `ItemDetail.periods` | Now derived from `tl` (segments merged regardless of impact), kept for display and v3 readers. `tl` is authoritative. |
| `ItemProperties.imp` / `veh` | The heaviest verdict over the whole timeline, for the map colour without detail. |
| `Meta.horizon` | `{ days, until }`: measures starting after `until` are not in the files. An empty answer past it is "nog niet bekend". |

Determinism rule for everything time-dependent in the detail: clip to **local midnight
(Europe/Amsterdam) of the day of the run**, never to the run clock, so a shard changes once a day
rather than with every run (see `startOfLocalDay` in pipeline/src/time.js).

Frontend data base URL: `import.meta.env.VITE_DATA_BASE ?? '/data/'` (always trailing slash). Production: `https://data.<domein>/v1/`.

Feature geometry: `Point`, `LineString` or `MultiLineString` in WGS84 `[lon, lat]`, 5 decimals, inside NL bbox `[3.2, 50.5, 7.3, 53.7]` (parts outside are dropped and counted). Feature `id` (GeoJSON top-level) = `properties.id` (so MapLibre `promoteId`/feature-state works).

## Static lists (owner A creates the generators; committed in `pipeline/static/`; C copies them to `web/public/lists/`)

| File | Generator | Content |
|------|-----------|---------|
| `pipeline/static/vild.json` | exists (`bin/build-vild.js` rebuilds) | TMC locations → road/name/coords |
| `pipeline/static/wegen.json` | `bin/build-wegen.js` (from vild.json) | `{version, roads: RoadEntry[]}`, `RoadEntry = {road:"A2", slug:"a2", type:"A"|"N"|"S"|"E"|"overig", names:string[] (route names like "Amsterdam → Osnabrück", roadName such as "Afsluitdijk"), lon, lat, bbox:[w,s,e,n], points:number}`. Include every VILD `ROADNUMBER` that starts with A, N, S/s or E; skip codes like `v100-CR1`. Expect ≈ 49 A + 552 N + Amsterdam s-routes. |
| `pipeline/static/plaatsen.json` | `bin/build-plaatsen.js` (PDOK Locatieserver `free?q=*&fq=type:woonplaats&rows=100&start=N&fl=woonplaatsnaam,woonplaatscode,gemeentenaam,gemeentecode,provincienaam,provinciecode,centroide_ll` — 2,503 woonplaatsen in 26 pages; same for `type:gemeente` — 342) | `{version, gemeenten: Gemeente[], woonplaatsen: Woonplaats[]}`, `Gemeente = {code, naam, slug, prov, provCode, lon, lat}`, `Woonplaats = {code, naam, slug, gemeente, gemeenteCode, prov, provCode, lon, lat}`. Slug = `slugify(naam)`; when two woonplaatsen share a slug, ALL of them get `slugify(naam) + '-' + slugify(gemeente)`. Gemeente names are unique. Pace requests 100 ms apart. |
| `pipeline/static/bruggen.json` | `bin/build-bruggen.js` (download `planningsfeed_brugopeningen.xml.gz` + `actueel_beeld.xml.gz`, collect every `loc:externalLocationCode` with `RIS-index`, coordinates, optional `loc:alertCPoint` → VILD P3.2 bridge name/road/water, else reverse geocode (`reverse?lat&lon&type=weg&rows=1&fl=straatnaam,woonplaatsnaam,gemeentenaam,provincienaam,provinciecode`) for a fallback name "Brug in de <straat> bij <woonplaats>"; merge with the existing file so ids are never lost; also merge `pipeline/cache/bruggen-seen.json` which the pipeline appends to on every run) | `{version, bridges: BridgeRegistryEntry[]}`, `BridgeRegistryEntry = {id, slug, name, road?, water?, gemeente?, woonplaats?, prov?, provCode?, lon, lat}`; slug = `slugify(name)`, duplicates → `slugify(name)-slugify(woonplaats||gemeente)`, still duplicate → append `-<last 4 chars of id>`. |

## `web/site.config.json` (owner C; consumed by B, C, D)

Keep the existing keys (`name`, `longName`, `tagline`, `url`, `dataBase`, `contactEmail`, `locale`, `ogImage`, `refreshMinutes` (set to 5), `owner`, `ads`, `analytics`, `attribution`). Set `attribution` to the verified text: `Kaart: © Kadaster, BRT Achtergrondkaart (CC BY 4.0) · Verkeersdata: NDW (CC0) · MapLibre`. Add `"analytics": {"provider": "cloudflare", "token": ""}` semantics: when `token` is empty nothing loads. `url` has no trailing slash. Import with `import site from '../../site.config.json'`.

## Page shells and DOM contract

Every HTML page (app `web/index.html` and every template) has: `<html lang="nl">`, viewport meta with `viewport-fit=cover`, `<meta name="color-scheme" content="light dark">`, the theme-init partial **before** CSS (`web/templates/partials/head-theme.html`, owner B: reads `localStorage.theme` = `light|dark`, sets `document.documentElement.dataset.theme`; never throws), the exact Google Fonts tags below, favicon `/favicon.svg` (owner B, the striped brand mark), header/footer partials (owner B) injected at `<!-- @header -->` / `<!-- @footer -->`, a skip link to `#main`, `<main id="main">`.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Overpass:wght@400;600;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
```

Header partial `web/templates/partials/header.html` (owner B): `<header class="topbar" data-topbar>` with brand (link `/`), nav (`/` Kaart, `/wegen/` Wegen, `/plaatsen/` Plaatsen, `/bruggen/` Bruggen, `/afsluitingen/`, `/files/`, `/veelgestelde-vragen/`, `/over/`), live pill `<span class="live" data-live hidden>`, theme toggle `<button class="theme-toggle" data-theme-toggle aria-label="Donker of licht thema">`. Footer partial: attribution, links `/privacy/`, `/cookies/`, `/disclaimer/`, `/colofon/`, `/contact/`, and "Cookie-instellingen" link (`data-cmp-open`). Styles: B owns `web/src/styles/{base.css,chrome.css,app.css,map.css,panel.css,components.css}`; C owns `web/src/styles/pages.css` (article/list layouts; imports nothing, uses tokens only). `base.css` imports `tokens.css`.

### Templates (owner C) ↔ entry scripts (owner B)

Templates live in `web/templates/<type>.html` and are Vite entries (see `web/vite.config.ts`). Each contains its `<script type="module" src="/src/pages/<type>.ts">` and `{{placeholders}}` that the generator fills. Text placeholders are HTML-escaped by the generator; `{{{raw}}}` inserts trusted HTML.

| Template / URL | body attributes | required elements (ids) | B's script loads |
|---|---|---|---|
| `road.html` → `/weg/<slug>/` | `data-page="road" data-road="A2" data-road-type="A" data-lon data-lat data-bbox="w,s,e,n"` | `#entity-map`, `#entity-summary`, `#entity-list`, `#entity-updated`, `#entity-empty` (hidden), `#entity-count-active`, `#entity-count-upcoming` | `index/all.json` filtered on `road` (case-insensitive) + `live.geojson` for files on that road; map fitted to bbox |
| `place.html` → `/plaats/<slug>/` and `/gemeente/<slug>/` | `data-page="place" data-place-kind="woonplaats|gemeente" data-place-name="Breda" data-gemeente="Breda" data-prov-code="PV30" data-lon data-lat` | same ids as road | `index/prov/<PVxx>.json` filtered on `woonplaats`/`gemeente` name (exact, case-insensitive); map centred on lon/lat, zoom 12 (woonplaats) / 11 (gemeente) |
| `bridge.html` → `/brug/<slug>/` | `data-page="bridge" data-bridge-id="NLSPL…" data-lon data-lat` | `#entity-map`, `#bridge-status`, `#bridge-openings` (list of upcoming openings), `#entity-updated`, `#entity-empty` | `bruggen.json` → entry by id; also nearby works from `index/all.json` within 2 km (optional) |
| `list.html` → `/afsluitingen/`, `/files/`, `/vandaag/`, `/dit-weekend/`, `/wegen/`, `/plaatsen/`, `/bruggen/` | `data-page="list" data-list="afsluitingen|files|vandaag|weekend|wegen|plaatsen|bruggen"` | `#list-summary`, `#list-items`, `#list-empty`; for `wegen/plaatsen/bruggen` the generator pre-renders the full link list server-side (no data needed) and B only adds live counts when cheap | `index/all.json` (+ `live.geojson` for files) |
| `static.html` → `/over/`, `/veelgestelde-vragen/`, `/privacy/`, `/cookies/`, `/disclaimer/`, `/colofon/`, `/contact/` | `data-page="static"` | — | nothing (only topbar/theme wiring) |

B's page scripts: `web/src/pages/{road,place,bridge,list,static}.ts`. They import `../styles/base.css`, `../styles/chrome.css`, `../styles/components.css`, `../styles/pages.css` and call `mountTopbar()`. Item lists on entity pages use the same list-item component as the app; each item links to `/?id=<id>` (deep link into the map) and shows badge, title, status line ("Nu actief · nog 2 u 15 min" / "Start za 13 sep 22:00"), tags. Entity maps are small MapLibre maps (same basemap module, interactive but no controls except zoom) drawing only the filtered items; if WebGL is unavailable show a static text fallback.

Ad slots: `<div class="ad-slot ad-slot--article" data-ad-slot="article" aria-hidden="true"></div>` on content pages only (never on the map canvas). B's `web/src/ui/ads.ts` fills them when `site.ads.enabled` (loads AdSense once, one `<ins>` per slot, reserves 280 px height when active) and otherwise leaves them hidden with zero height. Consent: `ads.ts` assumes Google's own CMP (AdSense "Privacy & messaging") is delivered by the AdSense script; expose `openCmp()` for the footer link (`data-cmp-open`) that calls `googlefc.callbackQueue.push({CONSENT_DATA_READY: () => googlefc.showRevocationMessage()})` when available.

### Generator (owner C): `web/scripts/gen-pages.mjs` + `web/scripts/dev-pages-plugin.mjs` + `web/scripts/lib/render.mjs`

- Inputs: `web/site.config.json`, templates + partials, content (`web/content/*.md` with front matter, Markdown → HTML with a small hand-written converter or a ≤ 300-line dependency-free renderer; headings, paragraphs, lists, links, bold/italic, tables are enough), static lists from `pipeline/static/{wegen,plaatsen,bruggen}.json` (fallback: `web/public/lists/*.json`; if none exist yet, generate from a small built-in sample so the build never fails).
- `gen-pages.mjs --dist`: runs **after** `vite build`. Reads the built shells `web/dist/templates/<type>.html` (Vite already injected hashed `<script>`/`<link>` tags), renders every page into `web/dist/<path>/index.html`, writes `dist/sitemap.xml` (split into `sitemap-<n>.xml` + index if > 5,000 URLs; `<lastmod>` = build date), `dist/robots.txt`, `dist/ads.txt` (only when `site.ads.enabled`), copies `pipeline/static/{wegen,plaatsen,bruggen}.json` to `dist/lists/`, then deletes `dist/templates/`. Prints "N pagina's gegenereerd (wegen W, plaatsen P, gemeenten G, bruggen B)". Must finish in < 30 s for ≈ 4,500 pages; idempotent; never throws on missing data (warn instead).
- `dev-pages-plugin.mjs` exports `devPagesPlugin()` (a Vite plugin) used by `web/vite.config.ts`: `configureServer` middleware that, for a request matching a generated route (`/weg/*`, `/plaats/*`, `/gemeente/*`, `/brug/*`, `/afsluitingen/`, `/files/`, `/vandaag/`, `/dit-weekend/`, `/wegen/`, `/plaatsen/`, `/bruggen/`, `/over/`, `/veelgestelde-vragen/`, `/privacy/`, `/cookies/`, `/disclaimer/`, `/colofon/`, `/contact/`), renders the template with the same `render.mjs`, passes it through `server.transformIndexHtml(url, html)` and responds with `text/html`; unknown slugs → 404 page rendered from `static.html`. Never crash the dev server on a bad template — respond 500 with the error text.
- Pages: roads (all in `wegen.json`), woonplaatsen + gemeenten (all in `plaatsen.json`), bridges (all in `bruggen.json`), the seven list pages, the seven static pages (colofon added: attribution lines from `docs/onderzoek.md` §2.5, owner info from site.config).
- Every page: unique `<title>` and description in Dutch (templates below), canonical (`site.url + path`), OG tags, `BreadcrumbList` JSON-LD; road/place/bridge pages add `FAQPage` JSON-LD with 3–4 entity-specific Q&As, a pre-rendered intro paragraph with the entity facts we know statically (road: route names, type; place: gemeente/provincie; bridge: road/water/place), an "In de buurt / Andere wegen" block with internal links (roads: 12 numerically nearest roads of the same type; places: other woonplaatsen of the same gemeente + the gemeente page; bridges: other bridges in the same gemeente), and the ad slot.
- Title templates: road `Wegwerkzaamheden {road} – actuele werkzaamheden, afsluitingen en files | {site.name}`; woonplaats `Wegwerkzaamheden in {naam} ({gemeente}) – actueel overzicht | {site.name}`; gemeente `Wegwerkzaamheden gemeente {naam} – alle werkzaamheden en afsluitingen | {site.name}`; bridge `Brugopeningen {name} ({road or woonplaats}) – actuele en geplande openingen | {site.name}`.
- Slugs: use `slug` fields from the static lists verbatim (they follow `slugify()` in `web/src/data/types.ts`; the generator must not re-slug).

## `web/package.json` scripts (owner B sets; C and D rely on them)

```
"dev":   "node scripts/ensure-data.mjs && vite",
"build": "node scripts/ensure-data.mjs && vite build && node scripts/gen-pages.mjs --dist",
"preview": "vite preview",
"typecheck": "tsc --noEmit",
"test": "node --test \"test/**/*.test.mjs\""   # a bare directory fails on Windows/Node 24
```
`ensure-data.mjs` (B) copies `web/fixtures/data/**` to `web/public/data/` only when `public/data/meta.json` is missing.

## Pipeline CLI (owner A; D's workflow calls it)

`node pipeline/bin/run.js --out <dir> [--sources planning,actueel,bruggen] [--from-file name=path]... [--now <iso>] [--no-geocode] [--geocode-max <n>] [--cache <dir>] [--force] [--verbose]`
- Exit 0 when at least one source succeeded and outputs were written; exit 1 when all sources failed or output could not be written; exit 2 when the validation floor failed (fewer than 1,000 planning situations or fewer than 50 actueel situations parsed → do not publish).
- Conditional GET on the planning feed (`If-None-Match` with the ETag stored in `<cache>/etags.json`); unchanged → reuse `<cache>/last/planning.ndjson` (the parsed, merged situations of the previous run) so light runs take seconds. `--force` ignores ETags.
- Prints one summary line to stdout: `ok planning=<n> actueel=<n> bruggen=<n> active=<n> upcoming=<n> live=<n> dropped=<n> geocoded=<n>/<pending> ms=<n> rss=<n>MB`.
- Writes `manifest.json` last (so a partial write is detectable).
- `pipeline/cache/geocode.json` and `pipeline/cache/bruggen-seen.json` are committed to the repo (D's workflow commits them back when changed).

## Conventions

- TypeScript strict; no `any` unless justified. ESM everywhere. No frameworks. No emoji as icons — Lucide SVGs via `import x from 'lucide-static/icons/<name>.svg?raw'`.
- Dutch UI text ("je"-vorm, consistent), English code and comments. Dates in `Europe/Amsterdam` via `Intl.DateTimeFormat('nl-NL', …)`.
- Colours only via tokens; the category → token/icon/label map is `web/src/ui/categories.ts` (B), which also exposes hex values for MapLibre paint (must equal tokens.css).
- Interactive elements ≥ 44×44 px, visible focus ring, keyboard operable; `prefers-reduced-motion` respected (tokens zero the durations).
- Tests: pipeline `node --test` with fixtures, ≥ 80 % line coverage of `pipeline/src`; web: `tsc --noEmit` clean + `node --test` unit tests for pure helpers (compiled by `node --experimental-strip-types` or kept in `.mjs`).
- Never commit, never push; no global installs; no accounts or external submissions.
