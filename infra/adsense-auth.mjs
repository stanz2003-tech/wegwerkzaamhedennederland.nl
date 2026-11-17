#!/usr/bin/env node
/**
 * One-time sign-in that gives the daily report read access to AdSense. Run it on your own
 * computer, not in the cloud:
 *
 *   node infra/adsense-auth.mjs <path to the downloaded client_secret_….json>
 *
 * The JSON is the OAuth client of type "Desktop app" from Google Cloud (project wegwerk-rapport,
 * APIs & Services → Credentials). The script opens Google's sign-in page, catches the answer on
 * 127.0.0.1, checks that the AdSense API answers, and prints ONE line:
 *
 *   ADSENSE_OAUTH={"client_id":"…","client_secret":"…","refresh_token":"…"}
 *
 * Paste that line as an environment variable in the routine's cloud environment. Treat it as a
 * password: it gives read access to the AdSense reports until it is revoked.
 *
 * Set the OAuth consent screen to "In production" first: in "Testing" Google lets the refresh
 * token expire after 7 days. The report reads AdSense days in the account's time zone; the
 * script warns when that is not Europe/Amsterdam.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADSENSE_ACCOUNT, ADSENSE_SCOPE, GOOGLE_TOKEN, refreshAccessToken } from './lib/adsense.mjs';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const WAIT_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 30_000;

/** Reads client_id/client_secret from a downloaded "Desktop app" client file. */
export function parseClientFile(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The client file is not valid JSON (use the file downloaded from Google Cloud)');
  }
  const client = json.installed ?? json.web ?? json;
  if (!client.client_id || !client.client_secret) throw new Error('No client_id/client_secret in this file');
  return { client_id: client.client_id, client_secret: client.client_secret };
}

export function authUrl({ clientId, redirectUri, state, codeChallenge }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ADSENSE_SCOPE,
    access_type: 'offline',
    prompt: 'consent', // without it Google gives no refresh token on a second run
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params}`;
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

/** Waits for Google's redirect to 127.0.0.1 and returns the code. */
function waitForCode(server, state) {
  return new Promise((resolveCode, reject) => {
    const timer = setTimeout(() => reject(new Error('No answer from Google within 5 minutes')), WAIT_MS);
    server.on('request', (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      // Ignore stray requests (favicon, a reload without parameters) instead of failing the sign-in.
      if (url.pathname !== '/' || !url.searchParams.has('state')) return res.writeHead(404, { Connection: 'close' }).end();
      const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end(ok ? 'Klaar. Je kunt dit tabblad sluiten en teruggaan naar de terminal.' : 'Aanmelden mislukt. Kijk in de terminal.');
      clearTimeout(timer);
      if (ok) resolveCode(url.searchParams.get('code'));
      else reject(new Error(`Google answered: ${url.searchParams.get('error') ?? 'state mismatch'}`));
    });
  });
}

async function exchangeCode({ client, code, redirectUri, verifier }) {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...client, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Token exchange failed: HTTP ${res.status} ${body.error ?? ''}`);
  if (!body.refresh_token) throw new Error('Google gave no refresh token; remove the app at myaccount.google.com/permissions and run again');
  return body.refresh_token;
}

async function checkAdsense(oauth) {
  const token = await refreshAccessToken(oauth);
  const res = await fetch(`https://adsense.googleapis.com/v2/${ADSENSE_ACCOUNT}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AdSense API check failed: HTTP ${res.status} ${body?.error?.message ?? ''}`);
  const timeZone = body.timeZone?.id ?? 'unknown';
  if (timeZone !== 'Europe/Amsterdam') console.error(`Warning: AdSense reports in ${timeZone}, so its days are not Amsterdam days.`);
  return `${body.displayName ?? body.name} (${timeZone})`;
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node infra/adsense-auth.mjs <client_secret_….json>');
  const client = parseClientFile(readFileSync(file, 'utf8'));
  const server = createServer();
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('hex');
  const url = authUrl({ clientId: client.client_id, redirectUri, state, codeChallenge: createHash('sha256').update(verifier).digest('base64url') });
  console.error(`Opening Google sign-in. If no browser opens, visit:\n${url}\n`);
  openBrowser(url);
  try {
    const code = await waitForCode(server, state);
    const oauth = { ...client, refresh_token: await exchangeCode({ client, code, redirectUri, verifier }) };
    console.error(`AdSense answers for: ${await checkAdsense(oauth)}\n\nPaste this line in the cloud environment:\n`);
    console.log(`ADSENSE_OAUTH=${JSON.stringify(oauth)}`);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
