#!/usr/bin/env node
/**
 * Uploads the pipeline output to Cloudflare R2 — only files whose sha1 changed since
 * the previous publish, with the right Content-Type and Cache-Control, manifest.json last.
 *
 *   node infra/upload-r2.mjs --out pipeline/out [--cache pipeline/cache] [--dry-run]
 *                            [--prefix v1] [--concurrency 6] [--prev auto|r2|local|none]
 *                            [--skip-prefix roads/,gemeenten/] [--no-entities-when-planning-changed]
 *
 * Environment (GitHub secrets in CI, see .env.example):
 *   R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BUCKET  [R2_PREFIX=v1]  [R2_JURISDICTION=eu]
 *
 * Previous manifest (`--prev auto`, the default): the copy in R2 (`<prefix>/manifest.json`)
 * is the source of truth because it is written last, so it only ever describes a
 * complete publish. When R2 cannot be reached the local `<cache>/last/manifest.json` is
 * used, and when that is missing too everything is uploaded (safe: uploads are idempotent).
 * `--dry-run` never touches the network and only uses the local copy.
 *
 * Deferred files: the entity files `roads/*.json` and `gemeenten/*.json` are only uploaded on
 * runs in which the planning feed changed — `<out>/meta.json` says `sources.planning.reused:
 * true` when NDW answered 304 and the previous parse was replayed, and on such a run every
 * change in those files comes from the actueel feed, which the road/gemeente pages do not need
 * at 5-minute freshness. That is the default (`--entities-when-planning-changed`, switch off
 * with `--no-entities-when-planning-changed`); `--skip-prefix a/,b/` defers other prefixes
 * unconditionally. A deferred file keeps its previous hash in the uploaded manifest.json, so
 * the manifest always describes what is really in R2 and the next non-deferring run uploads
 * exactly the files R2 is missing. A file R2 does not have at all is never deferred.
 *
 * Exit codes: 0 ok · 1 one or more uploads failed (manifest.json NOT updated) · 2 usage/config error.
 *
 * `run()` is exported for the tests in infra/test/upload-r2.test.mjs; the CLI below only
 * runs when this file is executed directly.
 */
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { R2Client, withRetry } from './lib/r2-client.mjs';
import {
  ENTITY_PREFIXES,
  MANIFEST_FILE,
  cacheControlFor,
  contentTypeFor,
  formatBytes,
  parsePrefixes,
  planUploads,
  validateManifest,
} from './lib/plan.mjs';

const ENV_REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
const DEFAULT_CONCURRENCY = 6;
const ATTEMPTS = 3;
const EXIT_UPLOAD_FAILED = 1;
const EXIT_USAGE = 2;
const META_FILE = 'meta.json';

const HELP = `Usage: node infra/upload-r2.mjs --out <dir> [options]

Options:
  --out <dir>          pipeline output directory containing manifest.json (required)
  --cache <dir>        cache directory; <cache>/last/manifest.json is read/written (default pipeline/cache)
  --prefix <p>         key prefix in the bucket (default $R2_PREFIX or "v1")
  --prev <mode>        previous manifest: auto (R2, then local), r2, local, none (default auto)
  --concurrency <n>    parallel uploads (default ${DEFAULT_CONCURRENCY})
  --skip-prefix <a,b>  defer changed files under these prefixes (R2 keeps its current version)
  --no-entities-when-planning-changed
                       upload ${ENTITY_PREFIXES.join(' and ')} every run, even when <out>/meta.json
                       says the planning feed was unchanged (default: defer them on such runs)
  --dry-run            print the plan, upload nothing, touch no network
  -h, --help           this text

Environment: ${ENV_REQUIRED.join(', ')} (optional: R2_PREFIX, R2_JURISDICTION).`;

/** Default sinks: the plan and progress go to stderr, the one summary line to stdout. */
const CONSOLE_LOG = { out: (m) => console.log(m), err: (m) => console.error(m) };

if (import.meta.main) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`upload-r2: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(err?.exitCode ?? EXIT_UPLOAD_FAILED);
    },
  );
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ log?: { out: (m: string) => void, err: (m: string) => void }, fetchImpl?: typeof fetch }} [deps]
 * @returns {Promise<0 | 1 | 2>} process exit code
 */
export async function run(argv, env = process.env, deps = {}) {
  const log = deps.log ?? CONSOLE_LOG;
  const options = parseCli(argv);
  if (options.help) {
    log.out(HELP);
    return 0;
  }
  const config = readConfig(options, env, log);
  const started = Date.now();

  const next = await loadLocalManifest(config.outDir);
  const files = await readFiles(config.outDir, next, log);
  const client = new R2Client({ ...config.r2, fetchImpl: deps.fetchImpl });
  const ctx = { config, client, log };
  const previous = await loadPreviousManifest(ctx);
  const skipPrefixes = await resolveSkipPrefixes(config, log);
  const plan = planUploads(next, previous.manifest, skipPrefixes);
  const tail = `deferred=${plan.deferred.length} removed=${plan.removed.length}`;

  printPlan({ ...ctx, previous, plan, files });
  if (config.dryRun) {
    log.out(`upload dry-run to-upload=${plan.changed.length} unchanged=${plan.unchanged.length} ${tail} prev=${previous.source}`);
    return 0;
  }
  if (plan.changed.length === 0 && !plan.manifestChanged) {
    log.out(`upload ok uploaded=0 skipped=${plan.unchanged.length} ${tail} bytes=0 prev=${previous.source} ms=${Date.now() - started}`);
    return 0;
  }

  const results = await uploadAll({ ...ctx, plan, files });
  const failed = results.filter((r) => !r.ok);
  const bytes = results.filter((r) => r.ok).reduce((sum, r) => sum + r.bytes, 0);
  if (failed.length > 0) {
    for (const f of failed) log.err(`  FAILED ${f.key}: ${f.error}`);
    log.out(`upload failed uploaded=${results.length - failed.length} failed=${failed.length} skipped=${plan.unchanged.length} ${tail} bytes=${bytes} prev=${previous.source} ms=${Date.now() - started}`);
    return EXIT_UPLOAD_FAILED;
  }

  // The published manifest describes R2, not the local directory: a deferred file keeps the
  // hash of the version R2 still holds (see planUploads).
  const manifestBody = Buffer.from(JSON.stringify(plan.manifest));
  await uploadOne({ ...ctx, key: MANIFEST_FILE, body: manifestBody });
  await writeCachedManifest(config.cacheDir, manifestBody);
  log.out(`upload ok uploaded=${results.length + 1} skipped=${plan.unchanged.length} ${tail} bytes=${bytes} prev=${previous.source} ms=${Date.now() - started}`);
  return 0;
}

/** @param {string[]} argv */
function parseCli(argv) {
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        out: { type: 'string' },
        cache: { type: 'string', default: 'pipeline/cache' },
        prefix: { type: 'string' },
        prev: { type: 'string', default: 'auto' },
        concurrency: { type: 'string' },
        'skip-prefix': { type: 'string' },
        'entities-when-planning-changed': { type: 'boolean', default: true },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
      allowNegative: true,
    });
    return values;
  } catch (err) {
    throw usageError(`${err.message}\n\n${HELP}`);
  }
}

/**
 * @param {ReturnType<typeof parseCli>} options
 * @param {NodeJS.ProcessEnv} env
 * @param {{ err: (m: string) => void }} log
 */
function readConfig(options, env, log) {
  if (!options.out) throw usageError(`--out <dir> is required.\n\n${HELP}`);
  const prevModes = ['auto', 'r2', 'local', 'none'];
  if (!prevModes.includes(options.prev)) throw usageError(`--prev must be one of ${prevModes.join(', ')}`);
  const concurrency = Number(options.concurrency ?? DEFAULT_CONCURRENCY);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw usageError('--concurrency must be an integer between 1 and 32');
  }
  // Secrets pasted into GitHub often carry a trailing newline; an empty secret arrives as "".
  // Both would otherwise produce an invalid Authorization header or an empty key prefix.
  const envValue = (name) => (env[name] ?? '').trim();
  const missing = ENV_REQUIRED.filter((name) => !envValue(name));
  if (missing.length > 0 && !options['dry-run']) {
    throw usageError(
      `Missing environment variable(s): ${missing.join(', ')}.\n` +
        'Set them as GitHub Actions secrets (see infra/README.md) or export them locally; ' +
        'use --dry-run to preview the plan without credentials.',
    );
  }
  if (missing.length > 0) log.err(`note: ${missing.join(', ')} not set — dry run uses placeholders`);
  const prefix = (options.prefix || envValue('R2_PREFIX') || 'v1').replace(/^\/+|\/+$/g, '');
  return {
    outDir: resolve(options.out),
    cacheDir: resolve(options.cache),
    prefix,
    prev: options.prev,
    concurrency,
    skipPrefixes: parsePrefixes(options['skip-prefix']),
    entitiesWhenPlanningChanged: options['entities-when-planning-changed'],
    dryRun: options['dry-run'],
    r2: {
      accountId: envValue('R2_ACCOUNT_ID') || 'ACCOUNT_ID',
      bucket: envValue('R2_BUCKET') || 'BUCKET',
      accessKeyId: envValue('R2_ACCESS_KEY_ID') || 'ACCESS_KEY_ID',
      secretAccessKey: envValue('R2_SECRET_ACCESS_KEY') || 'SECRET',
      jurisdiction: envValue('R2_JURISDICTION') || undefined,
    },
  };
}

/**
 * The prefixes deferred this run: the explicit `--skip-prefix` list, plus the entity files
 * when `<out>/meta.json` reports that the planning feed was unchanged (NDW 304, cached parse
 * replayed). A missing or unreadable meta.json, or `reused` anything but `true`, never defers.
 * @param {ReturnType<typeof readConfig>} config
 * @param {{ err: (m: string) => void }} log
 * @returns {Promise<string[]>}
 */
async function resolveSkipPrefixes(config, log) {
  const prefixes = [...config.skipPrefixes];
  if (config.entitiesWhenPlanningChanged) {
    const reused = await readPlanningReused(config.outDir, log);
    if (reused === true) {
      log.err(`planning feed unchanged this run (${META_FILE}: sources.planning.reused=true) — ${ENTITY_PREFIXES.join(', ')} deferred to the next planning change`);
      prefixes.push(...ENTITY_PREFIXES);
    } else if (reused === undefined) {
      log.err(`note: ${META_FILE} has no sources.planning.reused flag — entity files are uploaded when changed`);
    }
  }
  return [...new Set(prefixes)];
}

/**
 * `sources.planning.reused` from `<out>/meta.json`; `undefined` when the file is missing,
 * unreadable or does not carry the flag.
 * @param {string} outDir
 * @param {{ err: (m: string) => void }} log
 * @returns {Promise<boolean | undefined>}
 */
async function readPlanningReused(outDir, log) {
  const file = join(outDir, META_FILE);
  try {
    const meta = JSON.parse(await readFile(file, 'utf8'));
    const reused = meta?.sources?.planning?.reused;
    return typeof reused === 'boolean' ? reused : undefined;
  } catch (err) {
    if (err?.code !== 'ENOENT') log.err(`warning: ignoring unreadable ${file}: ${message(err)}`);
    return undefined;
  }
}

/** @param {string} outDir */
async function loadLocalManifest(outDir) {
  const file = join(outDir, MANIFEST_FILE);
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw usageError(`${file} not found — did the pipeline finish successfully?`);
  }
  try {
    return validateManifest(JSON.parse(raw), file);
  } catch (err) {
    throw usageError(err.message);
  }
}

/**
 * Reads every file listed in the manifest. Per docs/build-contracts.md the manifest lists
 * "all files above", not itself; the manifest that is uploaded last is serialised from the
 * plan (see `run()`), never read from disk. Warns (does not fail) when a file's sha1 differs
 * from the manifest value, which would point at a pipeline bug.
 * @param {string} outDir
 * @param {Record<string, string>} manifest
 * @param {{ err: (m: string) => void }} log
 * @returns {Promise<Map<string, Buffer>>}
 */
async function readFiles(outDir, manifest, log) {
  const files = new Map();
  const missing = [];
  for (const [path, sha] of Object.entries(manifest)) {
    if (path === MANIFEST_FILE) continue;
    const full = join(outDir, path);
    const exists = await stat(full).then((s) => s.isFile(), () => false);
    if (!exists) {
      missing.push(path);
      continue;
    }
    const body = await readFile(full);
    if (sha1(body) !== sha) log.err(`warning: ${path} content sha1 differs from manifest.json entry`);
    files.set(path, body);
  }
  if (missing.length > 0) {
    throw usageError(`manifest lists ${missing.length} file(s) that do not exist under ${outDir}: ${missing.slice(0, 5).join(', ')}`);
  }
  return files;
}

/**
 * @param {{ config: ReturnType<typeof readConfig>, client: R2Client, log: { err: (m: string) => void } }} ctx
 * @returns {Promise<{ manifest: Record<string, string>, source: 'r2' | 'local' | 'none', detail: string }>}
 */
async function loadPreviousManifest({ config, client, log }) {
  const localFile = join(config.cacheDir, 'last', MANIFEST_FILE);
  const local = () => readLocalPrevious(localFile, log);
  const none = (detail) => ({ manifest: {}, source: 'none', detail });

  if (config.prev === 'none') return none('--prev none');
  if (config.prev === 'local' || config.dryRun) return (await local()) ?? none(`${localFile} missing`);

  try {
    const { status, body } = await withRetry(() => client.getObject(`${config.prefix}/${MANIFEST_FILE}`), {
      attempts: ATTEMPTS,
      onRetry: (err, attempt) => log.err(`retry ${attempt}/${ATTEMPTS} reading previous manifest: ${message(err)}`),
    });
    if (status === 404) return none('no manifest.json in R2 yet (first publish)');
    return { manifest: validateManifest(JSON.parse(body.toString('utf8')), 'R2 manifest.json'), source: 'r2', detail: `${config.prefix}/${MANIFEST_FILE}` };
  } catch (err) {
    if (config.prev === 'r2') throw err;
    log.err(`warning: could not read previous manifest from R2 (${message(err)}); falling back`);
    return (await local()) ?? none('R2 unreachable and no local copy — uploading everything');
  }
}

/** @param {string} file @param {{ err: (m: string) => void }} log */
async function readLocalPrevious(file, log) {
  try {
    const manifest = validateManifest(JSON.parse(await readFile(file, 'utf8')), file);
    return { manifest, source: 'local', detail: file };
  } catch (err) {
    if (err?.code !== 'ENOENT') log.err(`warning: ignoring unreadable ${file}: ${message(err)}`);
    return null;
  }
}

/**
 * @param {{ config: ReturnType<typeof readConfig>, client: R2Client, log: { err: (m: string) => void },
 *           previous: { source: string, detail: string }, plan: ReturnType<typeof planUploads>,
 *           files: Map<string, Buffer> }} ctx
 */
function printPlan({ config, client, log, previous, plan, files }) {
  const title = config.dryRun ? 'Plan (dry run)' : 'Plan';
  log.err(`${title} — ${client.describe()}/${config.prefix}/ · previous manifest: ${previous.source} (${previous.detail})`);
  let total = 0;
  for (const path of plan.changed) {
    const size = files.get(path).byteLength;
    total += size;
    log.err(`  PUT  ${pad(config.prefix + '/' + path)} ${pad(contentTypeFor(path), 22)} ${pad(cacheControlFor(path), 22)} ${formatBytes(size)}`);
  }
  if (plan.changed.length > 0 || plan.manifestChanged) {
    log.err(`  PUT  ${pad(config.prefix + '/' + MANIFEST_FILE)} (uploaded last)`);
  }
  for (const path of plan.unchanged) log.err(`  skip ${config.prefix}/${path} (unchanged)`);
  for (const path of plan.deferred) log.err(`  defer ${config.prefix}/${path} (changed; R2 keeps its current version for now)`);
  for (const path of plan.removed) log.err(`  note ${config.prefix}/${path} exists in R2 but not in this run (left in place)`);
  log.err(`Summary: ${plan.changed.length} to upload (${formatBytes(total)}), ${plan.unchanged.length} unchanged, ${plan.deferred.length} deferred, ${plan.removed.length} orphaned`);
}

/**
 * Uploads all changed files (not the manifest) with bounded concurrency; never throws.
 * @param {{ client: R2Client, config: ReturnType<typeof readConfig>, log: { err: (m: string) => void },
 *           plan: ReturnType<typeof planUploads>, files: Map<string, Buffer> }} ctx
 * @returns {Promise<Array<{ key: string, ok: boolean, bytes: number, error?: string }>>}
 */
async function uploadAll({ client, config, log, plan, files }) {
  const queue = [...plan.changed];
  const results = [];
  const worker = async () => {
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
      const body = files.get(key);
      try {
        await uploadOne({ client, config, log, key, body });
        results.push({ key, ok: true, bytes: body.byteLength });
      } catch (err) {
        results.push({ key, ok: false, bytes: 0, error: message(err) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(config.concurrency, queue.length) }, worker));
  return results;
}

/**
 * @param {{ client: R2Client, config: ReturnType<typeof readConfig>, log: { err: (m: string) => void },
 *           key: string, body: Buffer }} ctx
 */
async function uploadOne({ client, config, log, key, body }) {
  const objectKey = `${config.prefix}/${key}`;
  await withRetry(
    () => client.putObject(objectKey, body, { contentType: contentTypeFor(key), cacheControl: cacheControlFor(key) }),
    { attempts: ATTEMPTS, onRetry: (err, attempt) => log.err(`retry ${attempt}/${ATTEMPTS} ${objectKey}: ${message(err)}`) },
  );
  log.err(`  ok   ${objectKey} (${formatBytes(body.byteLength)})`);
}

/** @param {string} cacheDir @param {Buffer} manifestBody */
async function writeCachedManifest(cacheDir, manifestBody) {
  const file = join(cacheDir, 'last', MANIFEST_FILE);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, manifestBody);
}

/** @param {Buffer} body */
function sha1(body) {
  return createHash('sha1').update(body).digest('hex');
}

/** @param {string} msg */
function usageError(msg) {
  const err = new Error(msg);
  err.exitCode = EXIT_USAGE;
  return err;
}

/** @param {unknown} err */
function message(err) {
  return err instanceof Error ? err.message : String(err);
}

/** @param {string} s @param {number} [width] */
function pad(s, width = 36) {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}
