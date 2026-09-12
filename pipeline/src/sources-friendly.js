/**
 * Publisher names as printed by NDW → short display name plus the gemeente /
 * provincie hints they carry ("Gemeente Breda", "Provincie Utrecht",
 * "MN-Z [RWS Midden-Nederland District Zuid]", "NLRWS", "BMS01" …).
 */

/** Province codes as used by PDOK/CBS — identical to PROVINCES in web/src/data/types.ts. */
export const PROVINCES = Object.freeze({
  PV20: 'Groningen',
  PV21: 'Friesland',
  PV22: 'Drenthe',
  PV23: 'Overijssel',
  PV24: 'Flevoland',
  PV25: 'Gelderland',
  PV26: 'Utrecht',
  PV27: 'Noord-Holland',
  PV28: 'Zuid-Holland',
  PV29: 'Zeeland',
  PV30: 'Noord-Brabant',
  PV31: 'Limburg',
});

const PROVINCE_BY_KEY = new Map(Object.entries(PROVINCES).map(([code, name]) => [provKey(name), { code, name }]));
PROVINCE_BY_KEY.set('fryslan', { code: 'PV21', name: 'Friesland' });

const RWS_NDW_SYSTEMS = /^(NLRWS|NDW\w*|RoadSafetyServices|MOS\d*|BMS\d*|TSN\d*|WGR\d*|NDWNL|RWS\d*)$/i;
const MAX_SRC = 60;

/** @param {string} name */
function provKey(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * Canonical province name + code for a published spelling, or undefined.
 * @param {string | undefined} name
 * @returns {{ code: string, name: string } | undefined}
 */
export function normalizeProvince(name) {
  if (!name) return undefined;
  return PROVINCE_BY_KEY.get(provKey(name));
}

/** @param {string | undefined} code */
export function provinceName(code) {
  return code ? PROVINCES[code] : undefined;
}

/**
 * @param {string | undefined} name  sourceName as published
 * @returns {{ src: string, gemeente?: string, prov?: string, provCode?: string }}
 */
export function friendlySource(name) {
  const trimmed = (name ?? '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return { src: 'Onbekend' };

  const gemeente = trimmed.match(/^Gemeente\s+(.+)$/i);
  if (gemeente) return { src: `Gemeente ${gemeente[1]}`, gemeente: gemeente[1] };

  const provincie = trimmed.match(/^Provincie\s+(.+)$/i);
  if (provincie) {
    const prov = normalizeProvince(provincie[1]);
    return prov
      ? { src: `Provincie ${prov.name}`, prov: prov.name, provCode: prov.code }
      : { src: `Provincie ${provincie[1]}` };
  }

  if (/\[RWS\b/.test(trimmed) || /^RWS\s/.test(trimmed) || /Rijkswaterstaat/i.test(trimmed)) {
    return { src: 'Rijkswaterstaat' };
  }
  if (RWS_NDW_SYSTEMS.test(trimmed)) return { src: 'Rijkswaterstaat / NDW' };

  return { src: trimmed.length > MAX_SRC ? trimmed.slice(0, MAX_SRC - 1).trimEnd() + '…' : trimmed };
}
