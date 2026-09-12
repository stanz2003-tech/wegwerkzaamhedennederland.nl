/**
 * Cookieless analytics: Cloudflare Web Analytics beacon, only when configured
 * (`site.analytics.provider === 'cloudflare'` and a non-empty token). Otherwise nothing loads.
 */
import site from '../../site.config.json';

const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

export function mountAnalytics(): boolean {
  const cfg = site.analytics;
  if (!cfg || cfg.provider !== 'cloudflare') return false;
  const token = typeof cfg.token === 'string' ? cfg.token.trim() : '';
  if (!token) return false;
  if (document.querySelector(`script[src="${BEACON_SRC}"]`)) return true;
  const s = document.createElement('script');
  s.defer = true;
  s.src = BEACON_SRC;
  s.dataset.cfBeacon = JSON.stringify({ token });
  document.head.appendChild(s);
  return true;
}
