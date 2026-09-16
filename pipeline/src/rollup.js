/**
 * Raises the verdict of a situation to that of the situations it declares itself related to.
 *
 * Rijkswaterstaat publishes one night closure as a family: a parent situation that carries the
 * description ("groot onderhoud A6 HRR Emmeloord-Lemmer, De A6 is dicht") and the detour, plus one
 * child situation per closed section that carries the actual `roadClosed` / `carriagewayClosures`
 * record. Because `impactOf()` looks at one situation at a time, the parent — the one whose title
 * the visitor reads — came out as `hinder`: "doorrijden mogelijk" printed directly above a sentence
 * saying the road is shut. Measured on the planning feed of 16 September 2026: 277 situations say
 * "is dicht" in their own text, 245 of them carry no closure record at all, and 130 of those point
 * at a relative that does.
 *
 * Rules, in order of how much they matter:
 *   - only ever raise, never lower. A child that happens to be a lane closure must not soften a
 *     parent that really is shut;
 *   - read every verdict from a snapshot taken before the pass, so the result does not depend on
 *     the order of the list. The output files are compared byte for byte to decide what to upload,
 *     so a non-deterministic pass would churn thousands of objects per run;
 *   - carry the winning relative's vehicle restriction along. A closure that only bans lorries must
 *     not turn the parent into a full closure, and an unrestricted closure must clear a restriction
 *     the parent inherited from something narrower.
 *
 * `rel` is symmetric in the feed, so children point back at the parent. That is harmless: a child
 * already holds the strongest verdict of the family, so the snapshot rule leaves it untouched.
 */

/** Precedence, strongest first — the same order `impactOf()` documents. */
const IMPACT_ORDER = ['dicht', 'rijbaan', 'hinder', 'geen', 'onbekend'];

/** Lower is stronger; an unknown value sorts last so it never wins. */
function rank(imp) {
  const i = IMPACT_ORDER.indexOf(imp ?? '');
  return i < 0 ? IMPACT_ORDER.length : i;
}

/**
 * @typedef {object} RollupItem
 * @property {string} id
 * @property {string[]=} rel
 * @property {{ imp?: string, veh?: string[] }} props
 */

/**
 * @param {RollupItem[]} items   finalized items (props.imp already set)
 * @returns {{ raised: number, byImpact: Record<string, number> }}
 */
export function rollUpRelatedImpact(items) {
  const byId = new Map();
  for (const item of items) byId.set(item.id, item);

  // Snapshot before mutating: see the determinism rule above.
  const before = new Map();
  for (const item of items) before.set(item.id, { imp: item.props.imp, veh: item.props.veh });

  let raised = 0;
  /** @type {Record<string, number>} */
  const byImpact = {};

  for (const item of items) {
    const rel = item.rel;
    if (!rel || rel.length === 0) continue;

    let best = before.get(item.id) ?? { imp: item.props.imp, veh: item.props.veh };
    let changed = false;
    for (const id of rel) {
      const other = byId.get(id);
      if (!other) continue;
      const snapshot = before.get(id);
      if (!snapshot) continue;
      if (rank(snapshot.imp) < rank(best.imp)) {
        best = snapshot;
        changed = true;
      }
    }
    if (!changed) continue;

    item.props.imp = best.imp;
    if (best.veh) item.props.veh = [...best.veh];
    else delete item.props.veh;
    raised += 1;
    byImpact[best.imp] = (byImpact[best.imp] ?? 0) + 1;
  }

  return { raised, byImpact };
}
