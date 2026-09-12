/**
 * Minimal Mustache/Handlebars-style template engine for the page generator and the dev plugin.
 *
 *   {{var}}                 HTML-escaped value (dotted paths: {{site.name}})
 *   {{{raw}}}               unescaped (trusted HTML)
 *   {{#if x}}…{{else}}…{{/if}}
 *   {{#unless x}}…{{/unless}}
 *   {{#each list}}…{{this}} {{prop}} {{@index}} {{@first}} {{@last}}…{{else}}…{{/each}}
 *   {{! comment }}
 *
 * Lookups walk the scope chain (item → parent → root), so an `each` body can read outer vars.
 * Partials are injected textually at `<!-- @name -->` markers *before* compiling, so the
 * partial source may itself contain placeholders.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const TAG_RE = /\{\{\{\s*([^}]+?)\s*\}\}\}|\{\{\s*([^}]+?)\s*\}\}/g;

/** Parse template source into a node tree. */
function parse(src) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  let last = 0;
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(src)) !== null) {
    const top = stack[stack.length - 1];
    if (m.index > last) pushText(top, src.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] !== undefined) {
      pushChild(top, { type: 'var', path: m[1], raw: true });
      continue;
    }
    const tag = m[2];
    if (tag.startsWith('!')) continue;
    if (tag.startsWith('#')) {
      const [kind, ...rest] = tag.slice(1).trim().split(/\s+/);
      if (kind !== 'if' && kind !== 'unless' && kind !== 'each') {
        throw new Error(`Onbekend blok {{#${kind}}}`);
      }
      const node = { type: kind, path: rest.join(' '), children: [], elseChildren: null };
      pushChild(top, node);
      stack.push(node);
      continue;
    }
    if (tag === 'else') {
      if (stack.length < 2) throw new Error('{{else}} buiten een blok');
      top.elseChildren = [];
      continue;
    }
    if (tag.startsWith('/')) {
      const kind = tag.slice(1).trim();
      if (stack.length < 2 || top.type !== kind) {
        throw new Error(`Onverwachte sluiting {{/${kind}}} (open: ${top.type})`);
      }
      stack.pop();
      continue;
    }
    pushChild(top, { type: 'var', path: tag, raw: false });
  }
  if (last < src.length) pushText(stack[stack.length - 1], src.slice(last));
  if (stack.length !== 1) throw new Error(`Blok {{#${stack[stack.length - 1].type}}} is niet gesloten`);
  return root;
}

function pushText(node, text) {
  pushChild(node, { type: 'text', text });
}

function pushChild(node, child) {
  (node.elseChildren ?? node.children).push(child);
}

/** Resolve a dotted path against the scope chain (innermost first). */
function lookup(scopes, path) {
  if (path === 'this' || path === '.') return scopes[scopes.length - 1].value;
  if (path.startsWith('@')) {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const meta = scopes[i].meta;
      if (meta && path in meta) return meta[path];
    }
    return undefined;
  }
  let depth = 0;
  while (path.startsWith('../')) {
    depth++;
    path = path.slice(3);
  }
  const parts = path.split('.');
  for (let i = scopes.length - 1 - depth; i >= 0; i--) {
    const found = walk(scopes[i].value, parts);
    if (found !== undefined) return found;
  }
  return undefined;
}

function walk(value, parts) {
  let cur = value;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object' && typeof cur !== 'function') return undefined;
    cur = cur[p];
  }
  return cur;
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function renderNodes(nodes, scopes, out) {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        out.push(node.text);
        break;
      case 'var': {
        const v = lookup(scopes, node.path);
        if (v === undefined || v === null) break;
        out.push(node.raw ? String(v) : escapeHtml(v));
        break;
      }
      case 'if':
      case 'unless': {
        const v = truthy(lookup(scopes, node.path));
        const show = node.type === 'if' ? v : !v;
        if (show) renderNodes(node.children, scopes, out);
        else if (node.elseChildren) renderNodes(node.elseChildren, scopes, out);
        break;
      }
      case 'each': {
        const list = lookup(scopes, node.path);
        const arr = Array.isArray(list) ? list : list && typeof list === 'object' ? Object.values(list) : [];
        if (arr.length === 0) {
          if (node.elseChildren) renderNodes(node.elseChildren, scopes, out);
          break;
        }
        for (let i = 0; i < arr.length; i++) {
          const meta = { '@index': i, '@first': i === 0, '@last': i === arr.length - 1, '@number': i + 1 };
          renderNodes(node.children, [...scopes, { value: arr[i], meta }], out);
        }
        break;
      }
      default:
        break;
    }
  }
}

/** Compile once, render many times. Returns `(ctx) => string`. */
export function compile(src) {
  const tree = parse(src);
  return function render(ctx) {
    const out = [];
    renderNodes(tree.children, [{ value: ctx ?? {} }], out);
    return out.join('');
  };
}

export function render(src, ctx) {
  return compile(src)(ctx);
}

/* ------------------------------------------------------------------------------------------ */
/* Partials                                                                                   */
/* ------------------------------------------------------------------------------------------ */

const PARTIAL_MARKER_RE = /<!--\s*@([a-z][\w-]*)\s*-->/g;

/**
 * Replace `<!-- @name -->` markers with partial sources (recursively, so `_head.html` may
 * contain `<!-- @head-theme -->`). Unknown markers are left in place.
 */
export function injectPartials(html, partials, depth = 0) {
  if (depth > 4) return html;
  return html.replace(PARTIAL_MARKER_RE, (whole, name) => {
    const partial = partials[name];
    if (partial === undefined) return whole;
    return injectPartials(partial, partials, depth + 1);
  });
}

/** Inline fallbacks used while B's partials (`templates/partials/*.html`) do not exist yet. */
export const FALLBACK_PARTIALS = {
  'head-theme':
    '<script>try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}</script>',
  header: `<header class="topbar" data-topbar>
  <a class="brand" href="/" aria-label="{{site.name}} – naar de kaart"><span class="brand__mark" aria-hidden="true"></span><span class="brand__word">{{site.name}}</span><span class="brand__sub">Nederland</span></a>
  <nav class="topbar__nav" aria-label="Hoofdmenu">
    <a href="/">Kaart</a>
    <a href="/wegen/">Wegen</a>
    <a href="/plaatsen/">Plaatsen</a>
    <a href="/bruggen/">Bruggen</a>
    <a href="/afsluitingen/">Afsluitingen</a>
    <a href="/files/">Files</a>
    <a href="/veelgestelde-vragen/">Vragen</a>
    <a href="/over/">Over</a>
  </nav>
  <span class="live" data-live hidden></span>
  <button class="theme-toggle" type="button" data-theme-toggle aria-label="Donker of licht thema"></button>
</header>`,
  footer: `<footer class="site-footer">
  <p class="site-footer__attribution">{{site.attribution}}</p>
  <nav class="site-footer__links" aria-label="Juridisch">
    <a href="/privacy/">Privacy</a>
    <a href="/cookies/">Cookies</a>
    <a href="/disclaimer/">Disclaimer</a>
    <a href="/colofon/">Colofon</a>
    <a href="/contact/">Contact</a>
    <a href="#" data-cmp-open>Cookie-instellingen</a>
  </nav>
</footer>`,
};

const warnedPartials = new Set();

/**
 * Load `_head.html` plus B's partials (`templates/partials/{head-theme,header,footer}.html`).
 * Missing partials fall back to inline minimal markup and warn once per process.
 */
export function loadPartials(templatesDir, { warn = console.warn } = {}) {
  const partials = {};
  const headPath = join(templatesDir, '_head.html');
  partials.head = existsSync(headPath) ? readFileSync(headPath, 'utf8') : '';
  for (const name of ['head-theme', 'header', 'footer']) {
    const p = join(templatesDir, 'partials', `${name}.html`);
    if (existsSync(p)) {
      partials[name] = readFileSync(p, 'utf8');
    } else {
      partials[name] = FALLBACK_PARTIALS[name];
      if (!warnedPartials.has(name)) {
        warnedPartials.add(name);
        warn(`[gen-pages] partial templates/partials/${name}.html ontbreekt – inline fallback gebruikt`);
      }
    }
  }
  return partials;
}

/**
 * Read `<type>.html` from `shellDir`, inject partials and compile. Returns a map
 * `type → render(ctx)`. Missing shells are reported via `missing`.
 */
export function loadTemplates(shellDir, partials, types) {
  const templates = {};
  const missing = [];
  for (const type of types) {
    const p = join(shellDir, `${type}.html`);
    if (!existsSync(p)) {
      missing.push(type);
      continue;
    }
    const src = injectPartials(readFileSync(p, 'utf8'), partials);
    try {
      templates[type] = compile(src);
    } catch (err) {
      throw new Error(`Template ${type}.html: ${err.message}`);
    }
  }
  return { templates, missing };
}
