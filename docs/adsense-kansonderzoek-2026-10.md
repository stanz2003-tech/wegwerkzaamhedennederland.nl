# AdSense: hoe groot is de kans op goedkeuring? (onderzoek 30 oktober 2026)

Onafhankelijke inschatting voor Stan: wat gebeurt er als je vandaag een nieuwe beoordeling
aanvraagt voor wegwerkzaamhedennederland.nl, en wat kun je het beste eerst verbeteren?

Alles hieronder is alleen gelezen en bekeken. Ik heb niets aangevraagd of ingesteld in AdSense,
Search Console of Cloudflare, en niets aan de site veranderd.

---

## Kort antwoord

| Moment van aanvragen | Geschatte kans op goedkeuring |
|---|---|
| **Vandaag** (30 okt), zonder verdere aanpassingen | **ongeveer 30%** (marge 20–40%) |
| **Rond 16–23 november**, na de snelle verbeteringen hieronder | **ongeveer 50–60%** |
| Na ook het grotere werk (minder standaardtekst, eigen redactie, externe vermeldingen) | **ongeveer 65–75%** |

Mijn advies: **vraag nu nog niet aan.** Doe eerst de snelle verbeteringen uit §5.1 (samen een
dag werk). Vraag daarna aan rond **16–23 november**, op een dag dat de gegevens actueel zijn.

**Vandaag zeker niet.** Sinds 15:24 komen er geen nieuwe gegevens binnen. Er loopt een storing bij
GitHub Actions (zie §2.1). Daardoor staat op elke pagina "We krijgen sinds 15:24 geen nieuwe
gegevens". Voor een beoordelaar die op "doorlopend beheerd" let, is dat precies het verkeerde beeld.

Hoe zeker zijn deze cijfers? Niet erg. Google legt niet uit hoe het beoordeelt. Een groot deel
gaat automatisch, en het afwijzingsbericht is altijd hetzelfde algemene verhaal. De percentages
zijn een onderbouwde schatting, geen meting. Ze rusten op drie dingen:

- wat Google zelf schrijft (§4);
- de signalen die ik in je account en op de site zie (§2 en §3);
- hoe het andere sites met veel automatisch gemaakte pagina's vergaat.

---

## 1. Wat speelt er?

- **25 okt, 08:19:** afgewezen met "Content van weinig waarde". De status is nog steeds *Vereist
  aandacht*.
- **25 okt, ±21:00:** PR #6 ging live: de uitleg met vier gidsen, het logboek, de Over-pagina met
  "Stan" als uitgever, en geen advertenties op lege pagina's.
- **De beoordelaar heeft PR #6 dus nooit gezien.** Dat pleit voor een nieuwe poging. Maar de
  signalen die Google over de hele site meeneemt, zijn sindsdien nauwelijks veranderd: hoeveel er
  geïndexeerd is, hoe oud de site is, en of anderen ernaar verwijzen.

---

## 2. Wat ik zag

### 2.1 De live site, bekeken als beoordelaar

**Sterk**
- **Een echte tool met eigen werk erin.** Per melding een oordeel ("weg dicht", "doorrijden
  mogelijk"), vooruitkijken per dag, een routeplanner en voertuigkeuze. Dat is meer dan de ruwe
  NDW-data doorgeven, en AdSense noemt "tools of services van hoge kwaliteit" expliciet als
  waarde.
- **De homepage heeft zo'n 1.300 woorden.** Bovenaan de kaart, daaronder een legenda,
  "Vooruitkijken", "Waar komt de data vandaan" en overzichten. Hij is dus niet alleen een kaart.
- **De vier gidsen zijn echt redactioneel.** Ze tellen 880–1.170 woorden en zijn goed geschreven.
  Ook "Veelgestelde vragen" (1.770 woorden) is goed.
- **Over, privacy, cookies, disclaimer, colofon, contact en wijzigingen zijn er allemaal.** Ze
  zijn verzorgd en vertellen hetzelfde verhaal.
- **Advertentieregels werken zoals bedoeld.** In de steekproef stonden geen
  noindex-pagina's in de sitemap; die worden al weggelaten. Rustige plaatsen hebben
  `wegwerk-ads=off`, net als de helft van de bruggen. De kaart zelf laadt geen AdSense. Op
  tekstpagina's laadt het script wel, maar er komen nog geen advertentieblokken, want de
  blok-ids zijn leeg.

**Zwak**
- **Er is veel standaardtekst.** Ik nam een steekproef van 65 gegenereerde pagina's. Ik telde
  alleen zinnen die woordelijk op meerdere pagina's terugkomen. Zinnen met alleen een andere
  plaatsnaam erin telde ik niet mee, dus het echte aandeel is hoger.

  | Soort pagina | Woorden | Woordelijk dezelfde tekst |
  |---|---|---|
  | Plaats | 615–1.060 | 27–46%, meestal ±44% |
  | Gemeente | 795–1.230 | 24–38% |
  | N-weg | ±707 | ±50% (alle rustige N-wegen even lang) |
  | Brug | 487–520 | **74–82%** |

  Voorbeelden van blokken die op honderden pagina's terugkomen: "Zo lees je dit overzicht",
  "De rode badge geeft aan…", "De planning wordt ongeveer elk kwartier vernieuwd…". Die laatste zin
  kwam in de 65 steekproefpagina's 80 keer voor, want veel pagina's hebben hem twee keer.

  Dit is precies wat Google "automatisch gegenereerde content" en "templated" noemt. Het beleid
  zegt letterlijk dat er geen advertenties mogen staan op "automatically generated content
  without manual review or curation" (§4).
- **Op brugpagina's ontbreekt de kern in de HTML.** Op /brug/beltbrug/ staat "20 geplande
  openingen in de komende 7 dagen", maar de tijden zelf staan niet in de HTML. Wie de pagina
  zonder JavaScript leest, ziet een aantal en verder vooral standaardtekst en een lijst andere
  bruggen. Toch staan daar advertenties aan.
- **Het menu-item "Uitleg" gaat niet naar de uitleg.** Bovenaan wijst het naar `/#uitleg`, een
  stukje van de homepage. Alleen de footer linkt naar /uitleg/. De nieuwe gidsen, het
  belangrijkste wat sinds de afwijzing is toegevoegd, zijn dus slecht te vinden.
- **De uitgever is anoniem.** Er staat alleen "Stan": geen achternaam, plaats of KvK. Voor een
  site die van advertenties moet leven, is dat het zwakste vertrouwenssignaal. Wettelijk vraagt
  art. 3:15d BW ook om een geografisch adres. Dit punt stond al open.
- **De data staat nu stil.** De laatste geslaagde run was 14:24 UTC (15:24 hier). De Data-run
  van 14:23 UTC faalde en daarna kwamen er geen runs meer. Op githubstatus.com loopt een
  storing, "Incident with Actions, Pages, and Webhooks". Om 19:07 stond de waarschuwing op elke
  pagina. Dat ligt niet aan de site, maar een beoordelaar ziet het wel.
- **Het logboek staat sinds 25 oktober stil.** De laatste regel in /wijzigingen/ is van
  25 oktober. Voor "doorlopend beheerd" is een levend logboek juist nuttig.
- **Is info@ bereikbaar? Graag zelf testen.** Het MX-record wijst naar `_dc-mx.…`, niet naar de
  servers van Cloudflare Email Routing. Het SPF-record is `v=spf1 ~all`. Ik heb geen testmail
  gestuurd. Een contactadres dat niet werkt, schaadt het vertrouwen, als een beoordelaar
  het al probeert.
- **De toestemmingsmelding verschijnt nog niet.** Het script laadt, maar de melding komt niet en
  `__tcfapi` bestaat niet. Dat was op 16 oktober ook al zo en hoort waarschijnlijk bij de status
  "niet goedgekeurd". Na goedkeuring moet je dit controleren (zie de geheugennotitie).

### 2.2 AdSense-account (alleen gelezen)

- **Sites:** wegwerkzaamhedennederland.nl staat op *Vereist aandacht* ("Content van weinig
  waarde"), laatst bijgewerkt 25 okt 2026 08:19. Ads.txt staat op *Geautoriseerd*.
- **De afwijzing zelf,** zoals op de detailpagina:
  > "Een site komt alleen in aanmerking voor advertentieweergave als deze aanzienlijke unieke
  > waarde biedt, een consistente aanwezigheid op internet heeft en een niveau van
  > gebruikersinteresse toont dat een commercieel advertentiepartnerschap ondersteunt."

  Daarna volgen drie eisen:
  - "authentieke informatie, tools of services van hoge kwaliteit";
  - "doorlopend beheerd en structureel onderhouden";
  - "genereert en behoudt oprechte interesse van gebruikers".
- **Beleidscentrum:** "Momenteel geen problemen". Er zijn geen andere beleidswaarschuwingen.
- **Privacy en berichten:** de EU-toestemmingsmelding staat op *1 actief*.
- **Open waarschuwing:** "Voeg uw betalingsgegevens toe en koppel uw site". Dit blokkeert de
  beoordeling niet, maar vul de betaalgegevens wel in, dan hoef je na goedkeuring niet te
  wachten.
- **Homepage:** alleen de optionele taak "Bekijk hoe uw advertenties eruitzien".

### 2.3 Search Console (alleen gelezen)

- **Indexering** (rapport bijgewerkt tot 23-10): **1.080 pagina's geïndexeerd, 3.180 niet.** De
  grootste reden, **2.799 pagina's**, is *Gevonden – momenteel niet geïndexeerd*. Google kent die
  URL's wel, maar vindt ze nog niet de moeite waard om op te halen. Overige redenen: geblokkeerd
  door robots.txt (237), omleiding (92), alternatieve canonieke pagina (27), noindex (12),
  gecrawld maar niet geïndexeerd (13), 404 (1). De sitemap telt nu 2.538 URL's.
- **De nieuwe pagina's zijn half geïndexeerd.** Een `site:`-zoekopdracht vindt /uitleg/omrijden/
  en /uitleg/meldingen-lezen/. Hij vindt niet /uitleg/, de twee andere gidsen, /over/ en
  /wijzigingen/.
- **Prestaties over 28 dagen:** 10.500 klikken, 159.000 vertoningen, CTR 6,6%, positie 6,9. De
  trend is sterk:

  | Periode | Klikken per dag |
  |---|---|
  | begin oktober | ±160–190 |
  | 12–18 oktober | ±330–580 |
  | 19–23 oktober | ±550–670 |
  | 26–28 oktober | ±890–990 |

  Gemeentepagina's halen de meeste klikken (Den Bosch alleen al 1.312), daarna plaatsen en
  wegen. De uitleg had in deze periode 1 klik.
- **Handmatige acties:** geen. **Beveiligingsproblemen:** geen.
- **Externe links: 0.** Geen enkele andere site linkt volgens Google naar Wegwerk. Ik vond ook
  geen vermeldingen buiten de eigen site.

---

## 3. Wat pleit voor en tegen goedkeuring

**Voor**
1. **Er is echte, groeiende belangstelling van gebruikers.** Bijna 1.000 klikken per dag uit
  Google, verdubbeld in twee weken, met 80% van het bezoek uit zoekmachines. Dit is de derde
  eis uit het afwijzingsbericht, en daar scoort de site goed.
2. **Het is een tool, geen kopie.** Het oordeel per melding, de controle tegen ruwe data, de
  routeplanner en het vooruitkijken zijn eigen werk bovenop open data.
3. **De site is aantoonbaar onderhouden.** Er is een logboek met wekelijkse verbeteringen sinds
  12 september, en de data wordt elke 10 minuten ververst (als GitHub werkt).
4. **Er zijn geen beleidsproblemen.** Het beleidscentrum, de handmatige acties en de beveiliging
  zijn schoon. Ads.txt klopt en de toestemmingsmelding staat klaar.
5. **De beoordelaar heeft de uitleg en de nieuwe Over-pagina nog niet gezien.**

**Tegen**
1. **Het gaat om veel pagina's met veel standaardtekst** (§2.1). Google ziet een site met ±2.500
  gegenereerde pagina's, waarvan 30–80% van de tekst op andere pagina's terugkomt. Dat is het
  klassieke profiel voor "weinig waarde". Het officiële beleid noemt automatisch gegenereerde
  content zonder handmatige curatie als reden om geen advertenties toe te staan.
2. **Google is zelf nog niet overtuigd.** 2.799 bekende URL's zijn nog niet eens opgehaald, en
  maar een kwart van alles wat Google kent, is geïndexeerd.
3. **Er is geen "consistente aanwezigheid op internet".** De site heeft nul externe links, geen
  vermeldingen en geen sociale accounts. Hij is zeven weken oud. Deze eis staat sinds kort
  letterlijk in de afwijzing, en hier helpt alleen tijd en een beetje promotie.
4. **De uitgever is anoniem.** "Stan" zonder achternaam of plaats is mager voor een
  advertentiepartnerschap.
5. **Het nieuwe werk is nog nauwelijks zichtbaar.** De gidsen zijn half geïndexeerd, /over/ en
  /wijzigingen/ niet, en "Uitleg" in het menu wijst naar de homepage.
6. **Vandaag staat de data stil** (GitHub-storing).

**Afweging.** Punt 1 van "Voor" weegt zwaar. Met deze bezoekcijfers is de site geen leeg
spookproject, en ik denk dat veel afgewezen programmatische sites dat wél zijn. De
"Tegen"-punten 1 tot en met 3 gaan over precies wat de automatische controle van Google meet.
Twee daarvan (2 en 3) verbeteren vanzelf met de tijd. Daarom liever over 2–3 weken dan nu.

---

## 4. Wat Google zelf zegt (officiële bronnen)

- **Wanneer kom je in aanmerking?** Je site moet "high-quality, original" content hebben die
  publiek trekt, en voldoen aan het programmabeleid. Er is officieel geen minimum voor bezoek of
  leeftijd van de site. ([AdSense: eligibility requirements](https://support.google.com/adsense/answer/9724))
- **Is je site klaar?** Google vraagt om unieke content die relevant is voor bezoekers, een
  duidelijke navigatie, en een eigen bijdrage als je materiaal van anderen gebruikt.
  ([AdSense: make sure your site's pages are ready](https://support.google.com/adsense/answer/7299563))
- **Op welke schermen mogen geen advertenties staan?** Op schermen "without publisher-content or
  with low-value content", schermen "used for alerts, navigation or other behavioral purposes",
  en op "automatically generated content without manual review or curation". Dit is de
  belangrijkste regel voor Wegwerk. Lege pagina's heb je al afgevangen. De open vraag is of de
  gegenereerde pagina's met inhoud genoeg zichtbare curatie laten zien.
  ([Publisher policies: ads on screens without publisher content](https://support.google.com/publisherpolicies/answer/11112688))
- **Het afwijzingsbericht** verwijst naar de AdSense-tips voor content en gebruikerservaring en
  naar Google's spambeleid voor weinig originele content. Daaronder valt "scaled content abuse":
  veel pagina's die vooral voor zoekmachines bestaan.
- **Ervaring van anderen.** De nieuwe tekst over "consistente aanwezigheid op internet" en
  "gebruikersinteresse" lijkt sinds september/oktober 2026 in afwijzingen te staan. Een andere
  datasite-maker werd zes keer afgewezen, ook nadat alle pagina's geïndexeerd waren en er
  analyses waren bijgeschreven. Die site had wel weinig bezoek.
  ([Anime Semantle, "What five AdSense rejections taught me"](https://www.anisemantle.com/en/pages/story))
  Dat bevestigt dat bezoek en externe aanwezigheid meetellen. Op het eerste scoort Wegwerk goed,
  op het tweede niet.
- **Officieel is er geen straf voor een nieuwe aanvraag.** Een afwijzing kost vooral tijd: de
  beoordeling duurt dagen tot een paar weken. Snel achter elkaar aanvragen zonder echte
  wijzigingen helpt volgens de ervaringen in het AdSense-forum niet.

---

## 5. Verbeteringen, op volgorde van belang

### 5.1 Snelle verbeteringen (samen ±1 dag, vóór de aanvraag)

| # | Wat | Waarom | Effect |
|---|---|---|---|
| 1 | **Niet aanvragen terwijl de data stilstaat.** Wacht tot GitHub Actions weer draait, en controleer op de dag zelf dat de waarschuwing weg is. | Een beoordelaar ziet anders "We krijgen geen nieuwe gegevens" op elke pagina. | Groot, en gratis |
| 2 | **"Uitleg" in het hoofdmenu naar /uitleg/ laten wijzen** in plaats van `/#uitleg`. Zet de uitleg ook op gemeente-, weg- en plaatspagina's als duidelijke link. | Het redactionele deel moet voor beoordelaar en Google vindbaar zijn, en niet alleen in de footer. | Middel |
| 3 | **Indexering aanvragen (doe je zelf, in Search Console → URL-inspectie)** voor /uitleg/, /uitleg/waar-komt-de-data-vandaan/, /uitleg/weekend-en-nachtafsluitingen/, /over/ en /wijzigingen/. Wacht tot ze met `site:` te vinden zijn. | Juist deze pagina's laten de eigen bijdrage zien. | Middel |
| 4 | **Je volledige naam en woonplaats op /over/ en /colofon/** (KvK als je die hebt). | Het sterkste vertrouwenssignaal voor een site met advertenties, en wettelijk verplicht (art. 3:15d BW). | Middel tot groot |
| 5 | **Het logboek bijhouden:** een regel per verbetering na 25 oktober (de dagrapportage, dit onderzoek, wat je hierna doet). | Toont "doorlopend beheerd". | Klein tot middel |
| 6 | **Brugpagina's:** zet de openingstijden van de komende 7 dagen in de HTML, of zet advertenties uit op alle brugpagina's. | 75–80% standaardtekst met advertenties erbij is het zwakste paginatype. | Middel |
| 7 | **info@ testen** met een mail van een ander adres, en MX en SPF rechtzetten als die niet aankomt. | Een contactadres dat niet werkt, is een rood signaal. | Klein, maar voorkomt een fout |
| 8 | **Betaalgegevens invullen in AdSense.** | Geen effect op de beoordeling, maar na goedkeuring hoef je niet te wachten. | Geen effect op de kans |

### 5.2 Groter werk (1–3 weken, maakt de kans echt groter)

| # | Wat | Waarom | Effect |
|---|---|---|---|
| 9 | **Standaardtekst terugbrengen op plaats-, weg- en brugpagina's.** Haal "Zo lees je dit overzicht" en de badge-uitleg uit de ±2.200 pagina's en verwijs met één zin naar /uitleg/meldingen-lezen/. Vervang dat door feiten per pagina die alleen Wegwerk heeft: hoeveel meldingen er de afgelopen 30 of 90 dagen waren, welke straat of weg het vaakst dicht ging, welke wegbeheerders hier melden, en wanneer de laatste grote afsluiting was. | Dit pakt de kern van "weinig waarde" en "automatisch gegenereerd" aan. Elke pagina wordt dan echt anders. | **Groot** |
| 10 | **Een wekelijks stuk dat je zelf schrijft,** bijvoorbeeld "Dit weekend op de weg": de 5–10 belangrijkste afsluitingen met een paar zinnen uitleg van jou. Het mag een automatisch concept zijn dat jij nakijkt en aanvult. Met datum en "door Stan [achternaam]". | Toont letterlijk de "manual review or curation" die het beleid vraagt. Het is ook goed voor zoekverkeer op "afsluitingen dit weekend". | **Groot** |
| 11 | **Minder, maar sterkere pagina's in de sitemap.** Laat kleine plaatsen zonder meldingen in 60 dagen weg en noindex ze. Zet de bruggen alleen in de sitemap als er openingen zijn. | 2.799 URL's "gevonden, niet geïndexeerd" zegt Google: te veel pagina's van twijfelachtige waarde. Een kleiner, sterker geheel geeft een beter beeld. | Middel |
| 12 | **Externe aanwezigheid opbouwen.** Een paar echte vermeldingen of links, bijvoorbeeld: NDW of de gemeenten vragen om opname in een lijst met toepassingen van de open data; een bericht op r/thenetherlands of r/Netherlands of op een forum (Tweakers, autoforums); lokale media bij een grote afsluiting; een LinkedIn- of X-account dat de weekendafsluitingen deelt. | De afwijzing noemt "consistente aanwezigheid op internet" letterlijk, en nu zijn er 0 externe links. | Middel tot groot, wel langzaam |

---

## 6. Wanneer aanvragen?

1. **Niet vandaag.** De data staat stil, en de snelle verbeteringen kosten maar een dag.
2. **Doe eerst 5.1, punten 2 tot en met 7.** Begin ook aan punt 9 of 10, al is het maar één eerste
  weekendstuk.
3. **Vraag aan als alles hieronder klopt:**
   - de nieuwe pagina's (/uitleg/ en de gidsen, /over/, /wijzigingen/) zijn met `site:` te
     vinden;
   - het logboek heeft minstens twee nieuwe regels;
   - de data is die dag actueel.

   Realistisch is dat **16–23 november**. Dat past bij het oude plan voor half november, en de
   site is dan ruim twee maanden oud.
4. **Na een tweede afwijzing:** doe 9 tot en met 12 helemaal, en wacht minstens vier weken voor
   de volgende poging. De standaardtekst en de externe aanwezigheid zijn dan het enige wat nog
   overblijft.

---

## 7. Wat er op 30 oktober al is gedaan

Stan vroeg om de punten uit te werken, met als harde eis: de site blijft snel op een telefoon en
draait om "kan ik er nu of de komende dagen door?". Daarom is er geen opvultekst bijgekomen.
Algemene tekst is weggehaald, en nieuwe tekst is alleen toegevoegd als die per pagina die vraag
beantwoordt.

| # | Punt | Stand |
|---|---|---|
| 1 | Data stond stil | **Opgelost.** Het lag aan de storing bij GitHub. Om 18:47 UTC draaide de reserve-cron weer, en om 18:58 UTC liep de keten van 10 minuten weer. |
| 2 | Menu "Uitleg" | **Gedaan.** Het menu linkt op alle pagina's en op de kaart naar /uitleg/. |
| 3 | Indexering aanvragen | **Voor Stan, na de deploy.** Vraag het aan voor /uitleg/ en de gidsen, /over/ en /wijzigingen/. |
| 4 | Naam en woonplaats | **Wacht op Stan.** Zet ze in `web/site.config.json` → `owner.name` / `owner.city`. De teksten op /over/, /colofon/ en /contact/ passen zich dan vanzelf aan. |
| 5 | Logboek | **Gedaan.** Er is een regel voor 30 oktober bijgekomen. |
| 6 | Brugpagina's | **Gedaan.** De openingen van de komende 7 dagen staan per dag, met tijden, in de HTML. |
| 7 | info@ testen | **Voor Stan.** Het MX-record wijst nog niet naar Cloudflare Email Routing. |
| 8 | Betaalgegevens AdSense | **Voor Stan.** |
| 9 | Standaardtekst | **Gedaan,** zie hieronder. |
| 10 | Wekelijks eigen stuk | **Niet gedaan.** Dit werkt alleen als Stan het elke week zelf schrijft of nakijkt. Een automatisch stuk is precies de "content zonder handmatige curatie" waar het beleid voor waarschuwt. |
| 11 | Sitemap kleiner | **Bewust nog niet.** De meting van SEO-fase 2 loopt tot ±10 november. Bovendien houdt de 60-dagenregel nu al 1.297 rustige pagina's buiten Google. |
| 12 | Externe vermeldingen | **Voor Stan.** Plaatsen op Reddit, forums of LinkedIn gebeurt onder zijn eigen naam. |

**Standaardtekst, wat er veranderd is**

- **Weggehaald:** het blok "Zo lees je dit overzicht" (twee à drie alinea's op elke weg- en
  plaatspagina), de Melvin/NDW-alinea op plaatspagina's, de zinnen over hoe vaak de data ververst
  (die staan al in de stempel en de footer), en de algemene FAQ's. Die FAQ's waren "Hoe
  actueel…?", "Waar vind ik de omleiding?", "Waarom staat het niet op de kaart?" en "Hoe lang duurt
  een brugopening?". Ze worden nu op één plek beantwoord, in /uitleg/ of /veelgestelde-vragen/,
  met één link ernaartoe.
- **Toegevoegd** op plaats- en gemeentepagina's: een blok "Is er iets dicht in …?" met vier
  echte antwoorden uit de data van die plaats:
  - vandaag;
  - morgen;
  - dit weekend;
  - wanneer de eerstvolgende afsluiting begint.

  Voorbeeld uit Warmond: "Is er vandaag een weg dicht in Warmond? Ja. Herenweg dicht (tot vr 30 okt
  20:00)." Na het laden werkt de pagina het blok live bij, net als het vergelijkbare blok op
  wegpagina's.

**Gemeten effect** (dezelfde steekproef van 65 pagina's als in §2.1, build met live data van
30 oktober). Het percentage is het deel van de tekst dat woordelijk op andere pagina's terugkomt.

| Soort pagina | Vóór | Na |
|---|---|---|
| Plaats | ±44% | ±18% |
| Gemeente | ±32% | ±11% |
| N-weg | ±50% | ±32% |
| Brug | ±80% | ±52% |

De pagina's zijn ook ongeveer 250 woorden korter, en dat is op de telefoon alleen maar prettiger.

---

*Bronnen in de site:*
- `web/src/ui/ad-policy.ts`, `web/src/ui/ads.ts`, `web/site.config.json`;
- `web/content/*.md`;
- `docs/handleiding.md` §10, `docs/groei-onderzoek-2026-10.md`.

*Live bekeken op 30-10-2026 rond 19:00:*
- de site;
- AdSense (Sites, sitedetail, Beleidscentrum, Privacy en berichten);
- Search Console (Pagina-indexering, Prestaties 28 dagen, Links, Handmatige acties,
  Beveiliging);
- de GitHub Actions API en githubstatus.com.
