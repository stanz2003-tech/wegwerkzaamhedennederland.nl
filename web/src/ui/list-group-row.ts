/**
 * Markup of one group from ui/list-group.ts, shared by the map panel list (ui/list.ts) and the
 * lists of the generated pages (ui/entity-list.ts). A single row is just the row. A group is the
 * lead row — its worst pill, with the dates of the series or "3 delen van deze straat" — plus a
 * native <details> that lists every member as its own row, each with its own pill and link: the
 * group shortens the list, it never hides a melding.
 */
import { esc } from './format';
import { groupToggleLabel, partsNote, seriesWhen, type ListGroup } from './list-group';
import type { ListItemOptions } from './list-item';

/** The span fields a group row reads from its members. */
export interface Span {
  start: string;
  end: string | null;
  road: string | null;
}

/**
 * @param row  Renders one member with extra list-item options (the caller adds href/mode/…).
 */
export function renderGroupHtml<T extends Span>(group: ListGroup<T>, row: (member: T, extra: Partial<ListItemOptions>) => string): string {
  if (group.kind === 'single' || group.members.length < 2) return row(group.lead, {});
  const n = group.members.length;
  const extra: Partial<ListItemOptions> =
    group.kind === 'series' ? { whenText: seriesWhen(group.members) } : { note: partsNote(n, group.lead.road !== null) };
  const label = groupToggleLabel(group, (m) => m);
  const members = group.members.map((m) => row(m, { index: 99 })).join('');
  return `<div class="item-group" data-group="${group.kind}">
    ${row(group.lead, extra)}
    <details class="item-group__more">
      <summary class="item-group__toggle">${esc(label)}</summary>
      <div class="item-group__members">${members}</div>
    </details>
  </div>`;
}
