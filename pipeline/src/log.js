/**
 * Minimal structured console logger.
 *
 * Levels: error < warn < info < debug. The pipeline is quiet by default
 * (warn) and switches to debug with `--verbose`. Every line is prefixed with
 * an ISO timestamp and the level so GitHub Actions logs stay readable.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * @param {{ level?: keyof typeof LEVELS, stream?: { write(s: string): unknown } }} [options]
 */
export function createLogger(options = {}) {
  const threshold = LEVELS[options.level ?? 'warn'];
  const stream = options.stream ?? process.stderr;

  /** @param {keyof typeof LEVELS} level @param {string} message @param {Record<string, unknown>} [fields] */
  function write(level, message, fields) {
    if (LEVELS[level] > threshold) return;
    const extra = fields && Object.keys(fields).length > 0 ? ' ' + formatFields(fields) : '';
    stream.write(`${new Date().toISOString()} ${level.padEnd(5)} ${message}${extra}\n`);
  }

  return {
    error: (msg, fields) => write('error', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    debug: (msg, fields) => write('debug', msg, fields),
    /** @param {keyof typeof LEVELS} level */
    enabled: (level) => LEVELS[level] <= threshold,
  };
}

/** @param {Record<string, unknown>} fields */
function formatFields(fields) {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value)}`)
    .join(' ');
}

/** A logger that discards everything (tests, library use). */
export const silentLogger = createLogger({ level: 'error', stream: { write: () => true } });
