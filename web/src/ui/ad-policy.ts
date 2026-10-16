/**
 * Pages we keep out of Google get no ads either: the place and bridge pages that have nothing to
 * show today (`noindex, follow`, web/scripts/lib/activity.mjs) and the 404 page. AdSense does not
 * allow ads on pages without publisher content, and an empty page with ads is what a reviewer flags.
 */
export function robotsAllowAds(robots: string | null | undefined): boolean {
  return !/\bnoindex\b/i.test(robots ?? '');
}
