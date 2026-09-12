/**
 * URL slug — byte-for-byte the same algorithm as `slugify()` in
 * `web/src/data/types.ts`. The static lists (wegen/plaatsen/bruggen) carry
 * pre-computed slugs, so the page generator and the client never re-slug.
 *
 * Lowercase, diacritics stripped, anything not [a-z0-9] becomes "-", collapsed,
 * trimmed. "'s-Hertogenbosch" → "s-hertogenbosch", "Bergen (NH)" → "bergen-nh",
 * "A12 hrb" → "a12-hrb".
 *
 * @param {string} input
 * @returns {string}
 */
export function slugify(input) {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
