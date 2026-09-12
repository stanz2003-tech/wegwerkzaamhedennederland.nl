#!/usr/bin/env node
/**
 * Wegwerk pipeline CLI (contract: docs/build-contracts.md "Pipeline CLI").
 *
 *   node pipeline/bin/run.js --out <dir> [--sources planning,actueel,bruggen]
 *     [--from-file name=path]... [--now <iso>] [--no-geocode] [--geocode-max <n>]
 *     [--cache <dir>] [--force] [--verbose]
 *
 * Exit 0 = ok, 1 = all sources failed / output not writable, 2 = validation floor.
 * Prints exactly one summary line to stdout.
 */

import { parseArgs } from 'node:util';
import { runPipeline } from '../src/pipeline.js';

const USAGE = `Usage: node bin/run.js --out <dir> [options]

Options:
  --out <dir>             output directory (required)
  --sources <a,b>         planning,actueel,bruggen (default: all)
  --from-file name=path   read a source from a local .xml/.xml.gz (repeatable)
  --now <iso>             pretend it is this moment (tests, reproducible runs)
  --no-geocode            cache-only geocoding
  --geocode-max <n>       new PDOK lookups per run (default 400)
  --cache <dir>           cache directory (default pipeline/cache)
  --force                 ignore ETags, always download and parse
  --verbose               debug logging on stderr
  --help`;

/**
 * @param {string[]} argv
 */
export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    allowNegative: true,
    options: {
      out: { type: 'string' },
      sources: { type: 'string' },
      'from-file': { type: 'string', multiple: true },
      now: { type: 'string' },
      geocode: { type: 'boolean', default: true },
      'geocode-max': { type: 'string' },
      cache: { type: 'string' },
      force: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) return { help: true };
  if (!values.out) throw new Error('--out <dir> is required');

  /** @type {Record<string, string>} */
  const fromFile = {};
  for (const spec of values['from-file'] ?? []) {
    const idx = spec.indexOf('=');
    if (idx <= 0) throw new Error(`--from-file expects name=path, got "${spec}"`);
    fromFile[spec.slice(0, idx)] = spec.slice(idx + 1);
  }
  let geocodeMax;
  if (values['geocode-max'] !== undefined) {
    geocodeMax = Number(values['geocode-max']);
    if (!Number.isInteger(geocodeMax) || geocodeMax < 0) throw new Error(`--geocode-max expects a non-negative integer, got "${values['geocode-max']}"`);
  }
  return {
    help: false,
    options: {
      outDir: values.out,
      sources: values.sources,
      fromFile: Object.keys(fromFile).length > 0 ? fromFile : undefined,
      now: values.now,
      geocode: values.geocode,
      geocodeMax,
      cacheDir: values.cache,
      force: values.force,
      verbose: values.verbose,
    },
  };
}

async function main() {
  let cli;
  try {
    cli = parseCli(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}\n`);
    return 1;
  }
  if (cli.help) {
    process.stdout.write(USAGE + '\n');
    return 0;
  }
  const result = await runPipeline(cli.options);
  process.stdout.write(result.summary + '\n');
  return result.exitCode;
}

// Only run when invoked as a program; tests import `parseCli` from this file.
if (import.meta.main) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stdout.write(`error ${err instanceof Error ? err.message : String(err)}\n`);
      if (process.argv.includes('--verbose') && err instanceof Error) process.stderr.write(`${err.stack}\n`);
      process.exitCode = 1;
    },
  );
}
