/**
 * One ad slot inside a long text page (a guide, the FAQ), between two sections. The only slot of
 * those pages stood under the last line, where few readers arrive. This one comes after about a
 * screen of reading and never inside a section: only right before an `<h2>`.
 */

/** The `top` slot of web/src/ui/ads.ts: it keeps its room from the first paint. */
export const IN_ARTICLE_SLOT = '<div class="ad-slot ad-slot--article" data-ad-slot="top" aria-hidden="true"></div>';

/** Characters of text above the slot: about one phone screen of reading. */
export const MIN_TEXT_BEFORE = 1200;
/** Characters of text below it; with less, the slot at the end of the page is close enough. */
export const MIN_TEXT_AFTER = 1200;

/** The length of the text in a piece of HTML, tags left out. */
function textLength(html) {
  return html.replace(/<[^>]*>/g, '').length;
}

/**
 * `bodyHtml` with the slot before the first `<h2>` that has enough text above and below it;
 * unchanged when no heading qualifies (a short page).
 */
export function withInArticleAd(bodyHtml) {
  const total = textLength(bodyHtml);
  for (const match of bodyHtml.matchAll(/<h2[\s>]/g)) {
    const before = textLength(bodyHtml.slice(0, match.index));
    if (before < MIN_TEXT_BEFORE) continue;
    if (total - before < MIN_TEXT_AFTER) return bodyHtml;
    return `${bodyHtml.slice(0, match.index)}${IN_ARTICLE_SLOT}\n${bodyHtml.slice(match.index)}`;
  }
  return bodyHtml;
}
