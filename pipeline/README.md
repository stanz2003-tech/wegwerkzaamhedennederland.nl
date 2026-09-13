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
    ├── src/roads.js           road number + road type detection (positional sources first; text only from road authorities)
    ├── src/geocode.js         PDOK reverse geocoder with a persistent cache
    ├── src/sources-friendly.js publisher name → display name + gemeente/province hint
    ├── src/title.js           display title (fallback chain, address clean-up, road prefix, cap)
    ├── src/impact.js          impact verdict: imp (dicht/rijbaan/hinder/geen/onbekend), veh, per, spd, lc
    ├── src/detour.js          alternativeRoute → detourGeom (≤ 12 points, Douglas–Peucker + thinning)
    ├── src/item.js            composes the above into ItemProperties + ItemDetail
    ├── src/entities.js        groups items per road / gemeente for roads/<slug>.json, gemeenten/<slug>.json
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
   the exact `ItemProperties` / `ItemDetail` shapes; the impact verdict
   (`src/impact.js`) is computed here because it needs the road type, which may
   rest on the geocoded street name.
6. **Write** (`src/output.js`): three GeoJSON collections, the index files, 32
   detail shards, `bruggen.json`, one `roads/<slug>.json` per road and one
   `gemeenten/<slug>.json` per gemeente that has items, `meta.json` and finally
   `manifest.json`. Every file is written to `<name>.tmp` and renamed, so a
   reader never sees a half file; entity files of roads/gemeenten that lost
   their last item are deleted.
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
ok planning=16750 actueel=1030 bruggen=1376 active=5154 upcoming=8372 live=187 dropped=0 merged=244 geocoded=23/0 ms=10603 rss=418MB
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

Measured on a real run of 2026-09-13 14:51 (contract v3; 16,750 planning +
1,030 actueel + 1,376 bruggen situations → 5,154 active, 8,372 planned, 187
live items; 13,713 index rows). `gz` is `zlib.gzipSync(level 9)`, which is
roughly what Cloudflare serves.

| File | Raw | Gzip | Content |
|------|-----|------|---------|
| `meta.json` | 1.0 KB | 0.5 KB | run metadata, per-source status, counts per category, `version: "3"` |
| `werk-actueel.geojson` | 3.48 MB | 0.58 MB | works/closures/events active now (5,154) |
| `werk-gepland.geojson` | 7.37 MB | 1.25 MB | not active yet, start within 30 days (8,372) |
| `live.geojson` | 84 KB | 12 KB | files, incidents, bridges open right now (187) |
| `index/all.json` | 3.00 MB | 0.51 MB | one positional `IndexRow` per item (22 fields, 13,713 rows) |
| `index/prov/<PVxx>.json` | 7 KB – 0.9 MB | — | the same rows per province, `_` = province unknown |
| `detail/00..31.json` | 0.18 MB each (5.74 MB) | 43 KB each (1.34 MB) | `ItemDetail` per id, shard = `sha1(id)[0..8] % 32`; `detourGeom` accounts for 0.97 MB raw / 0.37 MB gzip of that |
| `bruggen.json` | 80 KB | 10 KB | bridges with an opening now or within 7 days |
| `roads/<slug>.json` | 5.81 MB (361 files) | 1.15 MB | every item on one road, geometry + detail; median 3.6 KB, largest `a2.json` 505 KB / 58 KB gz (307 items), then `a1` 323 KB, `a28` 305 KB, `a27` 267 KB, `a73` 233 KB |
| `gemeenten/<slug>.json` | 16.6 MB (331 files) | 2.85 MB | every item in one gemeente; median 29 KB, largest `rotterdam.json` 674 KB / 98 KB gz (754 items), then `utrecht` 582 KB, `groningen` 422 KB, `eindhoven` 421 KB, `tilburg` 320 KB |
| `manifest.json` | 48 KB | 12 KB | `path → sha1`, written last; the uploader diffs against it |
| **total** | **45.1 MB** | **8.2 MB** | 743 files |

The entity files are a second copy of every item (each item lands in its
gemeente file and, when it has a road number, in its road file), which is why
they are half of the raw bytes. They are served per page and never all at once.

Geometry is WGS84 `[lon, lat]`, 5 decimals (≈ 1 m), clipped to the Netherlands
bbox `[3.2, 50.5, 7.3, 53.7]`; features that end up without usable coordinates
are dropped and counted in `meta.dropped`.

### Field coverage of the same run (13,868 items)

| Field | Filled | Missing |
|-------|--------|---------|
| `gemeente` | 99.99 % | 1 item |
| `woonplaats` | 88.9 % | 1,546 items (11.2 %) — the Locatieserver has no woonplaats for every cell |
| `prov` | 100 % | 0 items (`index/prov/_.json` is empty) |
| `road` | 22.6 % | 10,739 items (77.4 %) — municipal streets have no A/N number; 75 fewer than before the 2026-09-13 detection change (road numbers in a gemeente's text no longer count) |

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

## Impact verdict (`src/impact.js`, contract v3)

`imp` says what the measure means for someone who wants to use the road. It is
evaluated over **all** records of the merged situation (a `MaintenanceWorks`
parent with a `roadClosed` child is `dicht`), first match wins:

| `imp` | When |
|-------|------|
| `dicht` | a `roadClosed` record; `carriagewayClosures` on a road that is **not** A or N (local streets and stadsroutes have one carriageway, so "rijbaan dicht" closes the street); or cat `brug` |
| `rijbaan` | `carriagewayClosures` on an A- or N-road — one direction is closed, the other may be open |
| `hinder` | `laneClosures`, `lanesDeviated`, `narrowLanes`, `useOfSpecifiedLanesOrCarriagewaysAllowed`, `hardShoulderRunningInOperation`, a `SpeedManagement` record or `temporarySpeedLimit`, `lanes.closed > 0`, cat `file` / `incident`, a delay band of `upToTenMinutes` or worse on a `werk` item |
| `geen` | delay band `negligible` and none of the above; events without any traffic measure |
| `onbekend` | nothing applies |

Interpretation decisions that go beyond the literal list (all in the module
header of `src/impact.js`, all covered by `test/impact.test.js`):

* `temporaryTrafficLights` / `trafficBeingManuallyDirected` and a lone
  `ReroutingManagement` record count as `hinder` — the road is usable, with
  lights, a regulator or a detour.
* A delay band on an `evenement` / `overig` item only counts from
  `betweenTenMinutesAndThirtyMinutes`: Melvin's default for every planning
  object is `upToTenMinutes`, which would otherwise turn every festival into
  `hinder`. On `werk` items `upToTenMinutes` is `hinder`, as specified.
* `veh` is the union of `forVehiclesWithCharacteristicsOf/vehicleType` over
  the records that produced the winning verdict — but only when **every** one
  of them restricts vehicles (one unrestricted `roadClosed` next to a
  `roadClosed` for bicycles still closes the road for everyone). Mapping:
  `car`, `lorry|heavyGoodsVehicle|heavyVehicle → lorry`, `bicycle`, `moped`,
  `bus`, `agriculturalVehicle → agricultural`, anything else `other`.
  Fallback: when none of the winning records has a vehicle list, the vehicle
  list of the `ReroutingManagement` record is used (it says who the *detour* is
  for, which in ~80 % of the situations that carry both lists equals who the
  closure is for) — only when every rerouting record agrees.
* `per` is set exactly when `ItemDetail.periods` is present: recurring
  sub-periods that do not span the whole window. Melvin publishes the same
  `validPeriod` once per record copy, so identical pairs are collapsed first
  (`src/merge.js`); two copies of the whole window are not a recurring measure.
* `spd` = temporary speed limit in km/h, `lc` = lanes closed, only when > 0.

Distribution on the run above (13,715 items, after the road-detection change
of 2026-09-13): `dicht` 6,235 (45 %), `hinder` 4,720 (34 %), `rijbaan` 1,497
(11 %), `geen` 1,263 (9 %), `onbekend` 0. Per road type (dicht / rijbaan /
hinder / geen): A 55 / 993 / 757 / 3, N 23 / 504 / 733 / 46, S 14 / 0 / 10 / 0,
lokaal 6,143 / 0 / 3,220 / 1,214. Per category:
all `afsluiting` items are `dicht` (5,088) or `rijbaan` (1,531), `werk` is
`hinder` (4,422) or `geen` (718), `evenement` splits into `dicht` 1,085 /
`geen` 545 / `hinder` 72 / `rijbaan` 13. `veh` on 1,103 items: bicycle 510,
car 298, moped 195, lorry 105, bus 27, agricultural 14, other 3 (914 of them
`dicht` — mostly closed cycle paths and streets closed for cars only; the
common combinations are single groups, `car+bicycle` 19 and `bicycle+moped`
10). `per` 1,198, `spd` 3,234 (30 km/h 1,706, 70 755, 50 455, 10 235), `lc`
712 (1 lane 487, 2 lanes 174, 3 lanes 48, 4 lanes 3).

## Detour geometry (`src/detour.js`)

`sit:alternativeRoute` of a `ReroutingManagement` record is still never an
item's location (`src/parse.js` keeps it apart as `detourLine`), but the first
rerouting record with a usable route becomes `ItemDetail.detourGeom`: the
itinerary parts concatenated, lat-first `posList` turned into `[lon, lat]`,
clipped to the NL bbox, rounded to 5 decimals, and reduced to at most 12
points — Douglas–Peucker with a doubling tolerance first, uniform thinning if
a zigzag still does not fit; first and last point always survive. 5,337 of the
13,713 items carry one (5,644 have detour text), 1,070 of them at the 12-point
cap; the shards grow by 0.97 MB raw / 0.37 MB gzip (+20 % / +37 %). `PARSER_VERSION` in `src/pipeline.js` is bumped with this
kind of change, so a cached parse from an older parser is downloaded again
instead of replayed on HTTP 304.

## Entity files (`src/entities.js`)

`roads/<slug>.json` for every road in `static/wegen.json` and
`gemeenten/<slug>.json` for every gemeente in `static/plaatsen.json` that has
≥ 1 item (active or planned within 30 days), shape `EntityFile`: the compact
feature **with geometry** plus the full detail per item, active first, then by
start. Absent file = no items, so files of entities that lost their last item
are removed each run.

* **Road matching** goes through `normalizeVildRoad()`: carriageway variants
  and branch letters fold onto the base road, so an item on "A12 hrb" lands in
  `roads/a12.json` (and in `roads/a12-hrb.json` too, if the registry had such
  an entry). Case and spaces do not matter.
* **Gemeente matching** is `slugify(item.gemeente) === slugify(gemeente.naam)`,
  the same `slugify` as the page generator.
* **`generated`** is the latest `ItemDetail.upd` of the file's items, so the
  bytes depend on the items only (see "Known limitations" on churn); the run
  time is used only for a file whose items all lack `upd`.
* **Churn**: see "Known limitations" — the actueel feed changes every minute,
  so the entity files of the affected roads/gemeenten change with it; the
  uploader defers them to the runs in which the planning feed changed.

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

187 tests, ≈ 98.9 % line coverage of `src/` (`impact.js`, `detour.js`,
`entities.js`, `title.js`, `bridges.js`, `dedup.js`, `roads.js` and `item.js`
at 100 %). `test/item.test.js` runs a real gemeente record through
`buildItem()`/`finalizeItem()` with the 's-Gravenhage wording, once as a
gemeente (lokaal, dicht) and once as Rijkswaterstaat (A4, rijbaan). Everything
runs offline: the XML fixtures in `test/fixtures/` are real (anonymised only
by shortening) situations from the NDW feeds, `test/pipeline.test.js` runs the
whole pipeline from generated fixture feeds — through both `--from-file` and a
mocked `fetch` that answers HTTP 304 — and network code is always exercised
with an injected `fetchImpl`. `test/output.test.js` parses
`web/src/data/types.ts` and asserts that every emitted key and every
`IndexRow` position exists in the contract.

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
* **Geocoding is the slow part.** Measured end to end on 2026-09-13: a cold
  run (download + parse 208 MB of XML, 97 new PDOK lookups, entity files)
  took 31 s at 571 MB peak RSS; a warm run that reuses the unchanged planning
  feed (HTTP 304) 10.6 s at 418 MB. 1,500 new PDOK lookups would add another
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
  in memory: expect 500–600 MB peak RSS on a full run (the entity files add the
  second copy of every item at write time).
* **The impact verdict rests on the road type.** `carriagewayClosures` is
  `rijbaan` on A/N roads and `dicht` everywhere else; an N-road whose number
  the geocoder did not return is `lokaal` and therefore `dicht`. The rule set
  cannot tell a fully closed dual carriageway (both directions published as
  `carriagewayClosures`) from a one-direction closure — both are `rijbaan`.
  Single-carriageway N-roads (many provincial roads) are the same problem in
  the other direction: their `carriagewayClosures` is really `dicht`.
* **Road numbers in free text are only trusted from road authorities.**
  `detectRoad()` (`src/roads.js`) takes the road from the positional sources
  first — `roadOrJunctionNumber`, the VILD location, the geocoded street when
  it *is* a road number ("Rijksweg A20", "N57"). A road number that only
  appears in the publisher's text counts when the publisher is Rijkswaterstaat
  or a province, or when the item was not geocoded at all; a gemeente or
  waterschap cannot publish a motorway measure, so its "A4" is a landmark or a
  detour and the item stays `lokaal`. Before this rule (2026-09-13) 51 of the
  1,021 A-road `rijbaan` items were gemeente-published local streets that
  merely mentioned a motorway (`NDW03_232949`, "A4 · Breedtebeperking < 2m",
  Gemeente 's-Gravenhage, geocoded to the Binckhorstlaan). Measured on the
  14:55 run: 75 items change `road` (44 A → lokaal, 30 N → lokaal, 1 A → other
  A), 47 of them flip `imp` from `rijbaan` to `dicht`; A-road `rijbaan` goes
  1,021 → 993, and every one of the 16 gemeente-published A-road `rijbaan`
  items left has a VILD location or a geocoded motorway street (on/off-ramps
  in Rotterdam, Utrecht, Amsterdam). The remaining risk is the reverse: a
  gemeente item on a motorway ramp that was neither VILD-referenced nor
  geocoded to the motorway now reads as `lokaal`/`dicht`; and a gemeente item
  that was not geocoded at all still takes the road from its text.
* **`veh` is only as good as the publisher's vehicle list.** Melvin fills
  `forVehiclesWithCharacteristicsOf` on ~8 % of the situations; the other
  92 % read as "everyone", which for a street closed for cars but open for
  cyclists is the conservative answer.
* **Entity-file churn and R2 Class A operations.** Every item lives in two
  entity files, so a change in the actueel feed (published every minute)
  touches the files of every affected road and gemeente. Two measures keep
  that affordable:
  * **Deterministic bytes.** `generated` of an entity file is the latest
    `upd` of its items (`entityGenerated()` in `src/output.js`), not the run
    time, so a file whose items did not change is byte-identical to the
    previous run's and the uploader skips it — also in GitHub Actions, where
    `pipeline/out` is a fresh directory every run and no previous file exists
    to compare with. (An earlier version kept the old file on disk when only
    `generated` differed; that only worked locally.) With the run time in
    every file all 692 entity files would be re-uploaded every run: measured
    742 of 743 files changed between two runs — ≈ 6.4 million Class A
    operations per month against a free tier of 1,000,000.
  * **Deferral.** The uploader (`infra/upload-r2.mjs`) only uploads
    `roads/*.json` and `gemeenten/*.json` on runs in which the planning feed
    actually changed (`meta.json` → `sources.planning.reused` is not `true`),
    roughly every 15 minutes; on the runs in between every change in those
    files comes from the actueel feed and waits for the next planning change.

  Measured content churn (`generated` masked) on 2026-09-13: 68 of 692 entity
  files over 5 minutes without a planning change (14:51 → 14:55), 143 over
  8 minutes and 127 over 12 minutes each spanning one planning publication
  (14:55 → 15:03 → 15:15). Per month (8,640 runs): ~50 core uploads per run
  (`meta.json`, the collections, 14 index files, all or nearly all 32 detail
  shards, `manifest.json`) ≈ 430,000, plus ≈ 135 entity uploads on each of the
  2,880 planning-changed runs ≈ 390,000 — **≈ 820,000 Class A operations per
  month**, 82 % of the free tier ($4.50 per further million). The
  consequences for readers: `generated` inside an entity file is the latest
  publisher update among its items, and a road/gemeente page can lag the map
  by up to ~15 minutes for live items.
