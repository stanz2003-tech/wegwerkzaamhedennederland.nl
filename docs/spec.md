# Wegwerkzaamheden Nederland — Technical & Design Spec (v0.2, 2026-09-08)

> **Changelog v0.2** (after `docs/onderzoek.md`): MapLibre GL JS **6.8.0** (not 5.x); pipeline cron every **5 min** (`1-59/5 * * * *`) with ETag-conditional reprocessing of the planning feed; only `planningsfeed_wegwerkzaamheden_en_evenementen`, `actueel_beeld` and `planningsfeed_brugopeningen` are downloaded (SRTI/afsluitingen/max-snelheden are subsets of actueel_beeld); live **files** come from `sit:AbnormalTraffic` in actueel_beeld; data files split into `werk-actueel` / `werk-gepland` / `live` + compact `index/*.json` + `detail/<shard>.json` (see `docs/build-contracts.md` v2 and `web/src/data/types.ts`); **programmatic SEO** pages for every road (`/weg/<slug>/`), every woonplaats (`/plaats/<slug>/`), every gemeente (`/gemeente/<slug>/`) and every bridge with openings (`/brug/<slug>/`), generated post-build from Vite-built template shells; attribution text `Kaart: © Kadaster, BRT Achtergrondkaart (CC BY 4.0) · Verkeersdata: NDW (CC0) · MapLibre`; AdSense only on text pages, never on the map canvas.

Working name: **Wegwerk** (site: "Wegwerkzaamheden Nederland"). One fast map of every roadwork, closure, traffic jam and incident in the Netherlands, fed automatically from NDW open data. Zero-maintenance, EUR 0–5/month, ad-funded later.

## 1. Product

**Users**: commuters, truck drivers, event visitors, contractors, residents. Intent: "Is de A2 dicht dit weekend?", "Wat is er aan de hand op de N57?", "Staat er file?", "Welke werkzaamheden zijn er in Utrecht?"

**Core screens**
1. `/` — full-screen map of NL with all *active* items; floating control panel (search, filters, list); detail panel per item; live status bar. URL state: `?cat=werk,afsluiting&z=..&c=lon,lat&id=..` (shareable deep links).
2. `/weg/a2/` (one per A-/N-road present in the data) — SEO page: "Wegwerkzaamheden A2 — actueel overzicht", list of current + upcoming items on that road, small map, FAQ block, internal links.
3. `/provincie/utrecht/`, `/gemeente/amsterdam/` — same pattern by region (phase 2; scaffold routes only).
4. `/afsluitingen/`, `/files/` — list pages (phase 2).
5. Static content: `/over/`, `/veelgestelde-vragen/`, `/privacy/`, `/cookies/`, `/disclaimer/`, `/contact/`.

**Categories (cat)** — colour + icon + Dutch label:

| cat | label (nl) | source records | colour token |
|-----|-----------|----------------|--------------|
| `werk` | Werkzaamheden | MaintenanceWorks; RoadOrCarriagewayOrLaneManagement with cause roadMaintenance/constructionWork (lane closures, deviations, narrow lanes); SpeedManagement with roadMaintenance cause | `--c-werk` amber `#F5A300` |
| `afsluiting` | Afsluiting | RoadOrCarriagewayOrLaneManagement type `roadClosed` / `carriagewayClosures` (whole carriageway closed) | `--c-afsluiting` signal red `#E0301E` (map: red/white dash pattern) |
| `file` | File | AbnormalTraffic (queueing/slow traffic) — exact source per `docs/research/live-files.md` | `--c-file` deep red `#8E0E1F` |
| `incident` | Incident | Accident, VehicleObstruction, GeneralObstruction (SRTI feed) | `--c-incident` magenta `#C2185B` |
| `brug` | Brugopening | GeneralNetworkManagement `bridgeSwingInOperation` | `--c-brug` teal `#0E7C86` |
| `evenement` | Evenement | PublicEvent | `--c-evenement` violet `#6D4AFF` |
| `overig` | Overig | everything else (rerouting-only, speed mgmt without works, etc.) | `--c-overig` slate `#5B6470` |

Severity `sev` 0–4 from `overallSeverity` (none/lowest=0, low=1, medium/unknown=2, high=3, highest=4) → line width/opacity + sort order.

## 2. Data pipeline (`pipeline/`, Node 24, ESM, no framework)

Inputs (NDW open data, https://opendata.ndw.nu/):
- `planningsfeed_wegwerkzaamheden_en_evenementen.xml.gz` (17 MB gz / 208 MB XML) — Melvin planning: all roadworks + events, all road authorities (RWS, provinces, municipalities). Parent record `sit:MaintenanceWorks` (id suffix `_BASE`) + child records (lane mgmt, rerouting with `sit:alternativeRoute` geometry). Extensions: `nle:roadworkHindranceCategory` (A–E), `nle:roadworkStatus`.
- `actueel_beeld.xml.gz` (~0.4 MB gz) — current situation picture from RWS/NDW (lane closures, speed mgmt, rerouting, bridge openings, incidents). TMC/AlertC references (VILD 6.13.A).
- `tijdelijke_verkeersmaatregelen_afsluitingen.xml.gz` — current closures.
- `veiligheidsgerelateerde_berichten_srti.xml.gz` — safety-related incidents (points).
- Live files: per research outcome (candidate: AbnormalTraffic records if present, else derived from speed data or an external source).
- `VILD6.13.A.zip` → `VILD6.13.A.dbf` (11,939 rows; `LOC_NR`, `LOC_TYPE`, `ROADNUMBER`, `ROADNAME`, `FIRST_NAME`, `SECND_NAME`, `LIN_REF`, `AREA_REF`, hectometre fields) plus `WGS84/vild_point.shp` (coordinates per point location) — maps `loc:specificLocation` → road number + names + coordinates. Downloaded once, converted to `pipeline/static/vild.json` by a script, committed.

Processing (streaming; RSS must stay < 1 GB so it runs on a GitHub Actions runner):
1. Download gz → gunzip stream → SAX-style parse (`saxes`) → per `sit:situation` build a compact record.
2. Merge records of one situation: parent (`MaintenanceWorks` / first record) supplies title, description, period, source; children supply impact (lanes, speed, closure type) and detours (`ReroutingManagement` → `detour` text; detour geometry as separate feature `cat:'omleiding'` linked by `parent` id is phase 2).
3. Geometry: `loc:gmlLineString/loc:posList` = "lat lon lat lon …" (WGS84; swap to [lon, lat]); several `locationContainedInItinerary` → MultiLineString; `loc:pointCoordinates` → Point; only AlertC (no coords) → resolve via VILD point coordinates. Round coords to 5 decimals. Drop features without geometry (count them in meta).
4. Road identification (`road`, `roadType`, `place`, `prov`): (a) AlertC `specificLocation` → VILD `ROADNUMBER` (+ `FIRST_NAME`/`SECND_NAME` for from/to); (b) regex on comments and source for `\b[AN]\d{1,3}\b`; (c) PDOK Locatieserver reverse geocode on the feature midpoint (`https://api.pdok.nl/bzk/locatieserver/search/v3_1/reverse?lat=..&lon=..&type=weg&rows=1&fl=straatnaam,gemeentenaam,provincienaam`) → `straatnaam`, `gemeentenaam`, `provincienaam`; cache by `id` in `pipeline/cache/geocode.json` (persisted between runs; at most ~400 new lookups per run, sequential with 60 ms spacing; geocode errors never fail the run).
5. Classification → `cat`, `sub` (see section 1). Time window: keep items with `end >= now - 1h` and `start <= now + 30 days` for `werk.geojson`; `live.geojson` = incidents, files and bridge openings valid now.
6. Outputs (`out/` → published):
   - `werk.geojson` — planned + active works/closures/events (FeatureCollection). Target < 3 MB gz.
   - `live.geojson` — files/incidents/bridges.
   - `meta.json` — `{generated, sources:{name:{publicationTime, records, lastModified, ok}}, counts:{cat:n}, active:n, upcoming:n, version}`.
   - `roads/index.json` — `[{road:'A2', type:'A', count, active, bbox} …]`; `roads/A2.json` — features for that road (properties + bbox + simplified geometry).
   - `search.json` — lightweight index `[id, title, road, place, cat, start, end, lon, lat]` for client search/list.
7. Robustness: each source fetched with timeout + 2 retries; if a source fails, reuse the previous output for that source (kept in cache) and set `ok:false` in meta (UI shows "bron tijdelijk niet bijgewerkt"); the run only fails when *all* sources fail. Non-zero exit → GitHub Actions failure → missing healthchecks.io ping → owner gets an email.

Feature properties (contract for the frontend; nulls omitted):
```json
{ "id": "AND01_…", "cat": "werk", "sub": "laneClosures", "sev": 2,
  "title": "A7 · Afsluitdijk", "road": "A7", "roadType": "A", "place": "Hollands Kroon", "prov": "Noord-Holland",
  "from": "Den Oever", "to": "Kornwerderzand", "dir": "positive",
  "desc": "Verkeer wordt omgeleid …", "detour": "Volg borden X …",
  "start": "2026-09-07T19:11:00Z", "end": "2026-09-07T23:00:00Z", "periods": [["…", "…"]],
  "lanes": { "closed": 1, "open": 1 }, "speed": 50, "delay": "upToTenMinutes",
  "src": "Rijkswaterstaat Midden-Nederland", "hind": "C", "status": "published", "upd": "2026-09-07T19:13:26Z" }
```
The client computes `active = start <= now && (end == null || end >= now)`.

## 3. Frontend (`web/`, Vite + vanilla TypeScript, MapLibre GL JS 5.x, no UI framework)

Why no framework: fewer dependencies to rot, small bundle, trivially hostable as static files.

**Basemap**: PDOK BRT Achtergrondkaart vector tiles (Kadaster, free, no key). Style JSON: `https://api.pdok.nl/kadaster/brt-achtergrondkaart/ogc/v1/styles/standaard__webmercatorquad?f=mapbox` (light) and `…/styles/darkmode__webmercatorquad?f=mapbox` (dark). Tiles: `https://api.pdok.nl/kadaster/brt-achtergrondkaart/ogc/v1/tiles/WebMercatorQuad/{z}/{y}/{x}?f=mvt` (min 0, max 17); glyphs provided by the style; no sprite. Layer ids in the style: `Onderlegger Nederland`, `waterdeelvlak`, `Bodemgebruik`, `Gebouw`, `wegdeellijn-contour`, `wegdeellijn`, `wegdeelvlak`, `registratiefgebiedlijn`, `spoorbaandeellijn`, `treinspoor`, `metro`, `tram`, `inrichtingselement lijn`, `hoogspanningsmast inrichtingselement_punt`, `waterdeelvlak_label`, `straatnamen`, `annotatie`. We fetch the style at runtime and **re-paint** it to our palette (warm paper land, muted water, quiet roads) before `map.setStyle`; a local copy ships as fallback (`web/public/styles/pdok-standaard.json`, `pdok-dark.json`). Attribution: "© Kadaster / PDOK · Data: NDW". Fallback basemap if PDOK is down: OpenFreeMap positron (`https://tiles.openfreemap.org/styles/positron`).

**Layers** (bottom → top): `werk-casing` → `werk-line` (colour by cat, width by sev + zoom; red/white dasharray for `afsluiting`) → `live-line` → `points` (circle + icon symbols; clustered below z9) → `selected` highlight. Hit area ≥ 44 px (invisible wide line for hit testing). Hover → cursor + light highlight; click → detail panel + URL `?id=`.

**Panel (left, floating, 380 px; bottom sheet on mobile)**: search (PDOK Locatieserver `suggest`/`free` for roads and places + local index for items), category chips (toggle), time chips (Nu · Vandaag · Dit weekend · 7 dagen · 30 dagen), sort (afstand / impact / start), virtualised list. **Detail** replaces the list with a back button: road badge (A = red badge white text, N = yellow badge black text, else neutral), title, status line ("Nu actief · nog 2 u 15 min" / "Start za 13 sep 22:00"), timeline bar, impact rows (rijstroken, snelheid, omleiding, vertraging), description, source + last update, share/copy link, "Route plannen" (Google Maps link with coordinates). Keyboard: Esc closes, arrows navigate the list.

**Status bar (top)**: brand mark + wordmark "WEGWERK", tagline "Alle wegwerkzaamheden van Nederland op één kaart", live pill (pulsing dot, "Bijgewerkt 21:45"; stale → amber "Data ouder dan 1 uur"), counts per category, theme toggle, menu (Over · Veelgestelde vragen · Privacy).

**Ads**: reserved slots with fixed dimensions (CLS 0): panel bottom 300×250 (desktop), list inline every 8 items (fluid 300×100), mobile anchor left to AdSense anchor ads. Rendered only when `window.__ADS_ENABLED__` (config); otherwise the slot is hidden and the layout is unchanged. CMP: Google-certified CMP placeholder (AdSense Privacy & messaging) — documented script stub.

**SEO pages**: static HTML per road generated at build (`web/scripts/gen-pages.mjs` reads the road list from the pipeline output) with unique `<title>`, description, `<h1>`, canonical, BreadcrumbList + FAQPage JSON-LD, plus `sitemap.xml` + `robots.txt`. Content hydrates from `roads/{road}.json`; a pre-rendered paragraph explains the page for crawlers.

**Performance budgets**: LCP < 2.5 s on 4G (first map tiles), JS < 300 kB gz total, 2 font families (latin subset, `font-display: swap`), preload the display weight only. `prefers-reduced-motion` honoured.

**A11y**: WCAG 2.2 AA; all controls keyboard reachable, visible focus (2 px yellow ring on dark, ink ring on light), list items are buttons, map has `aria-label` and the list is the text alternative, colour is never the only cue (icon + label per category).

## 4. Design direction — "Bord" (Dutch road-signage language, editorial-cartographic)

The one thing people remember: the interface looks like it was made from Dutch road signs — **verkeersgeel** detour yellow on **asfalt** dark chrome, red A-badges and yellow N-badges, a thin yellow/black barrier stripe as the brand mark — laid over a calm, paper-toned map.

**Tokens** (`web/src/styles/tokens.css`):
```css
:root {
  /* brand */
  --geel: #FFC917;        /* verkeersgeel (detour signs) — primary accent */
  --geel-ink: #1B1B1F;    /* text on yellow */
  --asfalt: #15171B;      /* dark chrome */
  --asfalt-2: #1F2229;    /* raised dark surface */
  --lijn: #E9E6DF;        /* light hairline */
  --papier: #F7F4EC;      /* light surface (map paper tone) */
  --papier-2: #FFFFFF;
  --ink: #16181D; --ink-2: #4A4F58; --ink-3: #6B717C;
  --a-badge: #D8232A; --n-badge: #F7C600; --e-badge: #0B7A3B;
  /* categories */
  --c-werk: #F5A300; --c-afsluiting: #E0301E; --c-file: #8E0E1F; --c-incident: #C2185B;
  --c-brug: #0E7C86; --c-evenement: #6D4AFF; --c-overig: #5B6470;
  --ok: #1E8E3E; --warn: #B26A00;
  /* type */
  --font-display: "Overpass", "Helvetica Neue", Arial, sans-serif;   /* Highway-Gothic-derived: signage feel */
  --font-body: "IBM Plex Sans", system-ui, sans-serif;               /* technical, tabular numerals */
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;            /* times, hectometres */
  /* shape & motion */
  --r-1: 6px; --r-2: 10px; --r-3: 16px;
  --shadow-1: 0 1px 2px rgba(0,0,0,.08), 0 8px 24px -12px rgba(0,0,0,.25);
  --dur-1: 150ms; --dur-2: 260ms; --ease-out: cubic-bezier(.16,1,.3,1);
}
```
Light theme (default): paper panels over the map, ink text, yellow accents, dark chrome only for the top bar (asphalt bar with yellow wordmark). Dark theme: asphalt panels, paper text, same accents; PDOK darkmode basemap re-painted to match.

**Typography scale**: display 32/40 (Overpass 800, tight tracking, uppercase for wordmark + road badges), h2 22/28, body 16/24, small 13/18, mono 12/16. Road badges: Overpass 800, letter-spacing .02em, `font-variant-numeric: tabular-nums`.

**Signature elements**
- Brand mark: 24×24 rounded square with 45° yellow/black stripes (3 stripes) — also the favicon; wordmark "WEGWERK" in Overpass 800 uppercase, "NEDERLAND" as a small tracked label.
- Barrier stripe: 3 px `repeating-linear-gradient(135deg, yellow, ink)` as the top border of the panel and as the timeline bar's elapsed fill.
- Category chips: icon + label, pill with a 3 px left colour bar; the active state fills with the category colour at 12 % + ink text.
- Detail card timeline: horizontal bar start → end, "NU" tick, elapsed portion in barrier stripe.
- Empty state: outlined road-sign shape with "Geen meldingen in dit gebied".
- Motion: panel slides in 260 ms ease-out; list items stagger 30 ms (max 8); live dot pulses 2 s (off under reduced motion); map `flyTo` 600 ms.

**Icons**: Lucide (inline SVG sprite, 1.75 px stroke): construction (werk), octagon-x (afsluiting), car-front (file), triangle-alert (incident), ship (brug), flag (evenement), circle-dot (overig), search, sliders-horizontal, x, chevron-left, share-2, navigation, sun, moon, layers.

**Anti-patterns to avoid**: Inter/Roboto/system fonts as the face of the site, purple gradients, uniform card grids, emoji icons, low-contrast grey text, hover-only affordances, unreserved ad slots, animating layout properties.

## 5. Hosting & operations (default plan; finalised after `docs/research/hosting.md`)

Default plan: **GitHub (public repo) + GitHub Actions cron + Cloudflare (Pages + R2)**.
- `.github/workflows/data.yml`: `schedule: "*/15 * * * *"` + `workflow_dispatch`; steps: checkout, `npm ci`, run pipeline, upload `out/*` to Cloudflare R2 (S3 API or `wrangler r2 object put`; secrets `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`), commit `pipeline/cache/geocode.json` back when changed (this commit doubles as the 60-day schedule keepalive), ping `HEALTHCHECK_URL` on success.
- `.github/workflows/deploy.yml`: on push to `main` → build `web/` → deploy to Cloudflare Pages (`wrangler pages deploy`).
- Data served from `https://data.<domein>/` (R2 custom domain, cache 5 min, CORS `*`); site from `https://<domein>/`. Frontend data base URL configurable (`VITE_DATA_BASE`), default `/data/` for local dev (the pipeline can write a copy to `web/public/data/`).
- Monitoring: healthchecks.io (free) expects a ping every 15 min; UptimeRobot on the site URL. Both email the owner.
- Local dev: `npm run data` (pipeline → `web/public/data`), `npm run dev` (Vite), `npm run build`, `npm test`.

## 6. Repo layout
```
/README.md                 Dutch: what it is, one-time setup checklist, costs, how to change things
/docs/spec.md              this file
/docs/onderzoek.md         research synthesis (Dutch)
/docs/research/*.md        detailed research reports
/pipeline/                 Node ESM: src/{fetch,parse,merge,geometry,vild,geocode,classify,output}.js, bin/run.js, static/vild.json, cache/, test/
/web/                      Vite: index.html, src/{main.ts,map/,ui/,data/,styles/}, public/{styles,icons}, scripts/gen-pages.mjs, templates/
/.github/workflows/        data.yml, deploy.yml
/package.json              npm workspaces: pipeline, web
```

## 7. Definition of done (first draft)
- `npm run data` produces `web/public/data/{werk,live}.geojson`, `meta.json`, `roads/*.json`, `search.json` from live NDW data in < 3 min on this machine.
- `npm run dev` shows the map with real data; filters, search, detail panel, deep links, dark mode and the mobile layout (375 px) work.
- `npm run build` produces `web/dist` with `/`, `/weg/<road>/` pages for every road present in the data, sitemap, robots and the legal/FAQ pages.
- Tests: pipeline unit tests (parser on fixture XML, classification, VILD lookup, geometry conversion) pass with `npm test` (node:test); ≥ 80 % of pipeline `src/` lines covered.
- Screenshots at 375, 768 and 1440 px in light + dark saved to `docs/screenshots/`.
- README (Dutch) explains: accounts needed (GitHub, Cloudflare, domain, healthchecks.io, later AdSense), secrets to set, how to change the domain, what to do if data stops updating, estimated costs.
