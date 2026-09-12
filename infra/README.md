# infra/ — workflows and the R2 uploader

Everything that runs *around* the code: GitHub Actions workflows (`.github/workflows/`),
the dependency-free uploader to Cloudflare R2, and this note. Owner-facing instructions in
Dutch live in the root `README.md` and `docs/handleiding.md`.

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `Data` (`data.yml`) | cron `1-59/5 * * * *` (every 5 min, offset from the top of the hour), or **Run workflow** with the `force` checkbox | `npm ci` (pipeline workspace only) → `node pipeline/bin/run.js --out pipeline/out --cache pipeline/cache --geocode-max 400` → on exit 0 `node infra/upload-r2.mjs` uploads only changed files to R2 → ping `HEALTHCHECK_URL` → commit `pipeline/cache/{geocode,bruggen-seen,etags}.json` back when changed (`[skip ci]`) → daily keepalive (see below) → step summary. Exit 2 (validation floor) or 1 fails the job **without uploading**; the last good data stays online. `pipeline/cache/last/` (parsed planning feed) is kept between runs with `actions/cache`, keyed on the NDW ETag. |
| `Deploy` (`deploy.yml`) | push to `main` touching `web/**`, `pipeline/static/**`, `package*.json`; or manual | Checks settings, `npm ci`, `npm run build -w @wegwerk/web` with `VITE_DATA_BASE=${{ vars.DATA_BASE }}`, creates the Pages project through the Cloudflare API if it does not exist yet, then `cloudflare/wrangler-action@v4` → `wrangler pages deploy web/dist --project-name=<CF_PAGES_PROJECT> --branch=main`. |
| `CI` (`ci.yml`) | every push and pull request (docs and cache commits ignored) | `npm test -w @wegwerk/pipeline`, `node --test "infra/test/**/*.test.mjs"`, `npm run typecheck -w @wegwerk/web`, fixture-data build, `web/dist` artifact (3 days). |

Concurrency groups prevent overlapping data runs (`cancel-in-progress: false`) and stale
deploys (`cancel-in-progress: true`).

### `defaults.run.shell: bash` in data.yml is load-bearing

GitHub's implicit shell is `bash -e {0}`; naming `bash` explicitly gets
`bash --noprofile --norc -eo pipefail {0}` (docs.github.com, workflow syntax). Two steps pipe
into `tee` so their output can go into the job summary, and without `pipefail` the step's exit
code is `tee`'s — always 0. A failing `upload-r2.mjs` would then have produced a green run
*and* a healthchecks.io ping while nothing was published. Verified locally: the same script
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

### Keepalive

GitHub disables scheduled workflows in public repositories after 60 days without repository
activity. Two mechanisms keep this one alive: the cache commits (whenever the NDW ETag or the
geocode cache changes, i.e. many times a day) and a daily `PUT /repos/{owner}/{repo}/actions/workflows/data.yml/enable`
call with the job's `GITHUB_TOKEN` (`permissions: actions: write`). The marketplace action
`gautamkrishnar/keepalive-workflow` was **not** used: on 2026-09-08 its repository returned
"Repository access blocked" (reason `tos`) from the GitHub API, and on 2026-09-09
`GET /repos/gautamkrishnar/keepalive-workflow` still answered HTTP 403 while the same
unauthenticated calls to `actions/*` succeeded — so a workflow referencing it would fail to
start. The API call is exactly what that action did in `use_api` mode.

The cache commits alone are not a guaranteed keepalive: pushes made with `GITHUB_TOKEN` do not
create workflow runs (docs.github.com, "Triggering a workflow": "events triggered by the
`GITHUB_TOKEN` will not create a new workflow run"), but they *are* repository activity, which
is what the 60-day rule looks at. The daily `enable` call is the belt to that braces.

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

node --test "infra/test/**/*.test.mjs"   # 41 tests, ~3 s
# (Node 24 wants a glob here; a bare directory argument is not expanded.)
```

`infra/test/` holds four suites: `sigv4.test.mjs` (the official AWS test-suite vectors),
`plan.test.mjs` (manifest validation, headers per file class, the changed/unchanged/removed
diff), `r2-client.test.mjs` (signed requests, error mapping, retry/backoff against a fake
`fetch`) and `upload-r2.test.mjs` (the whole `run()` against a fake `fetch`: manifest.json
uploaded last, unchanged files skipped, headers per class, a failure leaving manifest.json
untouched, a retried 503, bounded concurrency, the fallback to the local manifest, and every
usage/config error). `run()` is exported for those tests; the CLI only starts under
`import.meta.main`.

### Measured on the real pipeline output (2026-09-09, `pipeline/tmp/out`, 52 files, 19.50 MB)

| Situation | Result |
|---|---|
| First publish (no previous manifest) | 51 files + `manifest.json` = **52 PUTs**, 20.445.542 bytes, `manifest.json` last |
| Previous manifest identical | **0 PUTs**, `upload ok uploaded=0 skipped=51` |
| Two files changed | **3 PUTs** (`live.geojson`, `meta.json`, `manifest.json`), 49 skipped |
| Two consecutive live snapshots of the real feeds | **50 of 51 files differ** (only `werk-gepland.geojson` is stable) → ≈ 440.000 R2 Class A operations per month, 44 % of the free 1 M |
| Missing `R2_*` variables, no `--dry-run` | exit **2**, `Missing environment variable(s): …` |

Headers actually sent, counted per class: `application/geo+json` + `max-age=60` ×1
(`live.geojson`), `application/geo+json` + `max-age=300` ×2 (`werk-*`), `application/json` +
`max-age=60` ×2 (`meta.json`, `manifest.json`), `application/json` + `max-age=120` ×1
(`bruggen.json`), `application/json` + `max-age=300` ×46 (`index/**`, `detail/**`).

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
  *Respect origin*. Cloudflare does not cache JSON by default.
- A Pages project (created automatically by the Deploy workflow if missing) with custom
  domain(s) `www.<domein>` and the apex.

Details with click paths: `docs/handleiding.md`.
