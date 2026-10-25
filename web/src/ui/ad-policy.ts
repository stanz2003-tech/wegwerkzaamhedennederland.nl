/**
 * Pages we keep out of Google get no ads either: the place and bridge pages that have nothing to
 * show today (`noindex, follow`, web/scripts/lib/activity.mjs) and the 404 page. AdSense does not
 * allow ads on pages without publisher content, and an empty page with ads is what a reviewer flags.
 */
export function robotsAllowAds(robots: string | null | undefined): boolean {
  return !/\bnoindex\b/i.test(robots ?? '');
}

/**
 * A place or bridge page with nothing today that Google still indexes (the 60-day memory,
 * web/scripts/lib/index-state.mjs) says `<meta name="wegwerk-ads" content="off">`: it keeps its
 * place in search, but an ad next to "Niets gemeld" is still an ad on a page without content.
 */
export function pageAllowsAds(robots: string | null | undefined, adsMeta: string | null | undefined): boolean {
  return robotsAllowAds(robots) && (adsMeta ?? '').trim().toLowerCase() !== 'off';
}
