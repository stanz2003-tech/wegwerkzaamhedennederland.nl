# `@wegwerk/pipeline` — NDW open data → static data files

Downloads the NDW open-data feeds (DATEX II v3, gzipped XML), classifies every
situation and writes the compact JSON/GeoJSON files the website reads. It is a
plain Node 24 ESM program with one dependency ([`saxes`](https://www.npmjs.com/package/saxes),
a streaming XML parser) and no state other than a few cache files, so it can run
anywhere — locally, or every five minutes in GitHub Actions.

The data contract it must satisfy is `web/src/data/types.ts`; the agreements it
shares with the rest of the project are in `docs/build-contracts.md`. The field
research behind the classification rules is in `docs/onderzoek.md` §2.

## Architecture

```
bin/run.js                CLI: flags → runPipeline(), one summary line, exit code
└── src/pipeline.js       orchestration: per source fetch → parse → build → geocode → write
    ├── src/sources.js         feed definitions (url, role, conditional, validation floor)
    ├── src/fetch.js           download, gunzip, retries, conditional GET, local files
    ├── src/parse.js           streaming DATEX II reader → Situation { recs[], locs[] }
    ├── src/classify.js        record types → category, sub type, severity, closed flag
    ├── src/merge.js           all records of one situation → one flat item (+ clean())
    ├── src/time.js            active / upcoming / ended / future, validPeriods, openings
    ├── src/geometry.js        posList/point parsing, NL clipping, rounding, midpoint
    ├── src/vild.js            TMC/AlertC location table (road, road name, from → to, point)
    ├── src/roads.js           road number + road type detection
    ├── src/geocode.js         PDOK reverse geocoder with a persistent cache
    ├── src/sources-friendly.js publisher name → display name + gemeente/province hint
    ├── src/title.js           display title (fallback chain, address clean-up, road prefix, cap)
    ├── src/item.js            composes the above into ItemProperties + ItemDetail
    ├── src/output.js          writes every output file, hashes them, manifest last
    ├── src/slug.js            slugify(), identical to the frontend implementation
    ├── src/bridges.js         bridge registry lookup, naming rules, VILD merge, openings, seen ids
    ├── src/dedup.js           folds the RWS/Melvin double publication into one item
    └── src/log.js             timestamped structured logging on stderr
```

### Data flow of one run

1. **Select sources** (`--sources`, default all three).
2. **Fetch** each feed (`src/fetch.js`): 60 s header/idle timeout, two retries
   with backoff, gunzip into a UTF-8 chunk stream. The planning feed is fetched
   with `If-None-Match`; on HTTP 304 the previous parse is replayed from
   `cache/last/planning.ndjson` instead. `--from-file name=path` reads a local
   `.xml`/`.xml.gz` instead of downloading.
3. **Parse** (`src/parse.js`): `saxes` builds one `<sit:situation>` subtree at a
   time (never the whole document) and hands it over as a `Situation`. Every
   situation is also appended to `cache/last/<source>.ndjson` for step 2 of the
   next run.
4. **Build items** (`src/item.js`): classify → merge records → decide the time
   window (items that ended or start beyond 30 days are dropped here) →
   geometry (`gml:posList` lines win over points; AlertC + VILD is the last
   resort) → publisher name → provisional item. Duplicate situation ids across
   sources are dropped (first one wins: planning before actueel).
5. **Reverse geocode** (`src/geocode.js`), live items first, then active, then
   planned, until the per-run cap is reached. Every item is then finalised into
   the exact `ItemProperties` / `ItemDetail` shapes.
6. **Write** (`src/output.js`): three GeoJSON collections, the index files, 32
   detail shards, `bruggen.json`, `meta.json` and finally `manifest.json`. Every
   file is written to `<name>.tmp` and renamed, so a reader never sees a half
   file.
7. **Persist caches**: geocode cache (pruned), bridge seen-ids, ETags.

## CLI

```
node pipeline/bin/run.js --out <dir> [options]
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--out <dir>` | *required* | output directory (created when missing) |
| `--sources <a,b>` | `planning,actueel,bruggen` | subset of the feeds to process |
| `--from-file name=path` | — | read one source from a local `.xml`/`.xml.gz` instead of downloading; repeatable |
| `--now <iso>` | current time | pretend it is this moment (reproducible runs, tests) |
| `--no-geocode` | geocoding on | never call PDOK, serve place names from the cache only |
| `--geocode-max <n>` | `400` | maximum number of *new* PDOK lookups this run |
| `--cache <dir>` | `pipeline/cache` | cache directory |
| `--force` | off | ignore stored ETags, always download and re-parse |
| `--verbose` | off | debug logging on stderr |
| `--help` | — | print the usage block |

One line goes to **stdout**, everything else to stderr:

```
ok planning=16359 actueel=811 bruggen=1553 active=5494 upcoming=8272 live=107 dropped=0 merged=269 geocoded=2/0 ms=9805 rss=492MB
```

`geocoded=<new lookups>/<items left without a cached place>`,
`merged=<planning duplicates folded into their actual measure>` (see
`src/dedup.js` and "Known limitations"). `merged` is an addition to the summary
line documented in `docs/build-contracts.md`; nothing parses the line, the
workflow only prints it in the job summary.

### Exit codes

| Code | When | stdout |
|------|------|--------|
| `0` | at least one source succeeded and all files were written | `ok …` |
| `1` | every source failed (network + no usable cache), or the output could not be written | `error …` |
| `2` | validation floor failed: fewer than 1,000 planning or 50 actueel situations parsed — the previous data files are left untouched | `invalid …` |

Exit code 2 exists because a truncated or empty feed must never replace a good
data set: the uploader only ever sees a complete `manifest.json`.

## Output files

Measured on a real run of 2026-09-09 00:30 (16,355 planning + 860 actueel +
1,554 bruggen situations → 5,796 active, 8,261 planned, 144 live items;
14,201 index rows). `gz` is `zlib.gzipSync(level 9)`, which is roughly what
Cloudflare serves.

| File | Raw | Gzip | Content |
|------|-----|------|---------|
| `meta.json` | 1.0 KB | 0.5 KB | run metadata, per-source status, counts per category |
| `werk-actueel.geojson` | 3.61 MB | 0.55 MB | works/closures/events active now (5,796) |
| `werk-gepland.geojson` | 6.42 MB | 1.05 MB | not active yet, start within 30 days (8,261) |
| `live.geojson` | 61 KB | 8.8 KB | files, incidents, bridges open right now (144) |
| `index/all.json` | 2.74 MB | 0.42 MB | one positional `IndexRow` per item (17 fields, 14,201 rows) |
| `index/prov/<PVxx>.json` | 7 KB – 0.8 MB | — | the same rows per province, `_` = province unknown (1,150 rows) |
| `detail/00..31.json` | 0.15 MB each | 31 KB each | `ItemDetail` per id, shard = `sha1(id)[0..8] % 32` |
| `bruggen.json` | 85 KB | 11 KB | bridges with an opening now or within 7 days (56 of the 429 in the registry) |
| `manifest.json` | 3 KB | 1.4 KB | `path → sha1`, written last; the uploader diffs against it |
| **total** | **20.6 MB** | **3.4 MB** | 52 files |

Geometry is WGS84 `[lon, lat]`, 5 decimals (≈ 1 m), clipped to the Netherlands
bbox `[3.2, 50.5, 7.3, 53.7]`; features that end up without usable coordinates
are dropped and counted in `meta.dropped`.

### Field coverage of the same run (13,868 items)

| Field | Filled | Missing |
|-------|--------|---------|
| `gemeente` | 99.99 % | 1 item |
| `woonplaats` | 88.9 % | 1,546 items (11.2 %) — the Locatieserver has no woonplaats for every cell |
| `prov` | 100 % | 0 items (`index/prov/_.json` is empty) |
| `road` | 23.1 % | 10,664 items (76.9 %) — municipal streets have no A/N number |

Place coverage is a function of the geocode cache: it grew 11.3 % → 2.9 % →
0.01 % missing over three runs with `--geocode-max 4000`, and is now saturated
(12,011 cells, 2.1 MB, `pending 0` — every distinct 110 m cell in the feeds has
been looked up). Three cells genuinely have no place: the Locatieserver returns
nothing for them.

## Classification rules

First match wins, per situation (`src/classify.js`, see `docs/onderzoek.md` §2.2):

| # | Category | Condition | `sub` |
|---|----------|-----------|-------|
| 1 | `file` | an `AbnormalTraffic` record **and** the situation comes from `actueel_beeld` | `abnormalTrafficType` (`stationaryTraffic`, `slowTraffic` …) |
| 2 | `incident` | `Accident`, `VehicleObstruction`, `GeneralObstruction` or `EnvironmentalObstruction` | the specific type, or the record type when it is `other` |
| 3 | `brug` | `generalNetworkManagementType = bridgeSwingInOperation` | `bridgeSwingInOperation` |
| 4 | `evenement` | main record is `PublicEvent`, or any record has `causeType = publicEvent` | `publicEventType` |
| 5 | `afsluiting` | any record closes a whole road or carriageway (`roadClosed`, `carriagewayClosures`) | that closure type |
| 6 | `werk` | main record is `MaintenanceWorks`/`ConstructionWorks`, or a lane/speed measure caused by `roadMaintenance`/`constructionWork` | `roadMaintenanceType` (`resurfacingWork` …) |
| 7 | `overig` | everything else (spitsstroken, temporary speed limits, traffic control) | lane/speed/network/rerouting type |

* In the **planning** feed an `AbnormalTraffic` record is the *expected*
  hindrance of a roadwork, not a traffic jam — hence the feed condition on rule 1.
* `closed` is set as a flag on every item that closes a road or carriageway, so
  a closure caused by an event or roadworks is still recognisable.
* `sev` comes from DATEX `overallSeverity` (`none|lowest` → 0 … `highest` → 4).
* Record types the classifier does not know land in `overig` and are counted in
  `meta.unknownTypes`, which is how a change in the feed becomes visible.
* Items are only published when they are **active** (now inside a `validPeriod`,
  or between start and end when there are no periods) or **upcoming** (start
  within 30 days). One hour of grace after the end keeps items that publishers
  are late to close from bouncing back into "planned".

## Static lists (`pipeline/static/`, committed)

Rebuilt by hand, not on every run — they change a few times a year.

| File | Builder | Content |
|------|---------|---------|
| `vild.json` (1.0 MB) | `node bin/build-vild.js [--zip file] [--url …]` | VILD 6.13.A location table from the NDW zip: `loc[<nr>] = [type, road, roadName, name1, name2, [lon,lat], linRef, areaRef, hectoPos]` |
| `wegen.json` (108 KB) | `node bin/build-wegen.js` | every A/N/S/E road with slug, type, route names, centre, bbox (from `vild.json`) |
| `plaatsen.json` (465 KB) | `node bin/build-plaatsen.js` | 2,503 woonplaatsen + 342 gemeenten from the PDOK Locatieserver (requests paced 100 ms apart) |
| `bruggen.json` (94 KB) | `node bin/build-bruggen.js [--no-download] [--no-vild] [--from-file bruggen=path]` | bridge registry, 429 bridges: **all 359 VILD `P3.2` bridges** (named, with road and waterway) unioned with the 116 RIS-coded bridges accumulated from the feeds. A VILD bridge is matched to a RIS bridge when they are < 150 m apart and their roads do not contradict each other (46 matches, p90 = 70 m, max 139 m; the nearest *rejected* VILD bridge of an unmatched RIS id is ≥ 194 m away, so the threshold is not marginal). VILD-only bridges get the id `VILD-<nr>` and a page without openings. Merges with the existing file and with `cache/bruggen-seen.json`, so ids and slugs are never lost |

The page generator (`web/`) copies `wegen.json`, `plaatsen.json` and
`bruggen.json` and turns every entry into a page, so their `slug` fields are
permanent URLs: builders only ever add or update entries.

## Caches (`pipeline/cache/`)

| File | Written by | Committed? | Purpose |
|------|-----------|-----------|---------|
| `geocode.json` | every run | **yes** | PDOK reverse-geocode results keyed on the coordinate rounded to 3 decimals (~110 m cell), one line per entry. Entries that were not used this run are pruned after 90 days (2 days for cells first seen for a file/incident). Committing it means the site has place names from the first run onwards. |
| `bruggen-seen.json` | every run | **yes** | every bridge id (RIS-index) ever seen in the feeds with its coordinate, AlertC code, first and last sighting. `bin/build-bruggen.js` reads it to grow the registry. |
| `etags.json` | every run | no | last ETag/`Last-Modified`/publicationTime per source. Machine-local. |
| `last/<source>.ndjson` | every run | no (54 MB for planning) | the parsed situations of the previous run, one JSON object per line. Replayed when the feed is unchanged (HTTP 304) or when the download fails. |

`geocode.json` and `bruggen-seen.json` are the only files the data workflow
commits back to the repository.

## Adding a source

1. Add an entry to `SOURCES` in `src/sources.js`: `name`, `url`, `role`
   (`planning` = works/events, `live` = current picture, `bridges` = openings
   only), `conditional` (ETag + cached replay — only worth it for large, slowly
   changing feeds), `floor` (minimum number of situations; 0 = no floor) and a
   one-line `description`.
2. If its records need new handling, extend `KNOWN_TYPES` and the rules in
   `src/classify.js` (and `src/parse.js` when the records carry fields we do not
   read yet). Anything unknown ends up in `overig` + `meta.unknownTypes` rather
   than breaking the run.
3. Add a fixture: save one `<sit:situation>` element to
   `test/fixtures/<name>.xml` and assert the classification in
   `test/classify.test.js` and the item shape in `test/pipeline.test.js`.
4. `--sources <name>` then processes only that feed.

Note that `veiligheidsgerelateerde_berichten_srti` and
`tijdelijke_verkeersmaatregelen_afsluitingen` are deliberately *not* fetched:
their situations are already in `actueel_beeld`.

## Tests

```
npm test -w @wegwerk/pipeline      # node:test + line coverage of src/
```

147 tests, ≈ 98.6 % line coverage of `src/` (`title.js`, `bridges.js` and
`dedup.js` at 100 %). Everything runs offline: the XML fixtures in
`test/fixtures/` are real (anonymised only by shortening) situations from the
NDW feeds, `test/pipeline.test.js` runs the whole pipeline from generated
fixture feeds — through both `--from-file` and a mocked `fetch` that answers
HTTP 304 — and network code is always exercised with an injected `fetchImpl`.

On Windows, always pass an explicit glob (`node --test "test/**/*.test.js"`);
`node --test test/` fails there.

## Known limitations

* **Double publication is merged, but conservatively** (`src/dedup.js`). A
  running roadwork appears twice: as a planning situation (`RWS01_…_D2`,
  `NDW03_<n>`) and as an actual measure in `actueel_beeld` (`RWS01_…_D2_WWA`,
  `NDW18_<uuid>_SIT`). The actual measure survives, the planning item is
  dropped, its id lands in `detail.related` and every field the survivor lacks
  (description, detour, hindrance, the melvin.ndw.nu link) is copied over.
  Two paths lead to a merge, and both need the same publisher and overlapping
  windows:
  * *declared* — the publisher's own `relatedSituation` link or the same id
    base; then no road number is needed and up to 1 km between the midpoints is
    allowed (the two geometries often cover different stretches);
  * *geometric* — no link, so the same known road number, midpoints within
    250 m, and only when exactly one planning item qualifies.

  A real run merges ~270 items, of which ~250 are declared and ~20 rest on
  geometry alone (all of them `NDW18_<uuid>_SIT` republications of a Melvin
  closure by the same publisher, 0-66 m apart). The run log prints
  the distance spread of the merges, the near misses and (at `--verbose`) every
  pair that rested on geometry alone, so the thresholds stay judgeable. Items
  still shown twice: ambiguous sets (two works at one spot on one road) are
  deliberately left alone — a false merge hides a real closure.
* **Generic Melvin titles.** Six drop-down phrases ("Weg dicht in beide
  richtingen", "Snelheidsbeperking", …) are the warning comment of 11,313 of
  the ~16,000 planning situations, so `src/title.js` demotes them below the
  VILD road name and the geocoded street: the title becomes "Havenplein,
  Harlingen" and the phrase is left to the badge. Only when neither is known
  does the phrase itself become the title, with the place appended. That took
  the most-repeated title from 4,405× down to 64× (10,296 distinct titles over
  13,868 items). The phrase list is hard-coded: a new Melvin drop-down option
  needs a line in `GENERIC_COMMENTS`.
* **Records without a road number.** Roughly two thirds of the situations are
  municipal streets with no A/N number and no AlertC reference; they only get a
  road number when the reverse geocoder happens to return one
  ("Rijksweg A2", "N57"). Their `roadType` is `lokaal`.
* **Geocode budget.** PDOK is called sequentially, 80 ms apart, capped by
  `--geocode-max`; a first run on an empty cache therefore leaves thousands of
  items without `gemeente`/`woonplaats`. The committed cache is saturated now
  (12,011 cells), so a scheduled run with the default `--geocode-max 400` only
  pays for genuinely new locations — a handful per run. Items whose publisher is
  a `Gemeente …` or `Provincie …` also get their gemeente/province without any
  lookup.
* **Geocoding is the slow part.** Measured end to end: a cold run (download +
  parse 208 MB of XML) needs ~10 s for the data itself, a warm run that reuses
  the unchanged planning feed 2.8 s — but 1,500 new PDOK lookups add another
  ~140 s. The default `--geocode-max 400` keeps a scheduled run around 40 s.
* **Coordinate rounding in the geocode cache.** Two items less than ~110 m
  apart share one cache entry, so a street name can be off by a street near a
  cell boundary.
* **AlertC only.** Situations with neither `gml:posList` nor coordinates fall
  back to the VILD point of their AlertC location — a point on the road segment,
  not the exact work site.
* **Bridges.** A name comes from the VILD `P3.2` row when there is one;
  otherwise the rules in `src/bridges.js` build one from the reverse-geocoded
  street and place: a street that already ends in *brug*/*burg*/*sluis* becomes
  the name ("Ringersbrug, Alkmaar"), a generic street type is named by function
  ("Fietsbrug bij Alkmaar"), a road number keeps the documented form ("Brug in
  de N231 bij Aalsmeer") and anything else reads "Brug Noordveenweg,
  Weteringbrug". Colliding names are separated by their road or street, else by
  a stable ordinal — never a hash. **Slugs are frozen**: a bridge that already
  had a slug in the committed registry keeps it even when its name is repaired,
  because the URLs are indexed. Bridges that show up in the feeds but in neither
  source keep the name `Brug <RIS code>` until `bin/build-bruggen.js` runs
  again. 313 of the 429 bridges are VILD-only: they get a page that explains
  that no opening data is published for them.
* **`peakRssMb` is sampled** every 250 ms, so it is an approximation. The
  planning feed (208 MB of XML) is streamed, but the finished items are all held
  in memory: expect 400–500 MB peak RSS on a full run.
