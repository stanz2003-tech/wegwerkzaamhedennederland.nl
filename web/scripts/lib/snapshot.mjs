/**
 * Server-visible content: at build time, road and place pages get the answer card, the count, the
 * first 20 roadworks and the question block ("Is de A2 vandaag dicht?", "Is er morgen een weg dicht
 * in Mildam?"), from the same data files the pages load in
 * the browser (`DATA_BASE` roads/<slug>.json and gemeenten/<slug>.json), computed with the same
 * TypeScript functions (web/src/ui/entity-snapshot.ts, ui/road-questions.ts). The lists
 * /afsluitingen/, /vandaag/ and /dit-weekend/ get their summary and first rows (ui/list-sections.ts),
 * bridge pages their openings of the coming week (ui/bridge-openings.ts).
 *
 * Why: search engines and AI crawlers read the HTML as served. Until 2026-10 that held only
 * template text and a hidden "Geen meldingen voor …", while ~90% of the clicks come from searches
 * for a street or place (docs/groei-onderzoek-2026-10.md, fase 2). The page script replaces the
 * snapshot with the live data at once; the snapshot names the moment of its data.
 *
 * Never throws: a file that fails to load falls back to the index rows (as the page does), and
 * without data no page gets a snapshot (the page then renders as before).
 */

import { importSrc } from './ts-loader.mjs';

const FETCH_TIMEOUT_MS = 30_000;
const CONCURRENCY = 16;
/** The whole fetch phase: a hanging data host must not run the deploy past its 20 minutes. */
const BUDGET_MS = 5 * 60_000;
const MAX_REPORTED_FAILURES = 5;

/**
 * GET a JSON file: the parsed body, null on 404 (no file = no items, or v2 data), throws otherwise.
 */
async function fetchEntity(url, fetchImpl, budget) {
  const signal = budget ? AbortSignal.any([AbortSignal.timeout(FETCH_TIMEOUT_MS), budget]) : AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const res = await fetchImpl(url, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** One retry: a single slow response (two of 960 in a test run) should not cost a page its list. */
async function fetchEntityRetry(url, fetchImpl, budget) {
  try {
    return await fetchEntity(url, fetchImpl, budget);
  } catch (err) {
    if (budget?.aborted) throw err;
    return fetchEntity(url, fetchImpl, budget);
  }
}

/** Runs `task` over `list` with at most `limit` at a time; results in input order. */
async function pool(list, limit, task) {
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await task(list[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

/**
 * Loads the entity files of these road and gemeente slugs. Per slug: the items array, `null` when
 * the file does not exist (404), `undefined` when it failed to load or did not validate.
 * @returns {Promise<{ roads: Map<string, any[] | null | undefined>, gemeenten: Map<string, any[] | null | undefined>, failed: number }>}
 */
export async function loadEntityFiles({ dataBase, roads, gemeenten, fetchImpl = globalThis.fetch, warn = console.warn, isEntityFile, budgetMs = BUDGET_MS }) {
  const budget = AbortSignal.timeout(budgetMs);
  const base = dataBase.endsWith('/') ? dataBase : `${dataBase}/`;
  const jobs = [...roads.map((slug) => ({ kind: 'roads', slug })), ...gemeenten.map((slug) => ({ kind: 'gemeenten', slug }))];
  let failed = 0;
  const results = await pool(jobs, CONCURRENCY, async ({ kind, slug }) => {
    try {
      if (budget.aborted) throw new Error('tijdbudget op');
      const json = await fetchEntityRetry(`${base}${kind}/${encodeURIComponent(slug)}.json`, fetchImpl, budget);
      if (json === null) return null;
      if (isEntityFile && !isEntityFile(json)) throw new Error('geen geldig entiteitsbestand');
      return json.items;
    } catch (err) {
      failed++;
      if (failed <= MAX_REPORTED_FAILURES) warn(`[gen-pages] ${kind}/${slug}.json niet geladen (${err?.message ?? err}) – val terug op de index`);
      return undefined;
    }
  });
  if (failed > MAX_REPORTED_FAILURES) warn(`[gen-pages] … en nog ${failed - MAX_REPORTED_FAILURES} entiteitsbestanden niet geladen`);
  const out = { roads: new Map(), gemeenten: new Map(), failed };
  jobs.forEach((job, i) => out[job.kind].set(job.slug, results[i]));
  return out;
}

/** The TypeScript modules the snapshots are computed with. */
export async function loadSnapshotModules() {
  const [snapshot, questions, entity, entityFile, index, filter, types, format, load, listSections, entityList, bridgeOpenings] = await Promise.all([
    importSrc('ui/entity-snapshot.ts'),
    importSrc('ui/road-questions.ts'),
    importSrc('data/entity.ts'),
    importSrc('data/entity-file.ts'),
    importSrc('data/index.ts'),
    importSrc('data/filter.ts'),
    importSrc('data/types.ts'),
    importSrc('ui/format.ts'),
    importSrc('data/load.ts'),
    importSrc('ui/list-sections.ts'),
    importSrc('ui/entity-list.ts'),
    importSrc('ui/bridge-openings.ts'),
  ]);
  return { snapshot, questions, entity, entityFile, index, filter, types, format, load, listSections, entityList, bridgeOpenings };
}

/** The list pages with a snapshot; /files/ has none: a traffic jam of 06:41 says nothing later. */
const SNAPSHOT_LISTS = new Set(['afsluitingen', 'vandaag', 'weekend']);
const BRIDGE_DAYS = 7;

const LIST_WHEN = { vandaag: 'voor vandaag', weekend: 'voor dit weekend' };

/** "2.433 afsluitingen nu dicht · …" as the page says it, or a count where its line is an intro. */
function listStampText(id, view, format) {
  if (/[0-9]/.test(view.summary)) return view.summary;
  const n = (count, one, many) => `${format.formatCount(count)} ${count === 1 ? one : many}`;
  const parts = [`${n(view.counts.changes, 'melding', 'meldingen')} ${LIST_WHEN[id] ?? ''}`.trim()];
  if (view.counts.background > 0) parts.push(`${n(view.counts.background, 'langdurige maatregel loopt', 'langdurige maatregelen lopen')} al langer`);
  return parts.join(' · ');
}

const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Builds `snapshotFor(page, { mapHref })` for buildModel: the snapshot of a road, place, list or
 * bridge page, or null when there is nothing to base it on.
 * @param {object} p
 * @param {Awaited<ReturnType<typeof loadSnapshotModules>>} p.mods
 * @param {{ index: any, meta: any } | null} p.live   loadLiveFiles() result
 * @param {Awaited<ReturnType<typeof loadEntityFiles>> | null} p.files
 * @param {number} p.now
 */
export function createSnapshotter({ mods, live, files, now }) {
  if (!live) return null;
  const rows = Array.isArray(live.index?.rows) ? mods.index.rowsToItems(live.index.rows) : [];
  const generated = Date.parse(live.meta?.generated ?? live.index?.generated ?? '');
  const asOf = mods.format.fmtDayTime(Number.isFinite(generated) ? generated : now);
  const horizon = Date.parse(live.meta?.horizon?.until ?? '');
  const horizonMs = Number.isFinite(horizon) ? horizon : undefined;

  // Same fallback as the page script: index points without detail when there is no file.
  const fromIndex = (list) => list.map((it) => ({ f: mods.entity.featureFromIndexItem(it), d: null }));
  const sanitize = (items) => mods.entityFile.sanitizeEntityItems({ items }).map((it) => ({ f: it.f, d: it.d }));
  const fileItems = (kind, slug) => {
    const items = files?.[kind]?.get(slug);
    return Array.isArray(items) ? sanitize(items) : null;
  };
  const gemeenteCache = new Map();
  const gemeenteItems = (slug, name) => {
    if (!gemeenteCache.has(slug)) gemeenteCache.set(slug, fileItems('gemeenten', slug) ?? fromIndex(mods.index.itemsInGemeente(rows, name)));
    return gemeenteCache.get(slug);
  };

  const itemsFor = (page) => {
    const e = page.entity;
    if (page.type === 'road') return fileItems('roads', e.slug) ?? fromIndex(mods.entity.itemsOnRoadLoose(rows, e.road));
    if (page.kind === 'gemeente') return gemeenteItems(e.slug, e.naam);
    if (page.kind === 'woonplaats') {
      if (!e.gemeente) return fromIndex(mods.index.itemsInWoonplaats(rows, e.naam));
      const w = mods.filter.normalizeText(e.naam);
      const inGemeente = gemeenteItems(mods.types.slugify(e.gemeente), e.gemeente);
      return inGemeente.filter((it) => it.f.properties.woonplaats !== undefined && it.f.properties.woonplaats !== null && mods.filter.normalizeText(it.f.properties.woonplaats) === w);
    }
    return null;
  };

  const listSnapshot = (page) => {
    if (!SNAPSHOT_LISTS.has(page.list) || rows.length === 0) return null;
    const view = mods.listSections.listView(page.list, rows, now);
    const listOpts = view.linkQuery ? { linkQuery: view.linkQuery } : {};
    const { html, more } = mods.entityList.renderSectionsHtml(view.sections, now, listOpts, mods.snapshot.SNAPSHOT_ROWS);
    const stamp = `<p class="entity-snapshot__stamp">Stand van ${escapeHtml(asOf)}: ${escapeHtml(listStampText(page.list, view, mods.format))}</p>`;
    const moreLine = more > 0 ? `<p class="entity-snapshot__more">En nog ${more === 1 ? '1 melding' : `${mods.format.formatCount(more)} meldingen`}: <a href="/">bekijk ze op de kaart</a>.</p>` : '';
    return { summary: view.summary, listHtml: `${stamp}${view.motorwayHtml}${html}${moreLine}`, asOf };
  };

  const bridgeList = Array.isArray(live.bridges?.bridges) ? live.bridges.bridges : null;
  const bridgeSnapshot = (page) => {
    const entry = bridgeList?.find((b) => b && b.id === page.entity.id);
    if (!entry) return null;
    const openings = mods.bridgeOpenings.parseOpenings(entry, now, BRIDGE_DAYS);
    let text;
    if (entry.openNow === true) text = `Stand van ${asOf}: de brug stond open voor de scheepvaart.`;
    else if (openings.length > 0) {
      const n = openings.length === 1 ? '1 geplande opening' : `${openings.length} geplande openingen`;
      text = `Stand van ${asOf}: ${n} in de komende ${BRIDGE_DAYS} dagen, de eerste ${mods.format.fmtDayTime(openings.find((o) => o.start >= now)?.start ?? openings[0].start)}.`;
    } else return null;
    // The openings themselves, by date: the page names "vandaag" and "nu open" once its script runs.
    const days = mods.bridgeOpenings.openingsHtml(openings, now, { relativeDays: false });
    return { openingsHtml: `<li class="bridge-openings__notice">${escapeHtml(text)}</li>${days}`, asOf };
  };

  return (page, { mapHref }) => {
    if (page.type === 'list') return listSnapshot(page);
    if (page.type === 'bridge') return bridgeSnapshot(page);
    if (page.type !== 'road' && page.type !== 'place') return null;
    const items = itemsFor(page);
    if (!items) return null;
    const e = page.entity;
    const subject = page.type === 'road' ? { kind: 'road', name: e.road } : { kind: page.kind, name: e.naam };
    const roadType = page.type === 'road' && ['A', 'N', 'S', 'E', 'lokaal'].includes(e.type) ? e.type : null;
    const snap = mods.snapshot.entitySnapshot({ items, subject, roadType, now, horizonMs, asOf, mapHref });
    const questions =
      page.type === 'road' ? mods.questions.roadQuestions(items, e.road, now, horizonMs) : mods.questions.placeQuestions(items, subject, now, horizonMs);
    const questionsHtml = mods.questions.renderRoadQuestions(questions, `stand van ${asOf}`);
    return { ...snap, questionsHtml, asOf };
  };
}
