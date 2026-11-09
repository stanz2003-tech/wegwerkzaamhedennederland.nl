#!/usr/bin/env node
/**
 * The watchdog's decision against the live site and GitHub, without doing anything: it never
 * dispatches and never pings. Same code as the Worker (tick.mjs with dryRun).
 *
 *   node infra/watchdog/dry-run.mjs                 what the watchdog would decide now
 *   node infra/watchdog/dry-run.mjs --now +90m      ...if nothing at all happened for 90 minutes
 *   node infra/watchdog/dry-run.mjs --now 2026-11-09T18:45:00Z
 *
 * No token needed (the repository is public; unauthenticated GitHub reads are capped at 60 an hour
 * per IP). Set GITHUB_TOKEN to use a token instead. Exit code 0 always; the verdict is on stdout.
 */
import { pathToFileURL } from 'node:url';
import { tick } from './tick.mjs';

/** `+90m` → now + 90 minutes; an ISO time → that moment; nothing → now. */
export function parseNow(arg, realNow = Date.now()) {
  if (!arg) return realNow;
  const shift = /^\+(\d+)m$/.exec(arg);
  if (shift) return realNow + Number(shift[1]) * 60_000;
  const at = Date.parse(arg);
  if (Number.isNaN(at)) throw new Error(`--now: expected +<minutes>m or an ISO time, got "${arg}"`);
  return at;
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--now');
  const now = parseNow(i >= 0 ? args[i + 1] : undefined);
  const record = await tick(process.env, { now, dryRun: true });
  console.log(JSON.stringify(record, null, 2));
  console.log(`\n${record.action.toUpperCase()}: ${record.reason}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  });
}
