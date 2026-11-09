/**
 * Cloudflare Worker entry point of the Wegwerk watchdog. A Cron Trigger (wrangler.toml) calls
 * `scheduled` every five minutes; one tick (tick.mjs) decides whether the Data chain on GitHub has
 * stopped and restarts it if so. Each tick writes one JSON line to Workers Logs.
 *
 * There is deliberately no `fetch` handler and no public URL (workers_dev = false): every request to
 * a public URL would spend GitHub API calls on the owner's token, and nothing needs one.
 */
import { logRecord, tick } from './tick.mjs';

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      tick(env).then(logRecord, (err) => {
        // tick() catches its own errors; this only fires on a bug, and must still leave a trace.
        console.error(JSON.stringify({ watchdog: 'wegwerk-watchdog', action: 'crash', error: err instanceof Error ? err.message : String(err) }));
      }),
    );
  },
};
