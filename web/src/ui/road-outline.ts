/**
 * Road mode's soft band on the map (map/road-outline.ts): follows `?weg=`, loads the course of
 * that road once (data/road-line.ts) and hands it to the map — also when the map only exists after
 * road mode was entered (a deep link while the basemap loads). A road left before its file arrived
 * never gets drawn afterwards.
 */
import { loadRoadLine, type RoadLineCoords } from '../data/road-line';
import type { AppMap } from '../map/map';

export interface RoadOutline {
  /** The road of road mode now (null outside it). Cheap to call on every render. */
  show(road: string | null): void;
  /** Re-applies the current line, for a map created after `show`. */
  apply(): void;
}

export function createRoadOutline(map: () => AppMap | null): RoadOutline {
  let road: string | null = null;
  let lines: RoadLineCoords | null = null;
  return {
    show(next) {
      if (next === road) return;
      road = next;
      lines = null;
      map()?.setRoadOutline(null);
      if (!next) return;
      void loadRoadLine(next).then((loaded) => {
        if (road !== next) return;
        lines = loaded;
        map()?.setRoadOutline(loaded);
      });
    },
    apply() {
      map()?.setRoadOutline(lines);
    },
  };
}
