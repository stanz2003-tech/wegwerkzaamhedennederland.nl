/**
 * Vite dev plugin (owner C): renders the generated routes on request from the source templates,
 * so `npm run dev` serves /weg/a2/, /plaats/breda/, /over/ … without a build step.
 * Templates and content are re-read on every request (dev only). Inert during `vite build`.
 */

import { dirname, join } from 'node:path';

import { loadPartials, loadTemplates } from './lib/render.mjs';
import { LIST_ROUTES, NOT_FOUND_SLUG, PAGE_TYPES, STATIC_ROUTES, buildModel, notFoundPage, renderPage } from './lib/pages.mjs';
import { copyLists } from './lib/lists.mjs';

const ENTITY_PREFIXES = new Map([
  ['weg', '/wegen/'],
  ['plaats', '/plaatsen/'],
  ['gemeente', '/plaatsen/'],
  ['brug', '/bruggen/'],
]);
const FLAT_ROUTES = new Set([...LIST_ROUTES.map((r) => r.path), ...STATIC_ROUTES.map((r) => r.path)]);

/** A page-shaped request: ends in a slash, is not the app root and carries no file extension. */
const PAGE_LIKE_RE = /^\/[^.]+\/$/;

/**
 * Classify a pathname: `{ path }` to render, `{ redirect }` for the canonical form,
 * `{ notFound: true }` for a page-shaped request that matches nothing, or `null` to let
 * Vite handle it (assets, `/`, `/data/…`, `/@vite/…`).
 */
export function matchRoute(pathname) {
  if (pathname === '/404.html') return { path: '/404.html' };
  const flat = /^\/([a-z-]+)\/?$/.exec(pathname);
  if (flat) {
    const withSlash = `/${flat[1]}/`;
    if (FLAT_ROUTES.has(withSlash)) return pathname === withSlash ? { path: withSlash } : { redirect: withSlash };
    if (ENTITY_PREFIXES.has(flat[1])) return { redirect: ENTITY_PREFIXES.get(flat[1]) };
    return PAGE_LIKE_RE.test(pathname) ? { notFound: true } : null;
  }
  const entity = /^\/(weg|plaats|gemeente|brug)\/([^/]+)\/?$/.exec(pathname);
  if (entity) {
    const canonical = `/${entity[1]}/${entity[2]}/`;
    return pathname === canonical ? { path: canonical } : { redirect: canonical };
  }
  // /weg/a2/onbekend/, /iets/anders/ … — a page URL that does not exist.
  if (PAGE_LIKE_RE.test(pathname) && !pathname.startsWith('/data/') && !pathname.startsWith('/lists/')) {
    return { notFound: true };
  }
  return null;
}

export function devPagesPlugin() {
  return {
    name: 'wegwerk:dev-pages',
    apply: 'serve',
    configureServer(server) {
      const webRoot = server.config.root;
      const repoRoot = dirname(webRoot);
      const logger = server.config.logger;
      const warn = (msg) => logger.warn(msg);

      try {
        copyLists({ repoRoot, webRoot, destDir: join(webRoot, 'public', 'lists'), warn });
      } catch (err) {
        warn(`[dev-pages] statische lijsten niet gekopieerd: ${err.message}`);
      }

      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();
        let url;
        try {
          url = new URL(req.url ?? '/', 'http://localhost');
        } catch {
          return next();
        }
        let pathname;
        try {
          pathname = decodeURIComponent(url.pathname);
        } catch {
          return next();
        }
        const route = matchRoute(pathname);
        if (!route) return next();
        if (route.redirect) {
          res.statusCode = 301;
          res.setHeader('Location', route.redirect + url.search);
          res.end();
          return;
        }
        try {
          const model = buildModel({ webRoot, repoRoot, warn });
          const templatesDir = join(webRoot, 'templates');
          const partials = loadPartials(templatesDir, { warn });
          const { templates, missing } = loadTemplates(templatesDir, partials, PAGE_TYPES);
          const page = (route.path && model.byPath.get(route.path)) ?? notFoundPage(model, pathname);
          if (!templates[page.type]) {
            throw new Error(`templates/${page.type}.html ontbreekt (ook ontbrekend: ${missing.join(', ') || '–'})`);
          }
          const raw = renderPage(page, model, templates);
          const html = await server.transformIndexHtml(url.pathname, raw, req.originalUrl);
          res.statusCode = page.slug === NOT_FOUND_SLUG ? 404 : 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(html);
        } catch (err) {
          logger.error(`[dev-pages] ${pathname}: ${err.stack ?? err.message}`);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(`Fout bij het renderen van ${pathname}\n\n${err.stack ?? err.message}\n`);
        }
      });
    },
  };
}
