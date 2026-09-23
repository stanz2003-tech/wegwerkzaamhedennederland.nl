# infra/ — workflows and the R2 uploader

Everything that runs *around* the code: GitHub Actions workflows (`.github/workflows/`),
the dependency-free uploader to Cloudflare R2, and this note. Owner-facing instructions in
Dutch live in the root `README.md` and `docs/handleiding.md`.

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `Data` (`data.yml`) | dispatched by the `Wekker` about every 10 min; hourly cron `7 * * * *` as fallback; or **Run workflow** with the `force` checkbox | `npm ci` (pipeline workspace only) → `node pipeline/bin/run.js --out pipeline/out --cache pipeline/cache --geocode-max 400` (the cap is a ceiling, not a cost: the committed geocode cache holds 12,000+ cells, so a run does 0–40 new PDOK lookups at 80 ms each — a few seconds; 400 would be 32 s) → on exit 0 `node infra/upload-r2.mjs` uploads only changed files to R2, deferring the entity files on runs in which the planning feed was unchanged (see the uploader section) → commit `pipeline/cache/{geocode,bruggen-seen,etags}.json` back when changed (`[skip ci]`) → keepalive (see below) → step summary → job `volgende` dispatches the `Wekker` (also when the data job failed). Exit 2 (validation floor) or 1 fails the job **without uploading**; the last good data stays online. `pipeline/cache/last/` (parsed planning feed) is kept between runs with `actions/cache`, keyed on the NDW ETag. |
| `Wekker` (`wekker.yml`) | dispatched by every `Data` run | waits 8 min on the environment `wekker` (wait timer, no runner, no billable time) → `node infra/wekker/check.mjs` checks that the site answers and that `meta.json` (fetched past the CDN) is younger than 30 min, and only then pings `HEALTHCHECK_URL` → dispatches the next `Data` run. See "The wekker" below. |
| `Deploy` (`deploy.yml`) | push to `main` touching `web/**`, `pipeline/static/**`, `package*.json`; or manual | Checks settings, `npm ci`, `npm run build -w @wegwerk/web` with `VITE_DATA_BASE=${{ vars.DATA_BASE }}`, creates the Pages project through the Cloudflare API if it does not exist yet, then `cloudflare/wrangler-action@v4` → `wrangler pages deploy web/dist --project-name=<CF_PAGES_PROJECT> --branch=main`. |
| `CI` (`ci.yml`) | every push and pull request (docs and cache commits ignored) | `npm test -w @wegwerk/pipeline`, `node --test "infra/test/**/*.test.mjs"`, `npm run typecheck -w @wegwerk/web`, fixture-data build, `web/dist` artifact (3 days). |

Concurrency groups prevent overlapping data runs (`cancel-in-progress: false`) and stale
deploys (`cancel-in-progress: true`).

### `defaults.run.shell: bash` in data.yml is load-bearing

GitHub's implicit shell is `bash -e {0}`; naming `bash` explicitly gets
`bash --noprofile --norc -eo pipefail {0}` (docs.github.com, workflow syntax). Two steps pipe
into `tee` so their output can go into the job summary, and without `pipefail` the step's exit
code is `tee`'s — always 0. A failing `upload-r2.mjs` would then have produced a green run
*and*, back then, a healthchecks.io ping while nothing was published. (The heartbeat has since
moved to the wekker's end-to-end check, see "The wekker" below.) Verified locally: the same script
piped into `tee` exits 0 under `bash -e` and 1 under `bash -eo pipefail`. The pipeline step is
unaffected because it reads `${PIPESTATUS[0]}` itself.

### The parsed-feed cache (`actions/cache`, `pipeline/cache/last/`)

`pipeline/cache/last/planning.ndjson` is the parsed planning feed — 52 MB after a real run.
The cache key is `pipeline-last-<hash of pipeline/cache/etags.json>`, and two rules keep it
honest:

- **Exact key only, no `restore-keys`.** A prefix match could restore a parse belonging to an
  older ETag while the committed `etags.json` claims it is current; NDW's `304 Not Modified`
  would then make the pipeline republish stale roadworks. A miss just means a full download
  and parse (measured 9,7 s), which is always correct.
- **The save key is recomputed after the run** (step `Cache key for this parse`) and compared
  with `steps.restore.outputs.cache-matched-key`. The pipeline rewrites `etags.json`, so using
  the restore step's `cache-hit` would have skipped saving exactly the parses that were new.

Action versions verified 2026-09-09 via the GitHub API (tags endpoint):
`actions/checkout@v7`, `actions/setup-node@v7`, `actions/cache@v6`, `actions/upload-artifact@v7`,
`cloudflare/wrangler-action@v4` (installs Wrangler 4). Dependabot (`.github/dependabot.yml`)
opens one grouped PR per month for actions and for npm minor/patch updates; ignoring them is fine.

### The wekker

GitHub runs `schedule:` on a best-effort basis. On this repository a `1-59/5` cron (288 runs a
day) produced 19 runs between 13 and 16 September 2026, with gaps up to 5 h 53 min. The cadence
therefore comes from a chain: every `Data` run ends by dispatching `wekker.yml`, which waits on
an environment wait timer and dispatches the next `Data` run.

- **No personal token.** Both dispatches use the job's `GITHUB_TOKEN`. Events from that token
  normally start no workflows, but `workflow_dispatch` and `repository_dispatch` "always create
  workflow runs" (docs.github.com, "Triggering a workflow", checked 2026-09-23).
- **No runner while waiting.** The wait is the environment's *wait timer* (1–43,200 minutes;
  "Wait time will not count towards your billable time", docs.github.com, deployments and
  environments reference). It is configured in *Settings > Environments*, not in the file.
- **One chain.** The wekker skips its dispatch when a `Data` run is already queued or running,
  and the `volgende` job skips when a wekker is already waiting. Combined with the `data`
  concurrency group this keeps exactly one chain, even when an hourly fallback run fires.
- **No loop without a timer.** If the environment lost its timer, the wekker would fire at once
  and the chain would spin. It refuses to dispatch when the previous `Data` run started less than
  `MIN_GAP_SECONDS` (360 s) ago, warns, and lets the hourly fallback restart the chain later.
- **The heartbeat lives here.** `infra/wekker/check.mjs` pings healthchecks.io only when the
  site answers and `meta.json`, fetched with a cache-buster, is fresh. The old ping at the end of
  the data job only proved that a job went green.
- Every wekker run creates a GitHub *deployment* for the environment (about 144 a day). That is
  cosmetic; nothing depends on it.

`infra/test/workflows.test.mjs` pins these lines down, so an edit that would let the chain loop or
split fails CI.

### Keepalive

GitHub disables scheduled workflows in public repositories after 60 days without repository
activity. Two mechanisms keep this one alive: the cache commits (whenever the NDW ETag or the
geocode cache changes, i.e. many times a day) and a `PUT /repos/{owner}/{repo}/actions/workflows/data.yml/enable`
call with the job's `GITHUB_TOKEN` (`permissions: actions: write`). The marketplace action
`gautamkrishnar/keepalive-workflow` was **not** used: on 2026-09-08 its repository returned
"Repository access blocked" (reason `tos`) from the GitHub API, and on 2026-09-09
`GET /repos/gautamkrishnar/keepalive-workflow` still answered HTTP 403 while the same
unauthenticated calls to `actions/*` succeeded — so a workflow referencing it would fail to
start. The API call is exactly what that action did in `use_api` mode.

The cache commits alone are not a guaranteed keepalive: pushes made with `GITHUB_TOKEN` do not
create workflow runs (docs.github.com, "Triggering a workflow": "events triggered by the
`GITHUB_TOKEN` will not create a new workflow run"), but they *are* repository activity, which
is what the 60-day rule looks at. The `enable` call — made on every run since the 03:xx UTC gate turned out never to fire — is the belt to that braces.

### Why the cache commit cannot loop

Three independent reasons, any one of which would be enough:

1. The push uses the job's `GITHUB_TOKEN`, and GitHub does not start workflow runs for events
   triggered by that token ("this prevents you from accidentally creating recursive workflow
   runs").
2. The commit message ends with `[skip ci]`, which GitHub honours for `push` and
   `pull_request` events (docs.github.com, "Skipping workflow runs").
3. `ci.yml` lists `pipeline/cache/**` under `paths-ignore`, and `deploy.yml` only triggers on
   `web/**`, `pipeline/static/**` and `package*.json` — the cache files match neither.

The step is `continue-on-error: true` and retries the push three times with a rebase in
between, so a lost race with another run never fails a publish that already succeeded.

## Secrets and variables

Repository **Settings > Secrets and variables > Actions**. Names are exact.

| Name | Kind | Used by | Value |
|---|---|---|---|
| `R2_ACCOUNT_ID` | secret | Data | Cloudflare account ID (R2 object storage > Account details) |
| `R2_ACCESS_KEY_ID` | secret | Data | R2 API token, permission *Object Read & Write*, scoped to the one bucket |
| `R2_SECRET_ACCESS_KEY` | secret | Data | shown once when the R2 token is created |
| `R2_BUCKET` | secret | Data | bucket name, e.g. `wegwerk-data` |
| `HEALTHCHECK_URL` | secret | Data | `https://hc-ping.com/<uuid>`; empty = no ping |
| `CLOUDFLARE_ACCOUNT_ID` | secret | Deploy | same account ID |
| `CLOUDFLARE_API_TOKEN` | secret | Deploy | user API token, *Account > Cloudflare Pages > Edit* |
| `DATA_BASE` | **variable** | Deploy | `https://data.<domein>/v1/` (https, trailing slash) |
| `CF_PAGES_PROJECT` | **variable** | Deploy | Pages project name, e.g. `wegwerk` |

Optional secrets: `R2_PREFIX` (default `v1`; if the data path ever changes, also change
`DATA_BASE`) and `R2_JURISDICTION` (only for a bucket created with *Specify jurisdiction*,
e.g. `eu`; the S3 endpoint then becomes `<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`).

Until the four `R2_*` secrets exist, the Data workflow's `preflight` job ends the run as
*skipped* with a notice instead of failing, so publishing the repository first does not
produce a failure e-mail every 5 minutes.

## Rotating the R2 token

1. Cloudflare dashboard > **R2 object storage** > Account details > **API tokens** > Manage >
   Create: *Object Read & Write*, bucket = the data bucket, no TTL. Copy Access Key ID and Secret.
2. GitHub > Settings > Secrets and variables > Actions > edit `R2_ACCESS_KEY_ID` and
   `R2_SECRET_ACCESS_KEY`.
3. Actions > Data > **Run workflow**. Green = done. Then delete the old token in Cloudflare.

Same idea for `CLOUDFLARE_API_TOKEN` (My Profile > API Tokens), followed by a manual Deploy run.

## The uploader (`infra/upload-r2.mjs`)

Node 24, no dependencies: AWS Signature V4 with `node:crypto` (`infra/lib/sigv4.mjs`,
verified against the official AWS test-suite vectors in `infra/test/sigv4.test.mjs`) and
global `fetch` against `https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<BUCKET>/<key>`
(region `auto`, service `s3`, payload hash signed — never `UNSIGNED-PAYLOAD`).

Behaviour:

- Reads `<out>/manifest.json` (`path → sha1`) and compares it with the **previous** manifest.
  Per `docs/build-contracts.md` the manifest lists every *other* output file but not itself, so
  its own bytes are read separately — otherwise the final upload would have nothing to send.
  Default `--prev auto`: the copy in R2 (`v1/manifest.json`) wins because it is uploaded last
  and therefore only describes complete publishes; if R2 is unreachable the local
  `<cache>/last/manifest.json` is used; if that is missing too, everything is uploaded
  (uploads are idempotent, so this is always safe). `--dry-run` never touches the network.
- Uploads changed files with concurrency 6, three attempts each with exponential backoff
  (retries on network errors, 429 and 5xx; not on other 4xx), then `manifest.json` **last**,
  then writes `<cache>/last/manifest.json`. Any failed upload → exit 1 and the manifest is
  not updated, so the next run retries exactly those files.
- Headers per file: `Content-Type` `application/geo+json` for `.geojson`, `application/json`
  for `.json`; `Cache-Control` `public, max-age=60` for `meta.json`, `live.geojson` and
  `manifest.json`, `public, max-age=120` for `bruggen.json`, `public, max-age=300` for the
  rest (contract in `docs/build-contracts.md`). R2's S3 API stores both headers as system
  metadata and returns them on GET (developers.cloudflare.com/r2/api/s3/api/, checked
  2026-09-08). Cloudflare's edge compresses responses on the fly for both `application/json`
  and `application/geo+json` (they are in the compressible list at
  developers.cloudflare.com/speed/optimization/content/compression/, checked 2026-09-08), so
  files are stored uncompressed and the CDN serves gzip/brotli/zstd per browser.
- **Deferred entity files.** `roads/*.json` and `gemeenten/*.json` (692 files, the per-road
  and per-gemeente pages) are uploaded only on runs in which the planning feed changed. The
  uploader reads `<out>/meta.json` itself: `sources.planning.reused: true` means NDW answered
  304 and the pipeline replayed the previous parse, so every change in those files comes from
  the actueel feed — which the road/gemeente pages do not need at 5-minute freshness. On such a
  run a changed entity file is *deferred*: not uploaded, and the uploaded `manifest.json`
  keeps the hash of the version R2 still holds, so the manifest always describes what is
  really in R2 and the next run with a changed planning feed uploads exactly the files R2 is
  missing. A file R2 does not have at all is never deferred (a new gemeente/road page never
  points at a 404). Default on; `--no-entities-when-planning-changed` uploads them every run,
  `--skip-prefix a/,b/` defers other prefixes unconditionally, `--dry-run` shows
  `deferred=<n>`. A missing `meta.json` or a missing flag never defers.
- Files present in R2 but absent from the new manifest are reported ("orphaned") and left in
  place; the file set is stable, and deleting is never needed for correctness.
- Exit codes: `0` ok · `1` upload failure · `2` usage/config error (missing `--out`, missing
  env, malformed manifest, listed file missing).

Run locally:

```sh
# preview only, no credentials needed (uses pipeline/cache/last/manifest.json if present)
node infra/upload-r2.mjs --dry-run --out pipeline/out --cache pipeline/cache

# real upload (bash; on PowerShell use $env:R2_ACCOUNT_ID = "..." etc.)
R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=wegwerk-data \
  node infra/upload-r2.mjs --out pipeline/out --cache pipeline/cache

node --test "infra/test/**/*.test.mjs"   # 50 tests, ~3 s
# (Node 24 wants a glob here; a bare directory argument is not expanded.)
```

`infra/test/` holds four suites: `sigv4.test.mjs` (the official AWS test-suite vectors),
`plan.test.mjs` (manifest validation, headers per file class, the changed/unchanged/removed
diff, deferral with the merged manifest), `r2-client.test.mjs` (signed requests, error
mapping, retry/backoff against a fake `fetch`) and `upload-r2.test.mjs` (the whole `run()`
against a fake `fetch`: manifest.json uploaded last, unchanged files skipped, headers per
class, a failure leaving manifest.json untouched, a retried 503, bounded concurrency, the
fallback to the local manifest, every usage/config error, and the deferral: applied when
`meta.json` says `reused: true`, not when it says `false`/lacks the flag/is missing, the
deferred files keeping their R2 hash in the uploaded manifest, the next planning-changed run
uploading exactly those, `--no-entities-when-planning-changed`, `--skip-prefix` never
deferring a file R2 lacks, and `--dry-run` naming the deferred count). `run()` is exported for
those tests; the CLI only starts under `import.meta.main`.

### R2 Class A operations — measured (2026-09-13, contract v3, 743 files, 45 MB)

R2's free tier is 1,000,000 Class A operations (PUTs) per month, then $4.50 per million; the
pipeline runs 8,640 times a month. What changes between runs, measured on real feeds with the
`churn.mjs` comparison of two manifests (entity files compared on content, `generated` masked):

| Interval | Planning feed | Core files changed (of 51) | Entity files changed (of 692) |
|---|---|---|---|
| 14:51 → 14:55 (5 min) | unchanged (304) | ~46 | **68** (24 roads, 44 gemeenten) |
| 14:55 → 15:03 (8 min) | changed once | 51 | **143** |
| 15:03 → 15:15 (12 min) | changed once | 50 | **127** |

Core files = `meta.json`, the three collections, `bruggen.json`, 14 index files, 32 detail
shards, plus `manifest.json`: ~50 PUTs on every run → **≈ 430,000/month**, unavoidable with
the current file layout. Entity files: deferred to the ~2,880 planning-changed runs a month at
≈ 135 each → **≈ 390,000/month**. Expected total **≈ 820,000 Class A operations per month
(82 % of the free tier)** — check it on *R2 > Overview* after the first full month; Sunday
afternoon churn was measured, weekdays may be higher. If it runs too close: `--skip-prefix
roads/,gemeenten/` on more runs (e.g. only upload entities on the :01/:31 runs) or a slower
cron at night are the cheap levers.

Two things this estimate depends on, both in the code: (1) entity files must have
deterministic bytes — `generated` is the latest item update, not the run time
(`entityGenerated()` in `pipeline/src/output.js`); with the run time in every file 742 of 743
files changed every run, ≈ 6.4 million/month, and that is what a GitHub Actions run would have
done because `pipeline/out` is a fresh directory there; (2) the deferral above — without it
the entity files alone would cost ≈ 8,640 × 70 ≈ 605,000/month and the total would sit right
at the free-tier ceiling.

Older measurement (2026-09-09, contract v2, 52 files): 50 of 51 files changed per run,
≈ 440,000/month.

| Situation | Result |
|---|---|
| First publish (no previous manifest) | every file + `manifest.json`, `manifest.json` last |
| Previous manifest identical | **0 PUTs**, `upload ok uploaded=0 skipped=742 deferred=0` |
| Planning unchanged, everything else moved on (dry run against run A's manifest) | `to-upload=54 unchanged=0 deferred=689 removed=2` |
| Missing `R2_*` variables, no `--dry-run` | exit **2**, `Missing environment variable(s): …` |

Headers per class: `application/geo+json` + `max-age=60` (`live.geojson`),
`application/geo+json` + `max-age=300` (`werk-*`), `application/json` + `max-age=60`
(`meta.json`, `manifest.json`), `application/json` + `max-age=120` (`bruggen.json`),
`application/json` + `max-age=300` (`index/**`, `detail/**`, `roads/**`, `gemeenten/**`).

## Testing a workflow by hand

GitHub > **Actions** > pick the workflow in the left sidebar > **Run workflow** > branch
`main` (for Data: tick *force* to ignore the ETag cache) > **Run workflow**. The run's
*Summary* page shows the pipeline and upload summary lines. To try the Deploy workflow
without pushing code, run it manually the same way.

## Cloudflare-side settings the workflows assume

- R2 bucket with a **custom domain** `data.<domein>` (the `r2.dev` URL is rate-limited),
  a **CORS policy** allowing `GET` from the site origin (the site and the data live on
  different hostnames), and a **Cache Rule** for that hostname: *Eligible for cache*,
  Edge TTL *Use cache-control header if present, bypass cache if not*, Browser TTL
  *Respect origin*. Cloudflare does not cache JSON by default. Also set the zone-wide
  **Browser Cache TTL** (Caching → Configuration) to *Respect Existing Headers*; its default
  of 4 hours overrides the per-file `Cache-Control` and makes browsers hold stale data.
- A Pages project (created automatically by the Deploy workflow if missing) with custom
  domain(s) `www.<domein>` and the apex.

Details with click paths: `docs/handleiding.md`.
