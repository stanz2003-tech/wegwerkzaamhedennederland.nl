/**
 * Small dependency-free Markdown → HTML converter plus a front-matter parser, sized for the
 * content pages in `web/content/*.md`.
 *
 * Supported: ATX headings (with ids), paragraphs, hard line breaks (two trailing spaces),
 * ordered/unordered lists (nested by indentation), blockquotes, fenced code, tables (with
 * alignment), horizontal rules, raw HTML blocks, inline code, links, autolinks, images,
 * **bold**, *italic*, ~~strike~~. Text is HTML-escaped; inline HTML tags are passed through.
 */

/* ------------------------------------------------------------------------------------------ */
/* Front matter                                                                               */
/* ------------------------------------------------------------------------------------------ */

/** Parse `---\nkey: value\n---` (YAML subset: scalars and `- item` lists). */
export function parseFrontMatter(src) {
  const text = src.replace(/^﻿/, '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };
  return { data: parseYamlSubset(m[1]), body: text.slice(m[0].length) };
}

function parseYamlSubset(block) {
  const data = {};
  let listKey = null;
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(coerce(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === '') {
      data[key] = [];
      listKey = key;
    } else {
      data[key] = coerce(value);
      listKey = null;
    }
  }
  return data;
}

function coerce(raw) {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

/* ------------------------------------------------------------------------------------------ */
/* Helpers                                                                                    */
/* ------------------------------------------------------------------------------------------ */

export function escapeText(s) {
  return s.replace(/&(?![a-zA-Z]+;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return s.replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Same rules as `slugify()` in web/src/data/types.ts. */
export function slugify(input) {
  return String(input)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Strip Markdown syntax for plain-text contexts (meta descriptions, JSON-LD). */
export function stripMarkdown(md) {
  return md
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split a Markdown body into sections at headings of `level` (default `##`).
 * Returns `{ preamble, sections: [{ heading, body }] }`.
 */
export function splitSections(md, level = 2) {
  const re = new RegExp(`^#{${level}}\\s+(.+?)\\s*#*\\s*$`);
  const lines = md.split(/\r?\n/);
  const sections = [];
  const preamble = [];
  let current = null;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && re.exec(line);
    if (m) {
      current = { heading: m[1].trim(), body: [] };
      sections.push(current);
      continue;
    }
    (current ? current.body : preamble).push(line);
  }
  return {
    preamble: preamble.join('\n').trim(),
    sections: sections.map((s) => ({ heading: s.heading, body: s.body.join('\n').trim() })),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Inline                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const INLINE_HTML_RE = /<\/?[a-zA-Z][\w-]*(?:\s+[^<>]*?)?\/?>/g;

export function renderInline(text) {
  const holders = [];
  const hold = (html) => {
    holders.push(html);
    return `\u0000${holders.length - 1}\u0000`;
  };
  let s = text;
  s = s.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${escapeText(code)}</code>`));
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, url) => hold(`<a href="${escapeAttr(url)}">${escapeText(url)}</a>`));
  s = s.replace(INLINE_HTML_RE, (tag) => hold(tag));
  s = escapeText(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) =>
    hold(`<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${title ? ` title="${escapeAttr(title)}"` : ''} loading="lazy">`),
  );
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, href, title) => {
    const attrs = [`href="${escapeAttr(href)}"`];
    if (title) attrs.push(`title="${escapeAttr(title)}"`);
    return hold(`<a ${attrs.join(' ')}>${renderEmphasis(label)}</a>`);
  });
  s = renderEmphasis(s);
  s = s.replace(/ {2,}\n/g, '<br>\n');
  // Restore placeholders; extra passes resolve placeholders nested inside link labels.
  for (let pass = 0; pass < 3 && s.includes('\u0000'); pass++) {
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => holders[Number(i)]);
  }
  return s;
}

function renderEmphasis(s) {
  return s
    .replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![\w\\])__(?=\S)([\s\S]+?)(?<=\S)__(?!\w)/g, '<strong>$1</strong>')
    .replace(/(?<![\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/g, '<em>$1</em>')
    .replace(/(?<![\w_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\w_])/g, '<em>$1</em>')
    .replace(/~~(?=\S)([^~\n]+?)(?<=\S)~~/g, '<del>$1</del>');
}

/* ------------------------------------------------------------------------------------------ */
/* Blocks                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl', 'fieldset', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'iframe', 'main', 'nav', 'ol',
  'p', 'pre', 'section', 'summary', 'table', 'ul', 'video', 'script', 'style', 'noscript',
]);
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE_RE = /^ {0,3}(```|~~~)\s*([\w+-]*)\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

export function markdownToHtml(md, { headingIds = true, headingOffset = 0 } = {}) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const usedIds = new Set();
  return renderBlocks(lines, { headingIds, headingOffset, usedIds }).join('\n');
}

function renderBlocks(lines, opts) {
  const out = [];
  let para = [];
  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${renderInline(para.join('\n')).trim()}</p>`);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flushPara();
      continue;
    }
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushPara();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith(fence[1])) code.push(lines[i++]);
      const cls = fence[2] ? ` class="language-${escapeAttr(fence[2])}"` : '';
      out.push(`<pre><code${cls}>${escapeText(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara();
      const level = Math.min(6, heading[1].length + opts.headingOffset);
      const text = heading[2];
      const id = opts.headingIds ? ` id="${uniqueId(slugify(stripMarkdown(text)) || 'kop', opts.usedIds)}"` : '';
      out.push(`<h${level}${id}>${renderInline(text)}</h${level}>`);
      continue;
    }
    if (HR_RE.test(line)) {
      flushPara();
      out.push('<hr>');
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      flushPara();
      const quote = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
      i--;
      out.push(`<blockquote>\n${renderBlocks(quote, opts).join('\n')}\n</blockquote>`);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      flushPara();
      const rows = [line];
      const aligns = parseAligns(lines[i + 1]);
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(lines[i++]);
      i--;
      out.push(renderTable(rows, aligns));
      continue;
    }
    const list = LIST_RE.exec(line);
    if (list) {
      flushPara();
      const block = [line];
      const baseIndent = list[1].length;
      const ordered = /\d/.test(list[2]);
      // A base-level marker of the other kind starts a new list.
      const sameList = (l) => {
        const m = LIST_RE.exec(l);
        return m && (m[1].length > baseIndent || /\d/.test(m[2]) === ordered);
      };
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) {
          const next = lines[i + 1];
          if (next !== undefined && (/^\s+\S/.test(next) || (LIST_RE.test(next) && sameList(next)))) {
            block.push('');
            i++;
            continue;
          }
          break;
        }
        if ((LIST_RE.test(l) && sameList(l)) || /^\s+\S/.test(l)) {
          block.push(l);
          i++;
          continue;
        }
        break;
      }
      i--;
      out.push(renderList(block, opts));
      continue;
    }
    const html = /^\s{0,3}<(\/?)([a-zA-Z][\w-]*)/.exec(line);
    if (html && (BLOCK_TAGS.has(html[2].toLowerCase()) || line.startsWith('<!--'))) {
      flushPara();
      const raw = [line];
      i++;
      while (i < lines.length && lines[i].trim()) raw.push(lines[i++]);
      i--;
      out.push(raw.join('\n'));
      continue;
    }
    para.push(line);
  }
  flushPara();
  return out;
}

function uniqueId(base, used) {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

function parseAligns(sep) {
  return splitCells(sep).map((c) => {
    const t = c.trim();
    if (t.startsWith(':') && t.endsWith(':')) return 'center';
    if (t.endsWith(':')) return 'right';
    if (t.startsWith(':')) return 'left';
    return '';
  });
}

function splitCells(row) {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1);
  return r.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

function renderTable(rows, aligns) {
  const cell = (tag, text, idx) => {
    const a = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '';
    return `<${tag}${a}>${renderInline(text)}</${tag}>`;
  };
  const head = splitCells(rows[0]).map((c, i) => cell('th', c, i)).join('');
  const body = rows
    .slice(1)
    .map((r) => `<tr>${splitCells(r).map((c, i) => cell('td', c, i)).join('')}</tr>`)
    .join('\n');
  return `<div class="table-wrap"><table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table></div>`;
}

function renderList(block, opts) {
  const first = LIST_RE.exec(block[0]);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let cur = null;
  for (const line of block) {
    const m = LIST_RE.exec(line);
    if (m && m[1].length <= baseIndent) {
      cur = { lines: [m[3]], contentIndent: m[1].length + m[2].length + 1 };
      items.push(cur);
      continue;
    }
    if (!cur) continue;
    if (!line.trim()) {
      cur.lines.push('');
      continue;
    }
    const indent = /^\s*/.exec(line)[0].length;
    cur.lines.push(line.slice(Math.min(indent, cur.contentIndent)));
  }
  const start = ordered && Number.parseInt(first[2], 10) !== 1 ? ` start="${Number.parseInt(first[2], 10)}"` : '';
  const tag = ordered ? 'ol' : 'ul';
  const li = items.map((it) => {
    const inner = renderBlocks(it.lines, opts);
    const tight = !it.lines.some((l) => !l.trim());
    if (tight && inner.length && inner[0].startsWith('<p>')) inner[0] = inner[0].slice(3, -4);
    return `<li>${inner.join('\n')}</li>`;
  });
  return `<${tag}${start}>\n${li.join('\n')}\n</${tag}>`;
}
