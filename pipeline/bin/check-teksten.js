#!/usr/bin/env node
/**
 * Report of the consistency check (src/consistency.js): where what the site says and what the
 * publisher wrote disagree, as published right now, in Dutch for the site owner.
 *
 *   node pipeline/bin/check-teksten.js [--data <url-or-dir>] [--alles]
 *
 * --data   the published data (default https://data.wegwerkzaamhedennederland.nl/v1/) or a local
 *          pipeline output directory
 * --alles  list every melding instead of the first ten per kind
 *
 * Reads meta.json (counts of every check, also the ones the site does not show), index/all.json
 * (titles) and the 32 detail shards (the checks the site shows, with the publisher's words).
 */

import { parseArgs } from 'node:util';
import { DEFAULT_DATA, formatReport, loadData } from '../src/teksten-report.js';

const { values } = parseArgs({ options: { data: { type: 'string' }, alles: { type: 'boolean', default: false } } });
try {
  const data = await loadData(values.data ?? DEFAULT_DATA);
  process.stdout.write(`${formatReport(data, { all: values.alles })}\n`);
} catch (err) {
  process.stderr.write(`check-teksten: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
