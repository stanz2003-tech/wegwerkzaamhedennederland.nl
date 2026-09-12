/**
 * sitemap.xml (+ sitemap index when > `maxPerFile` URLs), robots.txt and ads.txt.
 */

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

/**
 * @param {Array<{path:string, priority?:number, changefreq?:string, lastmod?:string}>} entries
 * @returns {Array<{name:string, xml:string}>} files to write in the dist root
 */
export function buildSitemaps(entries, { siteUrl, lastmod, maxPerFile = 5000 }) {
  const base = siteUrl.replace(/\/+$/, '');
  const urlXml = (e) => {
    const parts = [`<loc>${escapeXml(base + e.path)}</loc>`, `<lastmod>${escapeXml(e.lastmod ?? lastmod)}</lastmod>`];
    if (e.changefreq) parts.push(`<changefreq>${e.changefreq}</changefreq>`);
    if (typeof e.priority === 'number') parts.push(`<priority>${e.priority.toFixed(1)}</priority>`);
    return `<url>${parts.join('')}</url>`;
  };
  const wrap = (body) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

  if (entries.length <= maxPerFile) {
    return [{ name: 'sitemap.xml', xml: wrap(entries.map(urlXml).join('\n')) }];
  }
  const files = [];
  for (let i = 0; i < entries.length; i += maxPerFile) {
    const n = files.length + 1;
    files.push({ name: `sitemap-${n}.xml`, xml: wrap(entries.slice(i, i + maxPerFile).map(urlXml).join('\n')) });
  }
  const index =
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    files.map((f) => `<sitemap><loc>${escapeXml(`${base}/${f.name}`)}</loc><lastmod>${escapeXml(lastmod)}</lastmod></sitemap>`).join('\n') +
    `\n</sitemapindex>\n`;
  return [{ name: 'sitemap.xml', xml: index }, ...files];
}

export function buildRobots({ siteUrl, disallow = [] }) {
  const base = siteUrl.replace(/\/+$/, '');
  const lines = ['User-agent: *', 'Allow: /'];
  for (const d of disallow) lines.push(`Disallow: ${d}`);
  lines.push('', `Sitemap: ${base}/sitemap.xml`, '');
  return lines.join('\n');
}

/** `ca-pub-123` or `pub-123` → the ads.txt line Google prescribes. Returns null when unusable. */
export function buildAdsTxt(adsenseClient) {
  const m = /(?:ca-)?(pub-\d{10,20})/.exec(adsenseClient ?? '');
  if (!m || /^pub-0+$/.test(m[1])) return null;
  return `google.com, ${m[1]}, DIRECT, f08c47fec0942fa0\n`;
}
