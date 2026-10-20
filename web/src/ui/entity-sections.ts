/**
 * The sections of a road or place page list when no day or moment is picked: "Nu actief",
 * "Gepland (komende 30 dagen)" and, folded, what only applies to other traffic. Shared by the page
 * script (pages/entity-page.ts) and the build, which writes the first rows into the HTML
 * (ui/entity-snapshot.ts), so the two never order or count differently. Pure, no DOM.
 */
import { orderAlongRoad } from '../data/entity';
import type { IndexItem } from '../data/index';
import { isRelevantFor, modeNotFor, type VehicleMode } from '../data/verdict';
import { rowVerdict, sortByVerdict, type EntityListOptions, type EntitySection } from './entity-list';

export interface SectionInput {
  subjectKind: 'road' | 'gemeente' | 'woonplaats' | 'gebied';
  mode: VehicleMode;
  active: readonly IndexItem[];
  upcoming: readonly IndexItem[];
  now: number;
  listOpts: EntityListOptions;
}

export function entitySections({ subjectKind, mode, active, upcoming, now, listOpts }: SectionInput): EntitySection[] {
  const relevant = (list: readonly IndexItem[]): IndexItem[] => list.filter((it) => isRelevantFor(it, mode));
  // "Nu actief" leads with the heaviest pill: by impact alone three "Doorrijden mogelijk"
  // incidents stood above the "Rijbaan dicht" at Gorinchem. On a road page the rows of one
  // level then follow the road from end to end (overzicht-4); a place has no such axis.
  // "Gepland" keeps its start order, as its heading promises.
  const nowRows =
    subjectKind === 'road'
      ? orderAlongRoad(relevant(active), (it) => rowVerdict(it, now, listOpts).level, (it) => listOpts.details?.get(it.id)?.to ?? '')
      : sortByVerdict(relevant(active), now, listOpts);
  const sections: EntitySection[] = [
    { title: 'Nu actief', items: nowRows },
    { title: 'Gepland (komende 30 dagen)', items: relevant(upcoming) },
  ];
  const hidden = active.length + upcoming.length - sections.reduce((n, s) => n + s.items.length, 0);
  if (hidden > 0) {
    const others = [...active, ...upcoming].filter((it) => !isRelevantFor(it, mode));
    sections.push({
      title: modeNotFor(mode),
      items: others,
      collapsed: true,
      note: `Deze ${hidden === 1 ? 'melding geldt' : 'meldingen gelden'} alleen voor ander verkeer (bijvoorbeeld een fietspad).`,
    });
  }
  return sections;
}
