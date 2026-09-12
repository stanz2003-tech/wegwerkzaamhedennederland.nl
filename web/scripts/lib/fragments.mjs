/**
 * Server-side rendered link lists for `/wegen/`, `/plaatsen/` and `/bruggen/`.
 * Links carry data attributes (`data-road`, `data-gemeente`, `data-woonplaats`, `data-bridge-id`)
 * so B's list script can decorate them with live counts without re-rendering.
 */

import { escapeHtml as esc } from './render.mjs';
import { roadNumber } from './lists.mjs';
import { roadKind } from './text.mjs';

const ROAD_GROUP_ORDER = ['A', 'N', 'S', 'E', 'overig'];

function roadLink(r) {
  const kind = roadKind(r.type);
  return `<li><a class="badge badge--${kind.badge}" href="/weg/${esc(r.slug)}/" data-road="${esc(r.road)}" title="Wegwerkzaamheden ${esc(r.road)}">${esc(r.road)}</a></li>`;
}

function sortRoads(a, b) {
  return roadNumber(a.road) - roadNumber(b.road) || a.road.localeCompare(b.road, 'nl');
}

/** Roads grouped A / N (per hundred) / S / E / other, as badge chips. */
export function renderWegenList(roads) {
  const groups = new Map();
  for (const r of roads) {
    const key = ROAD_GROUP_ORDER.includes(r.type) ? r.type : 'overig';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = [];
  for (const key of ROAD_GROUP_ORDER) {
    const list = groups.get(key);
    if (!list?.length) continue;
    list.sort(sortRoads);
    const kind = roadKind(key);
    out.push(`<section class="list-group list-group--${kind.badge}" aria-labelledby="wegen-${kind.badge}">`);
    out.push(`<h2 id="wegen-${kind.badge}">${esc(kind.groupTitle)} <span class="list-group__count">${list.length}</span></h2>`);
    if (key === 'N' && list.length > 60) {
      const buckets = new Map();
      for (const r of list) {
        const n = roadNumber(r.road);
        const b = Number.isNaN(n) ? 'overig' : Math.floor(n / 100) * 100;
        if (!buckets.has(b)) buckets.set(b, []);
        buckets.get(b).push(r);
      }
      for (const [b, items] of [...buckets.entries()].sort((x, y) => (x[0] === 'overig') - (y[0] === 'overig') || x[0] - y[0])) {
        const label = b === 'overig' ? 'Overige N-wegen' : b === 0 ? 'N1 – N99' : `N${b} – N${b + 99}`;
        out.push(`<h3 class="list-group__sub">${label}</h3>`);
        out.push(`<ul class="chips chips--badges">${items.map(roadLink).join('')}</ul>`);
      }
    } else {
      out.push(`<ul class="chips chips--badges">${list.map(roadLink).join('')}</ul>`);
    }
    out.push('</section>');
  }
  return out.join('\n');
}

/** Gemeenten alphabetically (letter headings + jump nav) with their woonplaatsen in <details>. */
export function renderPlaatsenList(gemeenten, woonplaatsenByGemeente) {
  const sorted = [...gemeenten].sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  const byLetter = new Map();
  for (const g of sorted) {
    const letter = g.naam.normalize('NFD').replace(/[̀-ͯ]/g, '').charAt(0).toUpperCase().replace(/[^A-Z]/, '#');
    if (!byLetter.has(letter)) byLetter.set(letter, []);
    byLetter.get(letter).push(g);
  }
  const letters = [...byLetter.keys()];
  const out = [];
  if (letters.length > 6) {
    out.push(`<nav class="letter-nav" aria-label="Springen naar letter"><ul>${letters
      .map((l) => `<li><a href="#gemeenten-${l === '#' ? 'overig' : l.toLowerCase()}">${l}</a></li>`)
      .join('')}</ul></nav>`);
  }
  for (const [letter, list] of byLetter) {
    const id = `gemeenten-${letter === '#' ? 'overig' : letter.toLowerCase()}`;
    out.push(`<section class="list-group" aria-labelledby="${id}"><h2 id="${id}" class="list-group__letter">${esc(letter)}</h2>`);
    for (const g of list) {
      const places = (woonplaatsenByGemeente.get(g.code) ?? []).slice().sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
      const count = places.length;
      const countLabel = count === 0 ? '' : ` <span class="list-group__count">${count} ${count === 1 ? 'plaats' : 'plaatsen'}</span>`;
      out.push(`<details class="place-group" data-gemeente="${esc(g.naam)}">`);
      out.push(`<summary><span class="place-group__name">${esc(g.naam)}</span> <span class="place-group__prov">${esc(g.prov ?? '')}</span>${countLabel}</summary>`);
      out.push(`<div class="place-group__body">`);
      out.push(`<p><a class="place-group__gemeente" href="/gemeente/${esc(g.slug)}/" data-gemeente="${esc(g.naam)}">Alle werkzaamheden in de gemeente ${esc(g.naam)}</a></p>`);
      if (count) {
        out.push(`<ul class="chips">${places
          .map((w) => `<li><a class="chip" href="/plaats/${esc(w.slug)}/" data-woonplaats="${esc(w.naam)}">${esc(w.naam)}</a></li>`)
          .join('')}</ul>`);
      }
      out.push('</div></details>');
    }
    out.push('</section>');
  }
  return out.join('\n');
}

/** Bridges grouped by provincie, alphabetically. */
export function renderBruggenList(bridges) {
  const byProv = new Map();
  for (const b of bridges) {
    const prov = b.prov || 'Provincie onbekend';
    if (!byProv.has(prov)) byProv.set(prov, []);
    byProv.get(prov).push(b);
  }
  const provs = [...byProv.keys()].sort((a, b) => (a === 'Provincie onbekend') - (b === 'Provincie onbekend') || a.localeCompare(b, 'nl'));
  const out = [];
  for (const prov of provs) {
    const list = byProv.get(prov).sort((a, b) => a.name.localeCompare(b.name, 'nl'));
    const id = `bruggen-${prov.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    out.push(`<section class="list-group" aria-labelledby="${id}"><h2 id="${id}">${esc(prov)} <span class="list-group__count">${list.length}</span></h2><ul class="entity-links">`);
    for (const b of list) {
      const sub = [b.road, b.water, b.woonplaats || b.gemeente].filter(Boolean).map(esc).join(' · ');
      out.push(
        `<li><a href="/brug/${esc(b.slug)}/" data-bridge-id="${esc(b.id)}"><span class="entity-links__name">${esc(b.name)}</span>${sub ? `<span class="entity-links__sub">${sub}</span>` : ''}</a></li>`,
      );
    }
    out.push('</ul></section>');
  }
  return out.join('\n');
}
