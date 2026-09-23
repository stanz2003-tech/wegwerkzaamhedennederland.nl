/**
 * The fixture item set: 41 items that are active now, ~20 planned within 25 days, 9 live
 * records (3 files, 4 incidents, 2 bridge openings) and 5 bridges. All times are offsets in
 * milliseconds from the base timestamp (`s` start, `e` end or null = open ended,
 * `d.upd` last change), so the same table works for any `--now`.
 *
 * Coordinates are real-ish WGS84 positions inside the NL bbox [3.2, 50.5, 7.3, 53.7].
 */
import { DAY, HOUR, MIN, iso, line, multiline, nightlyPeriods, point } from './helpers.mjs';

/** Municipal works: [woonplaats, gemeente, provCode, lon, lat, street]. */
const PLACES = [
  ['Amsterdam', 'Amsterdam', 'PV27', 4.89707, 52.37403, 'Vondelstraat'],
  ['Amsterdam', 'Amsterdam', 'PV27', 4.9122, 52.3564, 'Weesperzijde'],
  ['Rotterdam', 'Rotterdam', 'PV28', 4.47917, 51.92442, 'Goudsesingel'],
  ['Rotterdam', 'Rotterdam', 'PV28', 4.4488, 51.9142, 'Vierambachtsstraat'],
  ['Utrecht', 'Utrecht', 'PV26', 5.12142, 52.09074, 'Croeselaan'],
  ['Utrecht', 'Utrecht', 'PV26', 5.1041, 52.1002, 'Amsterdamsestraatweg'],
  ['Breda', 'Breda', 'PV30', 4.77596, 51.58656, 'Asterdkraag'],
  ['Breda', 'Breda', 'PV30', 4.7621, 51.5921, 'Nieuwe Prinsenkade'],
  ['Groningen', 'Groningen', 'PV20', 6.56497, 53.21938, 'Damsterdiep'],
  ['Groningen', 'Groningen', 'PV20', 6.5502, 53.2241, 'Eendrachtskade'],
  ['Den Haag', "'s-Gravenhage", 'PV28', 4.31134, 52.07667, 'Laan van Meerdervoort'],
  ['Eindhoven', 'Eindhoven', 'PV30', 5.47778, 51.44164, 'Vestdijk'],
  ['Zwolle', 'Zwolle', 'PV23', 6.09444, 52.5125, 'Willemskade'],
  ['Maastricht', 'Maastricht', 'PV31', 5.68889, 50.85139, 'Wilhelminasingel'],
  ['Middelburg', 'Middelburg', 'PV29', 3.61389, 51.49889, 'Nieuwe Havenweg'],
  ['Almere', 'Almere', 'PV24', 5.21806, 52.37083, 'Spoordreef'],
  ['Assen', 'Assen', 'PV22', 6.56111, 52.99583, 'Overcingellaan'],
  ['Arnhem', 'Arnhem', 'PV25', 5.89873, 51.98, 'Velperbuitensingel'],
  ['Leeuwarden', 'Leeuwarden', 'PV21', 5.79861, 53.20139, 'Harlingerstraatweg'],
  ['Nijmegen', 'Nijmegen', 'PV25', 5.86389, 51.8425, 'Graafseweg'],
  ['Tilburg', 'Tilburg', 'PV30', 5.08611, 51.55551, 'Ringbaan Oost'],
  ['Haarlem', 'Haarlem', 'PV27', 4.63611, 52.38084, 'Zijlweg'],
];

const WORK_SUBS = ['maintenanceWork', 'resurfacingWork', 'installationWork', 'roadMarkingWork', 'treeAndVegetationCuttingWork'];
const WORK_LABELS = {
  maintenanceWork: 'Onderhoud aan de rijbaan',
  resurfacingWork: 'Nieuw asfalt',
  installationWork: 'Kabels en leidingen leggen',
  roadMarkingWork: 'Nieuwe wegmarkering',
  treeAndVegetationCuttingWork: 'Bomen kappen langs de weg',
};
const HINDS = ['B', 'C', 'D', 'E'];

/** Hand-written motorway / N-road items (the interesting geometry and impact cases). */
export function highwayItems() {
  return [
    {
      id: 'NDW03_2100001', cat: 'werk', sub: 'resurfacingWork', sev: 3, title: 'A2 · Vinkeveen → Holendrecht',
      road: 'A2', roadType: 'A', gemeente: 'De Ronde Venen', prov: 'PV26', src: 'Rijkswaterstaat Midden-Nederland',
      s: -4 * HOUR, e: 9 * HOUR, hind: 'B', prob: 'certain',
      g: line([[4.94063, 52.20115], [4.97158, 52.16542], [5.00214, 52.13018], [5.02891, 52.09984]]),
      d: {
        desc: 'De rechterrijstrook is afgesloten voor asfaltwerk. Houd rekening met extra reistijd.',
        detour: 'Volg de gele omleidingsborden via de N201.',
        lanes: { closed: 1, open: 2, total: 3 }, speed: 70, delay: 'upToTenMinutes', delaySec: 480,
        from: 'Vinkeveen', to: 'Holendrecht', dir: 'positive', status: 'running', works: 'resurfacingWork',
        url: 'https://melvin.ndw.nu/public/situation/NDW03_2100001',
        // Double publication: the planning object was folded into this actual measure. Its id
        // is deliberately not an item of its own — the pipeline drops the duplicate.
        related: ['RWS01_SM1013188_D2'], upd: -35 * MIN,
      },
    },
    {
      id: 'NDW03_2100002', cat: 'afsluiting', sub: 'carriagewayClosures', sev: 4, title: 'A2 · rijbaan dicht bij Den Bosch',
      road: 'A2', roadType: 'A', gemeente: "'s-Hertogenbosch", woonplaats: "'s-Hertogenbosch", prov: 'PV30',
      src: 'Rijkswaterstaat Zuid-Nederland', s: -90 * MIN, e: 14 * HOUR, closed: true, hind: 'A', prob: 'certain',
      g: multiline([
        [[5.31402, 51.66218], [5.35081, 51.61234], [5.39012, 51.56087]],
        [[5.39012, 51.55987], [5.35081, 51.61134], [5.31402, 51.66118]],
      ]),
      d: {
        desc: 'Beide rijbanen zijn dicht tussen knooppunt Hintham en Vught. Het verkeer wordt omgeleid.',
        detour: 'Omleiding via de A59 en de N65.', lanes: { closed: 3, total: 3 },
        // Signed detour route (contract v3 `detourGeom`): a simplified polyline of at most 12 points.
        detourGeom: [[5.31402, 51.66218], [5.29014, 51.67812], [5.26212, 51.66014], [5.24418, 51.62212], [5.27016, 51.58414], [5.33212, 51.55216], [5.39012, 51.56087]],
        delay: 'betweenThirtyMinutesAndOneHour', delaySec: 2400, from: 'Hintham', to: 'Vught', dir: 'both',
        status: 'running', works: 'maintenanceWork', upd: -20 * MIN,
      },
    },
    {
      id: 'NDW03_2100003', cat: 'werk', sub: 'laneClosures', sev: 2, title: 'A12 · Zoetermeer → Gouda',
      road: 'A12', roadType: 'A', gemeente: 'Zoetermeer', woonplaats: 'Zoetermeer', prov: 'PV28',
      src: 'Rijkswaterstaat West-Nederland Zuid', s: -6 * DAY, e: 12 * DAY, hind: 'C', prob: 'certain',
      g: line([[4.51092, 52.05781], [4.60318, 52.04213], [4.69874, 52.02651], [4.78201, 52.01187]]),
      d: {
        desc: 'Er is één rijstrook minder beschikbaar tot en met de werkzaamheden aan het viaduct klaar zijn.',
        lanes: { closed: 1, open: 3, total: 4 }, speed: 90, delay: 'upToTenMinutes',
        from: 'Zoetermeer', to: 'Gouda', dir: 'positive', status: 'running', works: 'constructionWork', upd: -3 * DAY,
      },
    },
    {
      id: 'NDW03_2100004', cat: 'werk', sub: 'narrowLanes', sev: 2, title: 'A12 · versmalde rijstroken bij Duiven',
      road: 'A12', roadType: 'A', gemeente: 'Duiven', woonplaats: 'Duiven', prov: 'PV25',
      src: 'Rijkswaterstaat Oost-Nederland', s: -2 * DAY, e: 20 * DAY, hind: 'D', prob: 'certain', veh: ['lorry'],
      g: multiline([
        [[5.94012, 51.96214], [6.01238, 51.95012], [6.08512, 51.94318]],
        [[6.08512, 51.94218], [6.01238, 51.94912], [5.94012, 51.96114]],
      ]),
      d: {
        desc: 'De rijstroken zijn versmald in beide richtingen. Vrachtverkeer kan er niet inhalen.',
        speed: 90, dir: 'both', vehicles: ['lorry'], status: 'running', works: 'maintenanceWork', upd: -26 * HOUR,
      },
    },
    {
      id: 'NDW03_2100005', cat: 'werk', sub: 'laneClosures', sev: 3, title: 'A27 · Lunetten → Utrecht-Noord',
      road: 'A27', roadType: 'A', gemeente: 'Utrecht', woonplaats: 'Utrecht', prov: 'PV26',
      src: 'Rijkswaterstaat Midden-Nederland', s: -50 * MIN, e: 6 * HOUR, hind: 'B', prob: 'certain',
      g: line([[5.13214, 52.05412], [5.14018, 52.09231], [5.15102, 52.12874]]),
      d: {
        desc: 'Werk aan de geluidsschermen: de linkerrijstrook is dicht.', lanes: { closed: 1, open: 2, total: 3 },
        speed: 70, delay: 'betweenTenMinutesAndThirtyMinutes', delaySec: 900, from: 'Lunetten', to: 'Utrecht-Noord',
        dir: 'positive', status: 'running', works: 'maintenanceWork', upd: -12 * MIN,
      },
    },
    {
      id: 'NDW03_2100006', cat: 'werk', sub: 'speedRestrictionInOperation', sev: 1, title: 'A27 · snelheidsbeperking bij Oosterhout',
      road: 'A27', roadType: 'A', gemeente: 'Oosterhout', woonplaats: 'Oosterhout', prov: 'PV30',
      src: 'Rijkswaterstaat Zuid-Nederland', s: -11 * HOUR, e: 4 * DAY, hind: 'D', prob: 'certain',
      g: line([[4.83012, 51.63218], [4.86214, 51.68012], [4.89312, 51.72514]]),
      d: { desc: 'Tijdelijk 70 km/u vanwege werk aan de vluchtstrook.', speed: 70, dir: 'both', status: 'running', works: 'roadsideWork', upd: -5 * HOUR },
    },
    {
      id: 'NDW03_2100007', cat: 'werk', sub: 'maintenanceWork', sev: 2, title: 'A7 · Afsluitdijk',
      road: 'A7', roadType: 'A', gemeente: 'Súdwest-Fryslân', prov: 'PV21', src: 'Rijkswaterstaat Noord-Nederland',
      s: -20 * DAY, e: 60 * DAY, hind: 'C', prob: 'certain',
      g: line([[5.03214, 52.92814], [5.14012, 52.98218], [5.25314, 53.03012], [5.34112, 53.06214]]),
      d: {
        desc: 'Langdurig werk aan de Afsluitdijk. Eén rijstrook per richting beschikbaar.',
        lanes: { closed: 1, open: 1, total: 2 }, speed: 80, from: 'Den Oever', to: 'Kornwerderzand', dir: 'both',
        status: 'running', works: 'constructionWork', url: 'https://melvin.ndw.nu/public/situation/NDW03_2100007',
        // Two planning situations merged into one measure (the plural wording in the detail view).
        related: ['NDW03_2100901', 'RWS01_SM1052757_D2'], upd: -2 * DAY,
      },
    },
    {
      id: 'NDW03_2100008', cat: 'afsluiting', sub: 'roadClosed', sev: 4, title: 'A7 · afrit dicht bij Groningen',
      road: 'A7', roadType: 'A', gemeente: 'Groningen', woonplaats: 'Groningen', prov: 'PV20',
      src: 'Rijkswaterstaat Noord-Nederland', s: -30 * MIN, e: 11 * HOUR, closed: true, hind: 'B', prob: 'certain',
      g: line([[6.48214, 53.19812], [6.55012, 53.21014], [6.61312, 53.22218]]),
      d: {
        desc: 'De afrit Groningen-Zuid is afgesloten. Volg de omleiding.', detour: 'Volg omleidingsroute U via de N7.',
        lanes: { closed: 2, total: 2 }, dir: 'negative', status: 'running', works: 'maintenanceWork', upd: -30 * MIN,
      },
    },
    {
      id: 'NDW03_2100009', cat: 'werk', sub: 'laneClosures', sev: 2, title: 'N57 · Serooskerke',
      road: 'N57', roadType: 'N', gemeente: 'Veere', woonplaats: 'Serooskerke', prov: 'PV29',
      src: 'Provincie Zeeland', s: -3 * HOUR, e: 3 * DAY, hind: 'C', prob: 'probable',
      g: line([[3.71214, 51.72012], [3.74012, 51.78214]]),
      d: { desc: 'Groot onderhoud aan het wegdek van de N57.', lanes: { closed: 1, open: 1, total: 2 }, speed: 50, dir: 'both', status: 'running', works: 'resurfacingWork', upd: -8 * HOUR },
    },
    {
      id: 'NDW03_2100010', cat: 'werk', sub: 'laneClosures', sev: 2, title: 's100 · Amsterdam Nassaukade',
      road: 's100', roadType: 'S', gemeente: 'Amsterdam', woonplaats: 'Amsterdam', prov: 'PV27',
      src: 'Gemeente Amsterdam', s: -7 * HOUR, e: 26 * DAY, hind: 'C', prob: 'probable',
      g: line([[4.8781, 52.37012], [4.87412, 52.36514], [4.87102, 52.36012]]),
      d: { desc: 'De kade wordt vernieuwd. Er is één rijstrook beschikbaar.', lanes: { closed: 1, open: 1, total: 2 }, speed: 30, dir: 'both', status: 'running', works: 'constructionWork', upd: -4 * DAY },
    },
    {
      id: 'NDW03_2100011', cat: 'evenement', sub: 'bicycleRace', sev: 2, title: 'Ronde van Midden-Zeeland',
      road: 'N287', roadType: 'N', gemeente: 'Middelburg', woonplaats: 'Middelburg', prov: 'PV29',
      src: 'Gemeente Middelburg', s: -2 * HOUR, e: 5 * HOUR, closed: true, hind: 'B', prob: 'certain',
      g: line([[3.60214, 51.50012], [3.63014, 51.49214], [3.65814, 51.48512]]),
      d: { desc: 'Wielerronde door het centrum. De weg is dicht voor doorgaand verkeer.', detour: 'Volg de borden rond het centrum.', dir: 'both', status: 'running', works: 'bicycleRace', upd: -3 * DAY },
    },
    {
      id: 'AND01_2100012', cat: 'overig', sub: 'hardShoulderRunningInOperation', sev: 0, title: 'A10 · spitsstrook open bij Amsterdam-Zuid',
      road: 'A10', roadType: 'A', gemeente: 'Amsterdam', woonplaats: 'Amsterdam', prov: 'PV27',
      src: 'Rijkswaterstaat West-Nederland Noord', s: -40 * MIN, e: 2 * HOUR, prob: 'certain',
      g: line([[4.86012, 52.33814], [4.89214, 52.33512], [4.92314, 52.33218]]),
      d: { desc: 'De spitsstrook is open om het verkeer beter door te laten stromen.', dir: 'positive', status: 'running', upd: -40 * MIN },
    },
    {
      id: 'AND01_2100013', cat: 'werk', sub: 'installationWork', sev: 1, title: 'Warmtenet Kanaleneiland',
      roadType: 'lokaal', gemeente: 'Utrecht', woonplaats: 'Utrecht', prov: 'PV26', src: 'Gemeente Utrecht',
      s: -12 * DAY, e: 40 * DAY, hind: 'D', prob: 'probable', veh: ['bicycle'], g: point(5.10214, 52.06814),
      d: { desc: 'Aanleg van het warmtenet. De straat is per fase deels open.', vehicles: ['bicycle', 'pedestrian'], status: 'running', works: 'installationWork', upd: -6 * DAY },
    },
    {
      id: 'AND01_2100014', cat: 'afsluiting', sub: 'roadClosed', sev: 3, title: 'Coolsingel dicht voor herinrichting',
      roadType: 'lokaal', gemeente: 'Rotterdam', woonplaats: 'Rotterdam', prov: 'PV28', src: 'Gemeente Rotterdam',
      s: -60 * MIN, e: 8 * DAY, closed: true, hind: 'B', prob: 'certain', g: point(4.47712, 51.92214),
      d: { desc: 'De Coolsingel is afgesloten voor doorgaand verkeer.', detour: 'Volg de omleiding via de Blaak.', dir: 'both', status: 'running', works: 'constructionWork', upd: -90 * MIN },
    },
    {
      id: 'AND01_2100015', cat: 'werk', sub: 'maintenanceWork', sev: 1, title: 'Herstel wegdek buiten de bebouwde kom',
      roadType: 'lokaal', prov: null, src: 'Onbekende wegbeheerder', s: -5 * HOUR, e: 30 * HOUR, hind: 'E', prob: 'probable',
      g: point(6.02214, 52.72014),
      d: { desc: 'Kleine reparatie aan het wegdek.', status: 'published', works: 'repairWork', upd: -5 * HOUR },
    },
    {
      id: 'AND01_2100016', cat: 'afsluiting', sub: 'roadClosed', sev: 2, title: 'Fietspad Vechtdijk dicht',
      roadType: 'lokaal', gemeente: 'Utrecht', woonplaats: 'Utrecht', prov: 'PV26', src: 'Gemeente Utrecht',
      s: -3 * DAY, e: 11 * DAY, closed: true, hind: 'C', prob: 'certain', veh: ['bicycle', 'moped'],
      g: line([[5.10912, 52.11214], [5.11412, 52.11814], [5.11912, 52.12314]]),
      d: {
        desc: 'Het fietspad langs de Vecht is dicht voor herstel van de oever. Autoverkeer kan gewoon door.',
        detour: 'Fietsers volgen de borden via het Zandpad.', vehicles: ['bicycle', 'moped'], dir: 'both',
        status: 'running', works: 'maintenanceWork', upd: -2 * DAY,
      },
    },
  ];
}

/** Municipal point works, one per PLACES entry (deterministic rotation of sub/sev/hind). */
function municipalItems({ count, offset, idPrefix, idBase, startFn }) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const place = PLACES[(offset + i) % PLACES.length];
    const [woonplaats, gemeente, pv, lon, lat, street] = place;
    const sub = WORK_SUBS[(offset + i) % WORK_SUBS.length];
    const times = startFn(i);
    out.push({
      id: `${idPrefix}${idBase + i}`, cat: 'werk', sub, sev: [1, 2, 2, 1, 0][(offset + i) % 5], title: `${street}, ${woonplaats}`,
      roadType: 'lokaal', gemeente, woonplaats, prov: pv, src: `Gemeente ${gemeente}`,
      s: times.s, e: times.e, hind: HINDS[(offset + i) % HINDS.length], prob: i % 3 === 0 ? 'certain' : 'probable',
      g: point(lon + ((i % 5) - 2) * 0.0031, lat + ((i % 4) - 2) * 0.0024),
      d: {
        desc: `${WORK_LABELS[sub]} in de ${street}. Het verkeer wordt ter plaatse omgeleid.`,
        status: times.s <= 0 ? 'running' : 'published', works: sub, upd: times.upd,
        ...(i % 4 === 0 ? { detour: 'Volg de omleidingsborden in de wijk.' } : {}),
        ...(i % 3 === 0 ? { lanes: { closed: 1, open: 1, total: 2 } } : {}),
      },
    });
  }
  return out;
}

export function activeItems() {
  return [
    ...highwayItems(),
    ...municipalItems({
      count: 25, offset: 0, idPrefix: 'AND01_', idBase: 2100100,
      startFn: (i) => ({ s: -((i + 1) * 7 * HOUR), e: (i + 2) * 9 * HOUR, upd: -((i + 1) * 3 * HOUR) }),
    }),
  ];
}

export function plannedItems(nowMs) {
  const items = municipalItems({
    count: 17, offset: 7, idPrefix: 'NDW03_', idBase: 2200100,
    startFn: (i) => ({ s: (i + 1) * 33 * HOUR, e: (i + 1) * 33 * HOUR + 3 * DAY, upd: -((i + 1) * HOUR) }),
  });
  const nightlyStart = nowMs + 3 * DAY;
  items.push(
    {
      id: 'NDW03_2200001', cat: 'werk', sub: 'resurfacingWork', sev: 3, title: 'A12 · nachtwerk tussen Bunnik en Driebergen',
      road: 'A12', roadType: 'A', gemeente: 'Bunnik', woonplaats: 'Bunnik', prov: 'PV26',
      src: 'Rijkswaterstaat Midden-Nederland', s: 3 * DAY + 7 * HOUR, e: 13 * DAY, hind: 'B', prob: 'certain',
      // Every lane is closed during the nightly periods: the road is dicht, not merely hindered.
      imp: 'dicht',
      g: line([[5.19214, 52.05812], [5.24012, 52.05214], [5.28814, 52.04612]]),
      d: {
        desc: 'Tien nachten achter elkaar nieuw asfalt. Elke nacht van 21:00 tot 05:00 is de weg dicht.',
        detour: 'Omleiding via de N225 en de N227.', periods: nightlyPeriods(nightlyStart, 10, 21, 5),
        lanes: { closed: 2, total: 2 }, dir: 'positive', from: 'Bunnik', to: 'Driebergen', status: 'published',
        works: 'resurfacingWork', url: 'https://melvin.ndw.nu/public/situation/NDW03_2200001', upd: -18 * HOUR,
      },
    },
    {
      id: 'NDW03_2200002', cat: 'afsluiting', sub: 'roadClosed', sev: 4, title: 'A9 · weekendafsluiting bij Badhoevedorp',
      road: 'A9', roadType: 'A', gemeente: 'Haarlemmermeer', woonplaats: 'Badhoevedorp', prov: 'PV27',
      src: 'Rijkswaterstaat West-Nederland Noord', s: 2 * DAY + 8 * HOUR, e: 4 * DAY + 4 * HOUR, closed: true,
      hind: 'A', prob: 'certain',
      g: line([[4.74214, 52.33812], [4.78012, 52.32914], [4.81814, 52.32012]]),
      d: {
        desc: 'Van vrijdagavond tot maandagochtend is de A9 dicht in beide richtingen.',
        detour: 'Omleiding via de A4 en de A5.', lanes: { closed: 4, total: 4 }, dir: 'both',
        delay: 'betweenThirtyMinutesAndOneHour', status: 'published', works: 'constructionWork', upd: -2 * DAY,
      },
    },
    {
      id: 'NDW03_2200003', cat: 'evenement', sub: 'marathon', sev: 2, title: 'Marathon Eindhoven',
      roadType: 'lokaal', gemeente: 'Eindhoven', woonplaats: 'Eindhoven', prov: 'PV30', src: 'Gemeente Eindhoven',
      s: 9 * DAY + 5 * HOUR, e: 9 * DAY + 13 * HOUR, closed: true, hind: 'B', prob: 'certain',
      g: point(5.47512, 51.44014),
      d: {
        desc: 'Het parcours loopt door de binnenstad. Veel straten zijn een deel van de dag dicht.', detour: 'Volg de omleiding rond de ring.', dir: 'both', status: 'published', works: 'marathon', upd: -5 * DAY,
        // Contract v4: the opbouw hinders, the race itself closes the streets.
        tl: [
          [iso(nowMs + 9 * DAY + 5 * HOUR), iso(nowMs + 9 * DAY + 8 * HOUR), 'hinder'],
          [iso(nowMs + 9 * DAY + 8 * HOUR), iso(nowMs + 9 * DAY + 13 * HOUR), 'dicht'],
        ],
      },
    },
  );
  return items;
}

export function liveItems() {
  return [
    {
      id: 'NLRWS_0005415104', cat: 'file', sub: 'stationaryTraffic', sev: 2, title: 'A27 · Lunetten → Utrecht-Noord',
      road: 'A27', roadType: 'A', prov: 'PV26', src: 'Rijkswaterstaat / NDW', s: -19 * MIN, e: null, prob: 'certain',
      g: line([[5.13314, 52.06012], [5.14114, 52.09814], [5.14914, 52.11912]]),
      d: { queueM: 4200, delay: 'betweenTenMinutesAndThirtyMinutes', delaySec: 1140, from: 'Lunetten', to: 'Utrecht-Noord', dir: 'positive', status: 'active', upd: -4 * MIN },
    },
    {
      id: 'NLRWS_0005415110', cat: 'file', sub: 'slowTraffic', sev: 1, title: 'A28 · vanuit Amersfoort',
      road: 'A28', roadType: 'A', prov: 'PV26', src: 'Rijkswaterstaat / NDW', s: -32 * MIN, e: null, prob: 'certain',
      g: line([[5.34214, 52.13012], [5.30014, 52.11214], [5.26014, 52.09512], [5.22014, 52.08012]]),
      d: { queueM: 1800, delay: 'upToTenMinutes', delaySec: 420, from: 'Amersfoort', to: 'Utrecht-Noord', dir: 'negative', status: 'active', upd: -3 * MIN },
    },
    {
      id: 'NLRWS_0005415133', cat: 'file', sub: 'stationaryTraffic', sev: 3, title: 'A16 · richting Rotterdam',
      road: 'A16', roadType: 'A', prov: 'PV28', src: 'Rijkswaterstaat / NDW', s: -47 * MIN, e: null, prob: 'certain',
      g: line([[4.53214, 51.82012], [4.51014, 51.85214], [4.49014, 51.88512], [4.47514, 51.91012]]),
      d: { queueM: 11500, delay: 'betweenThirtyMinutesAndOneHour', delaySec: 2760, from: 'Zevenbergschen Hoek', to: 'Rotterdam-Centrum', dir: 'positive', status: 'active', upd: -2 * MIN },
    },
    {
      id: 'NDW06_2300001', cat: 'incident', sub: 'accident', sev: 3, title: 'A67 · ongeval bij Geldrop',
      road: 'A67', roadType: 'A', gemeente: 'Geldrop-Mierlo', woonplaats: 'Geldrop', prov: 'PV30',
      src: 'Rijkswaterstaat / NDW', s: -23 * MIN, e: null, prob: 'certain', g: point(5.644, 51.42329),
      d: { desc: 'Ongeval op de rechterrijstrook. Hulpdiensten zijn ter plaatse.', lanes: { closed: 1, open: 1, total: 2 }, delay: 'upToTenMinutes', delaySec: 540, dir: 'positive', status: 'active', upd: -6 * MIN },
    },
    {
      id: 'NDW06_2300002', cat: 'incident', sub: 'brokenDownVehicle', sev: 1, title: 'A1 · pechgeval bij Deventer',
      road: 'A1', roadType: 'A', gemeente: 'Deventer', woonplaats: 'Deventer', prov: 'PV23',
      src: 'Rijkswaterstaat / NDW', s: -8 * MIN, e: null, prob: 'certain', g: point(6.14214, 52.24512),
      d: { desc: 'Voertuig met pech op de vluchtstrook.', dir: 'negative', status: 'active', upd: -8 * MIN },
    },
    {
      id: 'NDW06_2300003', cat: 'incident', sub: 'generalObstruction', sev: 2, title: 'N50 · obstakel op de weg bij Kampen',
      road: 'N50', roadType: 'N', gemeente: 'Kampen', woonplaats: 'Kampen', prov: 'PV23',
      src: 'Rijkswaterstaat / NDW', s: -14 * MIN, e: null, prob: 'certain', g: point(5.92014, 52.55012),
      d: { desc: 'Lading verloren op de rijbaan.', lanes: { closed: 1, total: 2 }, dir: 'positive', status: 'active', upd: -5 * MIN },
    },
    {
      id: 'NDW06_2300004', cat: 'incident', sub: 'vehicleObstruction', sev: 2, title: 'A20 · voertuig op de weg bij Schiedam',
      road: 'A20', roadType: 'A', gemeente: 'Schiedam', woonplaats: 'Schiedam', prov: 'PV28',
      src: 'Rijkswaterstaat / NDW', s: -11 * MIN, e: null, prob: 'certain', g: point(4.40214, 51.92312),
      d: { desc: 'Stilstaand voertuig op de linkerrijstrook.', lanes: { closed: 1, open: 2, total: 3 }, delay: 'upToTenMinutes', dir: 'negative', status: 'active', upd: -7 * MIN },
    },
    {
      id: 'BMS01_NLCRU002020472000143_569427145', cat: 'brug', sub: 'bridgeSwingInOperation', sev: 2, title: 'N201 · Cruquiusbrug',
      road: 'N201', roadType: 'N', gemeente: 'Haarlemmermeer', woonplaats: 'Cruquius', prov: 'PV27',
      src: 'Rijkswaterstaat / NDW', s: -5 * MIN, e: 4 * MIN, prob: 'certain', g: point(4.63686, 52.33835),
      d: { desc: 'De brug is open voor de scheepvaart.', dir: 'both', status: 'active', upd: -5 * MIN },
    },
    {
      id: 'BMS01_NLALK002340557700383_569427211', cat: 'brug', sub: 'bridgeSwingInOperation', sev: 2, title: 'N242 · Leeghwaterbrug',
      road: 'N242', roadType: 'N', gemeente: 'Alkmaar', woonplaats: 'Alkmaar', prov: 'PV27',
      src: 'Rijkswaterstaat / NDW', s: -2 * MIN, e: 5 * MIN, prob: 'certain', g: point(4.76806, 52.61654),
      d: { desc: 'De brug is open voor de scheepvaart.', dir: 'both', status: 'active', upd: -2 * MIN },
    },
  ];
}


/** The five bridges of bruggen.json; the first two are the ones open right now. */
export function bridges(nowMs) {
  const openings = (offsets) => offsets.map(([a, b]) => [iso(nowMs + a), iso(nowMs + b)]);
  return [
    {
      id: 'NLCRU002020472000143', slug: 'cruquiusbrug', name: 'Cruquiusbrug', road: 'N201', water: 'Ringvaart Haarlemmermeerpolder',
      gemeente: 'Haarlemmermeer', woonplaats: 'Cruquius', prov: 'Noord-Holland', lon: 4.63686, lat: 52.33835, openNow: true,
      openings: openings([[-5 * MIN, 4 * MIN], [3 * HOUR, 3 * HOUR + 7 * MIN], [27 * HOUR, 27 * HOUR + 6 * MIN], [3 * DAY, 3 * DAY + 8 * MIN]]),
    },
    {
      id: 'NLALK002340557700383', slug: 'leeghwaterbrug', name: 'Leeghwaterbrug', road: 'N242', water: 'Noordhollandsch Kanaal',
      gemeente: 'Alkmaar', woonplaats: 'Alkmaar', prov: 'Noord-Holland', lon: 4.76806, lat: 52.61654, openNow: true,
      openings: openings([[-2 * MIN, 5 * MIN], [95 * MIN, 101 * MIN], [19 * HOUR, 19 * HOUR + 6 * MIN], [5 * DAY, 5 * DAY + 6 * MIN]]),
    },
    {
      id: 'NLUTR002450112300071', slug: 'muntbrug', name: 'Muntbrug', road: 'N230', water: 'Merwedekanaal',
      gemeente: 'Utrecht', woonplaats: 'Utrecht', prov: 'Utrecht', lon: 5.09214, lat: 52.09512, openNow: false,
      openings: openings([[4 * HOUR, 4 * HOUR + 9 * MIN], [2 * DAY + 6 * HOUR, 2 * DAY + 6 * HOUR + 7 * MIN]]),
    },
    {
      id: 'NLROT002110334500912', slug: 'spijkenisserbrug', name: 'Spijkenisserbrug', road: 'N218', water: 'Oude Maas',
      gemeente: 'Nissewaard', woonplaats: 'Spijkenisse', prov: 'Zuid-Holland', lon: 4.32914, lat: 51.85214, openNow: false,
      openings: openings([[31 * HOUR, 31 * HOUR + 12 * MIN], [6 * DAY + 2 * HOUR, 6 * DAY + 2 * HOUR + 11 * MIN]]),
    },
    {
      id: 'NLLWD002210447700205', slug: 'brug-in-de-n359-bij-bolsward', name: 'Brug in de N359 bij Bolsward', road: 'N359',
      gemeente: 'Súdwest-Fryslân', woonplaats: 'Bolsward', prov: 'Friesland', lon: 5.53012, lat: 53.06214, openNow: false,
      openings: [],
    },
  ];
}

