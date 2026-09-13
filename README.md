# Wegwerkzaamheden Nederland

Alle wegwerkzaamheden, afsluitingen, evenementen, brugopeningen, files en incidenten van
Nederland op één kaart — automatisch bijgewerkt uit de open data van het Nationaal Dataportaal
Wegverkeer (NDW). Geen server, geen database, niets om te onderhouden. Dit document legt uit hoe
het werkt, wat het kost, wat je één keer moet instellen en wat je doet als er iets misgaat.

> Achtergrond en alle geverifieerde cijfers: `docs/onderzoek.md` · Stap-voor-stap met de exacte
> klikpaden: `docs/handleiding.md` · Techniek: `docs/spec.md`, `docs/build-contracts.md`, `infra/README.md`.

## Hoe het werkt

```
NDW open data (opendata.ndw.nu) — elke minuut / elk kwartier nieuwe XML-bestanden
        │
        ▼  elke 5 minuten — GitHub Actions (gratis voor een publieke repository)
Pipeline: downloadt de feeds, zet de XML om in compacte kaartbestanden (GeoJSON/JSON) en
controleert de uitkomst. Te weinig data? Dan wordt er níet gepubliceerd en blijft de laatste
goede versie staan.
        │
        ▼  alleen de gewijzigde bestanden
Cloudflare R2 (opslag, gratis) → https://data.<domein>/v1/…  (met Cloudflare-cache van 1–5 min)
        │                                   ↘ na elke geslaagde run een "ik leef nog"-ping naar healthchecks.io
        ▼
Website op Cloudflare Pages (gratis): de kaart plus tekstpagina's per weg, plaats, gemeente en brug
        │
        ▼
Bezoeker ziet "Bijgewerkt HH:MM"; is de data ouder dan 45 minuten, dan verschijnt een waarschuwingsbalk
```

Drie onderdelen, allemaal in deze map:

- `pipeline/` — de omzetter (Node.js). Draait in GitHub Actions volgens `.github/workflows/data.yml`.
- `web/` — de website: kaart, pagina's, teksten (`web/content/*.md`) en instellingen
  (`web/site.config.json`). Wordt bij elke codewijziging opnieuw gebouwd en gepubliceerd via
  `.github/workflows/deploy.yml`.
- `infra/` — het uploadscript naar Cloudflare R2 en de technische uitleg van de workflows.

Valt er iets stil, dan blijft de laatste goede data online, laat de site zien hoe oud die is en
krijg jij een e-mail (zie "Wat als…").

**Wat één run oplevert** (echte meting, 9 september 2026, 03:11): uit 16.341 geplande situaties,
796 actuele meldingen en 1.555 brugberichten maakt de pipeline in 11 seconden 52 bestanden van
samen ± 20 MB — `meta.json` (wanneer en hoeveel), `werk-actueel.geojson` en
`werk-gepland.geojson` (de werkzaamheden op de kaart), `live.geojson` (files, incidenten,
open bruggen), `bruggen.json`, 14 lijstbestanden onder `index/` (heel Nederland plus één per
provincie), 32 detailbestanden onder `detail/` en tot slot `manifest.json`, de inhoudsopgave
waarmee het uploadscript ziet wat er veranderd is. Op dat moment waren er 2.335 werkzaamheden,
2.958 afsluitingen, 0 files, 99 incidenten, 1 open brug en 165 evenementen actief, plus 8.272
geplande meldingen voor de komende 30 dagen. Dat er om drie uur 's nachts geen files staan is
juist: de filelaag komt rechtstreeks uit het actuele verkeersbeeld. Overdag in de spits meet
dezelfde pipeline ruim honderd files (gemeten: 116 op 8 september om 17:54).
Een bezoeker downloadt bij het openen van de kaart ± 595 kB (gecomprimeerd); de geplande
werkzaamheden van 1,1 MB komen er alleen bij als je een tijdfilter kiest.

## Wat kost het

Alle hostingonderdelen vallen ruim binnen gratis tiers; alleen de domeinnaam kost geld
(cijfers uit `docs/onderzoek.md` §5.2–5.3, geverifieerd op 7 en 8 september 2026).

| Bezoeken per maand | Hosting (GitHub Actions + Cloudflare R2 + Cloudflare Pages) | Domein |
|---|---|---|
| 0 | €0 | ≈ €1,66/maand |
| 10.000 | €0 | ≈ €1,66/maand |
| 100.000 | €0 | ≈ €1,66/maand |
| 1.000.000 | €0 (dataverkeer vanuit Cloudflare is gratis) | ≈ €1,66/maand |

- **Domein** `.nl` bij TransIP: €0,49 in het eerste jaar, daarna €16,50 per jaar excl. btw
  (≈ €19,97 incl. btw ≈ €1,66/maand). Eén weergave van de TransIP-site toonde €14,99 —
  controleer de prijs bij het bestellen. Met het reservedomein `wegwerkzaamheden-nederland.nl`
  (alleen een doorverwijzing) erbij ≈ €33/jaar excl. btw na het eerste jaar.
- **Gratis limieten en ons gebruik** (limieten uit `docs/onderzoek.md` §5.2, ons gebruik
  gemeten op de echte pipeline-uitvoer van 8 september 2026):
  - **GitHub Actions** — gratis en onbeperkt voor publieke repositories. Wij: ≈ 8.640 runs per
    maand van ± 1 minuut (de omzetting zelf duurde gemeten 9,7 seconden).
  - **Cloudflare R2** — gratis tot 10 GB opslag, 1 miljoen schrijf- en 10 miljoen
    leesoperaties per maand; dataverkeer naar bezoekers is gratis. Wij: de pipeline maakt
    743 bestanden van samen ≈ 45 MB (waarvan 692 per weg/gemeente), en de uploader zet alleen
    gewijzigde bestanden neer. Gemeten op 13 september 2026: per run veranderen ≈ 50
    kernbestanden (kaartlagen, index, details), en de weg-/gemeentebestanden worden alleen
    geüpload op de runs waarin de planningsfeed van NDW is veranderd (≈ elk kwartier, dan
    ≈ 135 bestanden). Dat is **≈ 820.000 schrijfoperaties per maand**: binnen de gratis grens
    van 1 miljoen, maar met ± 18 % marge — daarom staat de kwartaalcontrole hieronder.
    Rekensom en meting: `infra/README.md`. Opslag blijft onder 100 MB.
  - **Cloudflare Pages** — 500 builds per maand, 20.000 bestanden per project, 25 MiB per
    bestand. Wij: bouwen alleen bij een codewijziging, en de site heeft **3.907 pagina's**
    (618 wegen, 2.503 woonplaatsen, 342 gemeenten, 429 bruggen plus 15 vaste pagina's).
    De bruggenlijst groeit langzaam mee: elke run onthoudt nieuwe bruggen die opengaan.
    Ruim onder 20.000 bestanden. Boven 5.000 pagina's splitst de site de `sitemap.xml`
    automatisch.
  - **healthchecks.io** — 20 checks gratis (wij: 1). **UptimeRobot** — 50 monitors gratis
    (wij: 3).
- **Later, optioneel:** KvK-inschrijving en btw-aangifte zodra Google AdSense uitbetaalt
  (`docs/onderzoek.md` §6.4). Verder zijn er geen abonnementen.

## Eenmalige installatie (checklist)

Reken op een middag. Je hebt nodig: een e-mailadres, een betaalkaart voor het domein en deze
map op je computer. Elke stap staat met klikpaden uitgewerkt in `docs/handleiding.md`; de
nummers komen overeen.

1. **GitHub** — maak een account, installeer GitHub Desktop, voeg deze map toe
   (*File > Add local repository*), maak de eerste commit en publiceer als **publieke**
   repository (vinkje *Keep this code private* uít). Publiek is nodig: alleen dan is GitHub
   Actions gratis en onbeperkt.
2. **Domein** — bestel `wegwerkzaamhedennederland.nl` (en eventueel het reservedomein) bij
   TransIP, met automatische verlenging.
3. **Cloudflare** — maak een gratis account, voeg het domein toe (Free-plan) en zet bij TransIP
   de nameservers op de twee die Cloudflare toont (TransIP noemt een verwerkingstijd van
   4 tot 24 uur; niet zelf nagemeten).
4. **Cloudflare R2** — activeer R2, maak bucket `wegwerk-data`, koppel het subdomein
   `data.<domein>`, zet de CORS-regel, maak een API-token met alleen *Object Read & Write* op
   die bucket (zonder vervaldatum) en maak een Cache Rule voor `data.<domein>` (*Eligible for
   cache*, Edge TTL volgens de `Cache-Control`-header van de bestanden). Noteer het Account ID.
5. **Cloudflare Pages** — kies een projectnaam (bijvoorbeeld `wegwerk`) en maak een API-token
   met *Cloudflare Pages: Edit*. Het project wordt bij de eerste deploy automatisch aangemaakt;
   daarna koppel je `www.<domein>` en `<domein>` als custom domains. (Alternatief: Cloudflare
   laat zelf bouwen via *Connect to Git* — zie handleiding §5.)
6. **Bewaking** — healthchecks.io (gratis): één check met periode 10 minuten en grace 20
   minuten; kopieer de ping-URL. UptimeRobot (gratis): een HTTPS-monitor op de site, een
   keyword-monitor op `https://data.<domein>/v1/meta.json` (trefwoord `generated`) en een
   monitor op de vervaldatum van het domein.
7. **GitHub-secrets en -variabelen** (*Settings > Secrets and variables > Actions*). Neem de
   namen letterlijk over — een typefout is de meest gemaakte fout. Handleiding §7.

   | Naam | Soort | Nodig voor | Waarde |
   |---|---|---|---|
   | `R2_ACCOUNT_ID` | secret | Data | Cloudflare Account ID (32 tekens), handleiding §4.3 |
   | `R2_ACCESS_KEY_ID` | secret | Data | uit het R2-token, §4.6 |
   | `R2_SECRET_ACCESS_KEY` | secret | Data | uit het R2-token (wordt één keer getoond), §4.6 |
   | `R2_BUCKET` | secret | Data | `wegwerk-data`, §4.2 |
   | `HEALTHCHECK_URL` | secret | Data | ping-URL van healthchecks.io, §6.1. Leeg laten = geen ping |
   | `CLOUDFLARE_ACCOUNT_ID` | secret | Deploy | hetzelfde Account ID als hierboven |
   | `CLOUDFLARE_API_TOKEN` | secret | Deploy | token met *Cloudflare Pages: Edit*, §5.2 |
   | `DATA_BASE` | **variabele** | Deploy | `https://data.<domein>/v1/` — met `https://` én een slash aan het eind |
   | `CF_PAGES_PROJECT` | **variabele** | Deploy | de projectnaam uit stap 5, bijvoorbeeld `wegwerk` |
   | `R2_PREFIX` | secret, optioneel | Data | alleen als de data niet onder `/v1/` moet staan (standaard `v1`; wijzig dan ook `DATA_BASE`) |
   | `R2_JURISDICTION` | secret, optioneel | Data | alleen als je de bucket met *Specify jurisdiction* maakte, dan `eu` |
8. **Eerste run** — *Actions > Data > Run workflow* (vinkje *force* aan). Groen? Open
   `https://data.<domein>/v1/meta.json` in je browser. Daarna *Actions > Deploy > Run workflow*
   en koppel de custom domains aan het Pages-project. Vanaf nu draait alles vanzelf.
9. **Teksten en gegevens** — vul `web/site.config.json` (`url`, `contactEmail`, `owner`), de
   plaatsaanduidingen tussen `[…]` in `web/content/*.md` (colofon, privacy, disclaimer,
   contact) en in `LICENSE` de regel `Copyright (c) 2026 <eigenaar>` (zet je naam of
   bedrijfsnaam waar `<eigenaar>` staat). Commit en push → de site wordt automatisch opnieuw
   gepubliceerd.
10. **Later** — Cloudflare Web Analytics (gratis, zonder cookies): token in
    `web/site.config.json` → `analytics.token`. Google AdSense pas aanvragen als de
    tekstpagina's live en geïndexeerd zijn; daarna `ads.enabled: true` en de ids in
    `site.config.json` (het bestand `ads.txt` komt automatisch mee) en in AdSense de eigen
    toestemmingsmelding (CMP) publiceren mét "Niet akkoord"-knop.

## Wat als…

| Situatie | Wat je merkt | Wat je doet |
|---|---|---|
| **De pipeline valt stil** | E-mail van healthchecks.io ("is DOWN"); de site toont de waarschuwingsbalk met de laatste bijwerktijd | Ga naar github.com → jouw repository → **Actions** → *Data*. Rode run? Klik erop; de foutmelding staat bij het rode kruisje en onder *Summary*. Klik **Re-run all jobs**. Meestal was NDW even niet bereikbaar en lost de volgende run (5 minuten later) het zelf op. |
| **GitHub heeft het schema uitgeschakeld** | Gele balk "This scheduled workflow is disabled …" bij *Data*; geen nieuwe runs | Klik **Enable workflow**. Dit gebeurt na 60 dagen zonder activiteit in de repository; de workflow houdt zichzelf normaal wakker met dagelijkse API-aanroepen en cache-commits. |
| **Token verlopen of ingetrokken** | Rode runs met "403", "Access Denied" of "SignatureDoesNotMatch" in de stap *Upload changed files to R2* | Maak in Cloudflare een nieuw R2-token (handleiding §4.6) en zet beide waarden in de GitHub-secrets `R2_ACCESS_KEY_ID` en `R2_SECRET_ACCESS_KEY`; daarna *Run workflow*. Voor de site: nieuw token met *Cloudflare Pages: Edit* → secret `CLOUDFLARE_API_TOKEN`. |
| **NDW wijzigt het formaat of de bestandsnamen** | Runs eindigen met "Validation floor not met (exit 2)" of "Pipeline failed"; de site blijft de laatste goede data tonen, met waarschuwingsbalk | Voor bezoekers is er niets kapot. Laat een ontwikkelaar de pipeline aanpassen (`pipeline/`); `docs/onderzoek.md` §2 beschrijft de feeds en `pipeline/test/` bevat voorbeeldbestanden. |
| **Domein verloopt** | E-mail van UptimeRobot (de domain-expiry-monitor waarschuwt enkele weken vooraf; het exacte aantal dagen is niet nagemeten) en van TransIP; daarna is de site onbereikbaar | Verleng bij TransIP; controleer dat automatische verlenging aan staat en de betaalkaart geldig is. |
| **Site onbereikbaar, data wél** | E-mail van UptimeRobot voor de HTTPS-monitor | Kijk op status.cloudflare.com. Open Cloudflare → *Workers & Pages* → project → laatste deployment. Zo nodig *Actions > Deploy > Run workflow*. |
| **Je wilt een tekst aanpassen** | — | Bewerk `web/content/<pagina>.md` of `web/site.config.json`, commit en push met GitHub Desktop. De *Deploy*-workflow publiceert binnen ± 5 minuten. |
| **Deploy stopt met een melding over te veel bestanden** | Rode *Deploy*-run bij de stap *Deploy to Cloudflare Pages* | Cloudflare Pages staat 20.000 bestanden per project toe. De site zit nu op 3.907 pagina's, dus dit gebeurt alleen als er veel nieuwe paginatypen bij komen. Laat een ontwikkelaar minder pagina's genereren of de site naar Cloudflare Workers Static Assets verhuizen (`docs/onderzoek.md` §5.2). |
| **Je wilt van domein wisselen** | — | Nieuw domein toevoegen in Cloudflare; custom domains bij R2 en Pages aanpassen; GitHub-variabele `DATA_BASE` en `url` in `web/site.config.json` wijzigen; *Deploy* draaien. |
| **Dependabot opent pull requests** | E-mail "chore(deps)…" of "chore(ci)…", één keer per maand | Mag je negeren of sluiten; er gaat niets mis als ze open blijven. Beveiligingsupdates kun je met één klik mergen zodra *CI* groen is. |
| **Je kunt niet meer inloggen** | — | GitHub, Cloudflare en TransIP hebben allemaal wachtwoordherstel via je e-mailadres. Bewaar de herstelcodes van tweestapsverificatie buiten deze repository. |

## Onderhoudskalender

| Wanneer | Wat | Hoe lang |
|---|---|---|
| **Wekelijks** | Open de site: staat er een recente tijd bij "Bijgewerkt"? Geen e-mail van healthchecks.io of UptimeRobot betekent dat alles werkt. | 1 minuut |
| **Elk kwartaal** | Cloudflare → *R2 object storage* → *Overview*: staan de Class A-operaties van deze maand onder 1 miljoen en de opslag onder 10 GB? (Verwacht: ± 820.000 en < 100 MB. Komt het boven ± 950.000: laat een ontwikkelaar de weg-/gemeentebestanden minder vaak uploaden — `infra/README.md`, "R2 Class A operations".) | 2 minuten |
| **Jaarlijks (a)** | TransIP: staat automatisch verlengen nog aan en is de betaalkaart geldig? Dit is het grootste risico voor de site. | 5 minuten |
| **Jaarlijks (b)** | Optioneel: vervang het R2-token en het Cloudflare-token — nieuw token maken (handleiding §4.6 en §5.2), secrets bijwerken, *Run workflow*, oud token verwijderen. | 20 minuten |
| **Jaarlijks (c)** | Kijk of GitHub of Cloudflare de gratis limieten hebben gewijzigd. `docs/onderzoek.md` §5.5 beschrijft per risico de uitwijkmogelijkheid (bijvoorbeeld Backblaze B2 in plaats van R2). | 10 minuten |
| **Na ± 2 jaar** | Laat een ontwikkelaar de grote versies bijwerken (Node, MapLibre, Vite). De kleine updates heeft Dependabot dan al voorgesteld. | — |

## Voor ontwikkelaars (kort)

```sh
npm ci                                   # alle workspaces
npm run data                             # pipeline → web/public/data (echte NDW-feeds)
npm run dev                              # Vite-dev-server met die data
npm run build -w @wegwerk/web            # productiebuild → web/dist (wat Deploy ook doet)
npm test                                 # pipeline + web + infra
node --test "infra/test/**/*.test.mjs"   # alleen de infra-tests (Node 24 wil een glob, geen map)
node infra/upload-r2.mjs --dry-run --out pipeline/out --cache pipeline/cache   # uploadplan bekijken
```

De pipeline-CLI zelf: `node pipeline/bin/run.js --out <map> [--cache <map>] [--force]
[--geocode-max <n>] [--no-geocode] [--from-file naam=pad] [--sources planning,actueel,bruggen]
[--now <iso>] [--verbose]`; hij drukt één samenvattingsregel af en eindigt met 0 (publiceren),
2 (validatievloer niet gehaald — niet publiceren) of 1 (mislukt). Contracten tussen de
onderdelen: `docs/build-contracts.md`. Workflows, secrets en het uploadscript:
`infra/README.md`.

## Licentie en bronnen

Code: MIT (`LICENSE`). Verkeersdata: NDW (CC0). Kaart: © Kadaster, BRT Achtergrondkaart
(CC BY 4.0) via PDOK. Kaartbibliotheek: MapLibre GL JS. Zie `docs/onderzoek.md` §2.5 voor de
verplichte naamsvermelding.
