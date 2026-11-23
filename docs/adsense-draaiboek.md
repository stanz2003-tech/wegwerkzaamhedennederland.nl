# AdSense: draaiboek voor de nieuwe aanvraag (november 2026)

Voor Stan. Wat er klaar is, wat je zelf nog moet doen, wat je op de aanvraagdag controleert, en wat
je doet tijdens en na de beoordeling. Achtergrond en kansinschatting staan in
[adsense-kansonderzoek-2026-10.md](adsense-kansonderzoek-2026-10.md) (§8).

**Kans op goedkeuring:** ongeveer 55–60% met je naam en locatie op de site (zonder: ±50%). Google
legt niet uit hoe het beoordeelt, dus dit is een onderbouwde schatting, geen belofte.

---

## 1. Toets aan Google's eisen (11 november 2026)

Getoetst aan de officiële AdSense- en uitgeversbeleid-pagina's, met als onafhankelijke controle
twee checklists van GitHub die alleen naar Google's eigen pagina's verwijzen
(`tombrajer/website-launch-skills` → `adsense-readiness-audit`, en
`Firzus/agent-skills` → `adsense/policy-gate.md`). Die skills zijn alleen gelezen, niet
geïnstalleerd: ze zijn nieuw en hebben weinig gebruikers. De andere skills die gevonden zijn,
rekenden met verzonnen regels zoals "minimaal 300 woorden" of "fysiek adres verplicht"; die zijn
genegeerd.

| Eis | Stand | Bewijs |
|---|---|---|
| Unieke, waardevolle content; geen advertenties op pagina's zonder content | **Beter, deze branch** | Antwoorden per pagina uit de eigen data; minder herhaalde tekst (N-wegen 43→30%, bruggen 54→44%); geen advertenties op lege weg-, plaats- en brugpagina's; lege pagina's na 60 dagen noindex |
| Duidelijke uitgever en doel | **Klaar na merge** | "Stan Zegwaard (Almkerk)" op /over/, /colofon/, /contact/ en /privacy/; "Door Stan Zegwaard" op de gidsen |
| Navigatie werkt | **Goed** | 0 kapotte interne links op 3.840 pagina's (206.000 links) |
| Site openbaar en bereikbaar voor de AdSense-crawler | **Risico, zie §1a** | Geen login. De Cloudflare-regel laat geverifieerde bots door, maar daagde op 11–12 nov ook verzoeken vanaf Google's eigen netwerk (AS15169) uit |
| Pagina's in Google | **Goed** | 1.570 geïndexeerd (6 nov); /over/, /uitleg/, /wijzigingen/, /contact/, /privacy/ en de gidsen staan erin (URL-inspectie, 10 nov) |
| Privacyverklaring met cookies van derden en Google | **Goed** | /cookies/: cookies van Google en partners, gepersonaliseerde advertenties, uitschrijven via adssettings.google.com, link naar Google's partnerbeleid. /privacy/ noemt nu de verwerkingsverantwoordelijke bij naam |
| Door Google gecertificeerde toestemmingsmelding (EER) | **Klaar, nog niet zichtbaar** | "Europese regelgeving: 1 actief" in AdSense. Google toont de melding pas na goedkeuring (getest met `?fc=alwaysshow`). Na goedkeuring opnieuw controleren |
| ads.txt | **Let op** | Bestand is goed en bereikbaar (ook met de user-agents van Google getest), maar AdSense → Sites toont op 12 nov "Niet gevonden". Zie §1a |
| Ondersteunde taal | **Goed** | Nederlands |
| Geen ongeldig verkeer | **Goed** | Botverkeer uit China en via proxy's wordt sinds 25 okt en 2 nov uitgedaagd; er zijn nog geen advertentieblokken, dus er kan ook niet geklikt worden |
| Betaalgegevens | **Klaar** | AdSense-startpagina: "Uw profiel is voltooid" (12 nov) |
| Data actueel | **Goed** | Bewaker draait sinds 11 nov; data op 12 nov 18:04 was 3 minuten oud |
| Externe vermeldingen | **Zwak** | Nog geen links of vermeldingen gevonden |

### 1a. Controle van 12 november 2026

**Afkeuringsreden in AdSense (letterlijk, ongewijzigd sinds 25 okt):** "Content van weinig waarde". Google
noemt drie eisen: de site biedt authentieke informatie, tools of services van hoge kwaliteit; de site
wordt doorlopend beheerd en onderhouden; de site trekt en behoudt oprechte interesse van gebruikers.
Het Beleidscentrum meldt "Momenteel geen problemen".

**Gevonden en opgelost op branch `claude/adsense-aanvraag-voorbereiding-aa0ea0`:**

- *Wat is er precies dicht.* Van de afsluitingen die Rijkswaterstaat als "rijbaan afgesloten" meldt, ligt
  ruim 85% op een oprit, afrit of verbindingsweg (863, 602 en 140 records tegen 255 op de hoofdrijbaan).
  De site noemde dat allemaal "Rijbaan dicht". Nu: "Oprit dicht", "Afrit dicht", "Verbindingsweg dicht"
  (je rijdt op de weg zelf door), "Dicht in één richting", en "Weg dicht" als beide richtingen dicht zijn.
  In de melding staat onder "Zo meldt de wegbeheerder het" wat letterlijk is ingevuld. Gemeten op de
  feeds van 12 nov: 493 meldingen lichter, 136 zwaarder, waaronder "De N33 is volledig afgesloten" dat
  als "doorrijden mogelijk" op de site stond.
- *Spookmeldingen.* Een weg waar niets meer gemeld was, hield zijn laatste databestand: /weg/n791/ toonde
  een pechgeval van 21 oktober. De pipeline schrijft nu ook voor lege wegen en gemeenten een bestand.
- *Advertentieregels.* Een wegpagina met alleen een file of pechgeval krijgt geen advertenties meer;
  brugpagina's in een weg volgen hun meldingen (de Merwedebrug-pagina met 29 meldingen stond op "uit").
- *Beveiliging.* HTTPS afgedwongen (HSTS) en camera, microfoon, betalen en USB geweigerd. Geen CSP en geen
  framing-verbod vóór de beoordeling: die kunnen AdSense en de toestemmingsmelding breken.

**Besloten door Stan op 12 november:**

1. **Cloudflare-regel: Google's netwerk uitzonderen.** De regel "Uitdaging voor www-bezoekers buiten
   NL/BE" laat alleen "Known Bots" door. Op 11–12 nov kregen 12 verzoeken vanaf AS15169 (Google) een
   uitdaging: een Google-ophaler uit de VS (user-agent "Google") voor `/weg/a20/` en het favicon, en
   Chrome-achtige verzoeken vanaf Google-adressen voor `/gemeente/best/`, `/weg/n257/`,
   `/plaats/venhorst/` en andere. Een beoordelaar of controle-crawler van AdSense die zo binnenkomt,
   ziet een wachtpagina in plaats van de site. Besluit: aan de regel toevoegen
   `and ip.src.asnum ne 15169`. De nieuwe expressie is op 12 nov in het Cloudflare-formulier gezet;
   **op Save klikken moet Stan zelf doen** (Security → Security rules → de regel → Save). Controleer
   daarna in Security → Events met filter ASN 15169 dat er geen nieuwe uitdagingen bijkomen.
2. **Lege N-wegpagina's uit Google: gedaan (in de branch).** Een N- of S-wegpagina zonder
   werkzaamheden of afsluitingen volgt nu dezelfde 60-dagenregel als plaatsen en bruggen: noindex,
   uit de sitemap, geen advertenties, en terug zodra er weer iets gemeld is. A-wegen blijven altijd
   vindbaar. Proefbuild van 12 nov: 264 wegpagina's krijgen noindex, de sitemap gaat van 2.750 naar
   2.486 URL's. Pagina's linken niet meer naar wegpagina's die uit Google zijn; het overzicht /wegen/
   toont ze nog wel allemaal.
3. **ads.txt "Niet gevonden".** Controleer na de merge in AdSense → Sites; staat het er na een paar
   dagen nog, klik dan op de site en kijk of AdSense een nieuwe controle aanbiedt.

**Niet aangepakt:** "/files/" heeft geen tekst zonder JavaScript; de home-voettekst mist de links naar
Uitleg en Wijzigingen; de site levert onder `/data/` nog het testbestand mee (robots.txt blokkeert het).

---

## 2. Vóór de aanvraag: jouw stappen

1. **PR mergen** van branch `claude/adsense-aanvraag-voorbereiding-aa0ea0` (de vorige, PR #11, staat
   live sinds 11 nov). Controleer na de eerstvolgende datarun (±10 minuten) op de live site: de oprit
   Avelingen op de A27 heet "Oprit dicht", en /weg/n791/ toont geen pechgeval van oktober meer.
2. **Klik op Save bij de Cloudflare-regel** (§1a, punt 1). Dit is de enige stap die de beoordeling
   direct kan raken en die niet in de code zit.
3. Betaalgegevens en de databewaker zijn klaar (11 nov).
4. De lege N-wegpagina's gaan met deze branch uit Google (§1a, punt 2).
5. **Eén tot twee dagen wachten na de merge**, zodat de nieuwe teksten een paar keer live zijn
   gebouwd (de site wordt twee keer per dag opnieuw opgebouwd) en Google ze kan zien.

---

## 3. Op de aanvraagdag (±10 minuten)

Doe het op een werkdag, 's ochtends.

- [ ] **Data vers:** op de homepage staat geen melding "gegevens niet actueel" en bovenaan staat
  een tijd van minder dan 15 minuten geleden.
- [ ] **Steekproef op je telefoon:** de homepage, /gemeente/s-hertogenbosch/, /weg/a2/, een N-weg, een
  brugpagina, /over/ en /uitleg/ laden en zien er goed uit.
- [ ] **AdSense → Beleidscentrum:** "Momenteel geen problemen".
- [ ] **AdSense → Sites:** ads.txt staat op "Geautoriseerd".
- [ ] **Search Console → Overzicht:** geen nieuwe rode meldingen (handmatige acties, beveiliging).
- [ ] **Aanvragen:** AdSense → Sites → wegwerkzaamhedennederland.nl. Volg de stappen op die pagina
  en klik op **"Beoordeling aanvragen"**. Ik kan dit met je meedoen in Chrome; de klik zelf doe ik
  alleen met je akkoord.
- [ ] Noteer datum en tijd van de aanvraag, zodat we weten hoe lang de beoordeling duurt.

---

## 4. Tijdens de beoordeling (dagen tot een paar weken)

**Wel doen**
- De site laten draaien zoals hij is. Kleine verbeteringen en regels in het logboek zijn prima;
  een levend logboek laat zien dat de site onderhouden wordt.
- Elke paar dagen controleren dat de data loopt. Met de bewaker gaat dat vanzelf.

**Niet doen**
- De advertentiecode, ads.txt of het publisher-ID veranderen.
- De site of grote delen ervan achter een login of noindex zetten.
- Opnieuw "Beoordeling aanvragen" klikken terwijl de beoordeling loopt. Dat versnelt niets.
- Zelf op advertenties klikken, nu niet en later ook niet.
- Grote structurele wijzigingen doen, zoals duizenden pagina's toevoegen of weghalen.

---

## 5. Na de uitslag

**Goedgekeurd** (16 november 2026, 05:32. Identiteitsverificatie ingediend, AdSense meldt 2 tot 4
dagen. Blok "Tekstpagina onder antwoord" aangemaakt, ID `8500343403` staat in `ads.slots.article`.
Toestemmingsmelding getest met `?fc=alwaysshow`: verschijnt met drie knoppen. Een plek die het
AdSense-script na 3 seconden niet heeft opgepakt, verdwijnt, zodat bezoekers met een adblocker geen
leeg vak zien: `web/src/ui/ad-fill.ts`.)
1. Maak **één advertentieblok** aan: Advertenties → Per advertentieblok → Display, vierkant,
   responsief. Zet het ID in `web/site.config.json` → `ads.slots.article`. Alleen dat blok bestaat
   in de templates (handleiding §10.2).
2. Controleer de **toestemmingsmelding**: open een tekstpagina met `?fc=alwaysshow` in een
   incognitovenster. De melding moet verschijnen, met knoppen om te accepteren, te weigeren en
   opties te beheren. "Cookie-instellingen" onderaan moet hem opnieuw openen.
3. Controleer na een week in Cloudflare de **snelheid (INP)** van de tekstpagina's.
4. Begin pas daarna met Auto ads of meer blokken. (Tot 23 november stond hier: "en houd de kaart
   reclamevrij". Dat is sindsdien anders, zie §7.)
   - **Automatisch optimaliseren staat uit** (16 november 2026). Het stond standaard aan, op 50%
     van het verkeer, met "winnaar automatisch toepassen": Google mag dan zelf een indeling voor
     automatische advertenties aanzetten, ook een schermvullende. Zet het pas weer aan als de
     gewenste indelingen vastliggen, en blokkeer dan onder *Geblokkeerde experimenten* in elk
     geval vignetten en op intentie gerichte indelingen.
   - Advies voor Auto ads (Advertenties → Op site → potlood → Advertentie-instellingen):
     **ankeradvertentie onderaan** en **zijbalken** aan; **vignetten**, **op intentie gerichte
     indelingen** (BÈTA) en **in-page-indelingen** uit. Een vignet verschijnt ook bij een klik
     van een wegpagina naar de kaart; intentielinks komen in teksten als "A2 dicht"; in-page
     blokken laten de pagina verspringen. Lege pagina's blijven vanzelf reclamevrij: daar laadt
     het AdSense-script niet (`web/src/ui/ads.ts`). De kaart is sinds 23 november in AdSense
     uitgesloten van automatische advertenties (§7).
   - Een tweede eigen blok onder de veelgestelde vragen op weg- en plaatspagina's is goedkoper
     voor de snelheid dan in-page Auto ads (vaste hoogte, geen verspringing).
   - **Let op bij de ankeradvertentie (toegevoegd 16 november):** weg-, plaats- en brugpagina's
     hebben op een telefoon al een eigen balk onderaan ("Nu: … · Andere dag"). Een
     ankeradvertentie van Google komt op dezelfde plek. Zet hem dus niet aan zonder eerst op een
     telefoon te kijken hoe die twee samen uitpakken; zie §6.

**Opnieuw afgewezen**
- Lees de reden letterlijk. Bij weer "Content van weinig waarde":
  - zet het opschonen van de sitemap door: kleine plaatsen zonder meldingen eruit;
  - schrijf een paar stukken onder je eigen naam, bijvoorbeeld een wekelijks "Dit weekend op de weg";
  - werk aan externe vermeldingen: een forum, NDW, lokale pers.
- Wacht minstens 4 weken met de volgende aanvraag.

---

## 6. Meer opbrengst uit dezelfde bezoekers (16 november 2026)

**Meting op de eerste dag** (AdSense → Rapporten → Vandaag, 16 nov ±21:00; kleine steekproef):
85 paginaweergaven, 71 vertoningen, € 0,03, pagina-RPM € 0,39, RPM per vertoning € 0,46 en
**zichtbare actieve weergave 10%**. Negen van de tien advertenties zijn dus niet gezien.

**Oorzaak.** Elke tekstpagina had één blok, onder de hele lijst met meldingen. Gemeten op een
telefoon (375 × 812): /plaats/maarssen/ 3.560 px diep (4 schermen), /weg/a2/ 8.080 px (10
schermen), /gemeente/s-hertogenbosch/ 9.600 px (12 schermen), /plaatsen/ 21.000 px. Adverteerders
betalen voor advertenties die gezien worden.

**Wat er veranderd is (branch `claude/adsense-revenue-optimization-4192cb`).**

| Plek | Waar | Gedrag |
|---|---|---|
| `top` op weg-, plaats- en brugpagina's | Telefoon: tussen het kaartje en de lijst (±2e scherm). Breed scherm: een rij boven kaart en lijst | Staat er vanaf het begin, met vaste hoogte: niets verspringt |
| `side` op dezelfde pagina's | Alleen op een breed scherm (vanaf 1.024 px): rechts naast `top`, in dezelfde rij | Idem. Eén breed vak kreeg meestal één rechthoek met lege ruimte ernaast; twee vakken zijn twee advertenties op dezelfde hoogte. Heeft Google er voor één geen advertentie, dan krijgt de andere de hele rij |
| `top` in gidsen en de veelgestelde vragen | Tussen twee hoofdstukken, na ongeveer één scherm lezen | Idem. Niet op privacy, cookies, disclaimer, colofon en contact |
| `feed` op dezelfde pagina's | Alleen op één kolom (telefoon, tablet): in de lijst met meldingen, na de eerste 12 rijen, tussen twee kaarten. Alleen als er daarna nog minstens 4 rijen volgen; nooit in een ingeklapte groep | Opent pas als de lezer er één scherm vandaan is. Blijft staan als de lijst opnieuw wordt opgebouwd (ander voertuig, andere dag): `ui/entity-list.ts` bouwt de lijst om het vak heen |
| `article` (bestond al) | Onder de lijst en de vragen, of onder de tekst | Opent pas als de lezer er één scherm vandaan is. Wie er niet komt, laadt hem niet |

Regels die in de code vastliggen (`web/src/ui/ads.ts`, `web/src/ui/ad-lazy.ts`):

- Nooit een advertentie boven het antwoord. De bezoeker krijgt eerst te zien of hij erdoor kan.
- Nooit twee advertenties onder elkaar in beeld: het onderste blok opent alleen met minstens één
  schermhoogte pagina ertussen (op een korte brugpagina blijft het dus weg). Op een telefoon is er
  dus nooit meer dan één tegelijk te zien; op een breed scherm staan er twee naast elkaar in één rij.
- Geen advertenties op lege pagina's en op pagina's die uit Google zijn (ongewijzigd). Op de
  kaart staat sinds 23 november één blok, in een geopende melding (§7); nooit over de kaart zelf.
- Geen eigen "meeschuivende" advertentie. Op een breed scherm schuift het kaartje mee; daarom
  staat het blok daar boven kaart en lijst, niet in de kaartkolom. Google's hulppagina's noemen
  zelfgebouwde meeschuivende blokken niet als toegestaan.
- Pas laden bij nadering staat niet in Google's lijst van toegestane codewijzigingen, en ook niet
  bij de verboden technieken (hulppagina's 1354736 en 1346295, gelezen 16 nov). De
  advertentiecode zelf blijft ongewijzigd; alleen het moment van aanvragen verschuift. Het vak
  bevat tot dat moment geen advertentiecode, dus er wordt niets verborgen.

**Wat je ervan mag verwachten.** Geen belofte: de eerste dag is te kort om op te rekenen. Het doel
is dat de zichtbaarheid van 10% naar ruim 50% gaat (mijn schatting, uit de plek op de pagina);
de prijs per vertoning volgt die zichtbaarheid. De bandbreedte die op 16 november is uitgezocht
voor Nederlandse sites: pagina-RPM € 0,15 (laag), € 0,80 (midden), € 2,50 (hoog). De onderkant van
€ 1 tot € 4 is met deze twee plekken haalbaar; voor meer zijn de plekken hieronder nodig, en
bezoekers die toestemming geven voor gepersonaliseerde advertenties.

**Na een week meten (rond 24 november).** AdSense → Rapporten → *Ad units*: per blok de
zichtbare actieve weergave en de RPM. Cloudflare Web Analytics: INP en CLS van de tekstpagina's
naast de week ervoor.

**Bewust geaccepteerd, wel in de gaten houden.** Heeft Google voor het bovenste vak geen
advertentie, dan klapt het vak in en schuift de lijst ±320 px omhoog. Stond het vak vroeger tien
schermen diep, nu staat het op het tweede scherm: wie binnen een paar seconden al in de lijst
leest, ziet dat verspringen. Chrome en Firefox corrigeren de scrollpositie zelf; van Safari op
oudere iPhones is dat niet zeker. Loopt de CLS van de tekstpagina's in Cloudflare op, dan is de
oplossing: de scrollpositie zelf corrigeren op het moment dat het vak inklapt (`ads.ts`).

**Nog te beslissen, in volgorde van opbrengst.**

1. **Eigen blokken voor `top` en `side`.** Nu delen alle vakken het blok "Tekstpagina onder
   antwoord" (`8500343403`). Met twee extra blokken ("Tekstpagina onder kaart" en "Tekstpagina
   onder kaart rechts", display, vierkant, responsief) en de ID's in `ads.slots.top` en
   `ads.slots.side` zie je per plek wat hij doet. Kost niets aan snelheid.
2. **Ankeradvertentie onderaan (telefoon).** Vaak de best verdienende plek, maar hij botst met
   de eigen balk onderaan ("Nu: … · Andere dag"). Eerst proberen op een telefoon; als de twee
   elkaar in de weg zitten, de eigen balk omhoog laten schuiven of de ankeradvertentie laten.
3. **Zijbalken van Google op brede schermen** (Auto ads → alleen "zijbalk"). Ze staan naast de
   pagina, niet erin, en verschijnen alleen op schermen die breed genoeg zijn.
4. **Een blok in de lijst zelf: gedaan op 16 november** (`feed`, alleen op één kolom). Gemeten
   op een telefoon: in Den Bosch stond de volgende advertentie na de bovenste op 9.990 px, nu op
   3.100 px. Een telefoon ziet daarmee hooguit drie advertenties per pagina, een breed scherm ook
   (twee naast elkaar en één onderaan).
5. **De kaart.** Sinds 23 november één blok in een geopende melding, zie §7.

**Niet doen:** vignetten (schermvullend bij doorklikken), "Automatisch optimaliseren" aanzetten
zonder die te blokkeren, advertenties verversen, of het blok boven het antwoord zetten.

---

## 7. Naar € 5 per dag (23 november 2026)

**Meting van de eerste volle week** (AdSense → Rapporten, 17 t/m 22 november, zes volle dagen):
gemiddeld **€ 1,96 per dag** bij ±1.690 paginaweergaven en ±2.660 vertoningen per dag. Pagina-RPM
€ 1,19, RPM per vertoning € 0,77, zichtbare actieve weergave 54% (was 10% op dag één).

| Apparaat | Paginaweergaven (7 d) | Pagina-RPM | Zichtbaar |
|---|---|---|---|
| Telefoon | 7.765 (74%) | € 1,02 | 51% |
| Desktop | 2.287 (22%) | € 1,78 | 61% |
| Tablet | 465 (4%) | € 1,11 | 60% |

74% van de vertoningen was gepersonaliseerd: de toestemmingsmelding kost dus weinig. Alle
inkomsten kwamen uit de eigen blokken ("Display, Handmatig").

**Waar het geld bleef liggen.** € 5 per dag bij dezelfde bezoekers vraagt een pagina-RPM van
± € 2,90; meer blokken in dezelfde tekstpagina's leveren dat niet op. Twee dingen wel:

1. Google's eigen indelingen (anker, zijbalken) stonden uit.
2. Ongeveer 700 bezoekers per dag klikken van een tekstpagina door naar de kaart (Cloudflare,
   week tot 16 november: ±1.000 echte paginaladingen van `/` per dag, waarvan ±330 als eerste
   pagina) en klikken daar samen ±10.000 keer per dag verder. Hoeveel van die klikken een melding
   openen is niet apart gemeten; de schatting is ±4.500. Daar stond geen advertentie.

**Wat Stan op 23 november heeft besloten** (drie vragen, drie antwoorden):

| Vraag | Besluit |
|---|---|
| Ankeradvertentie en zijbalken van Google | **Ja**, met de kaart uitgesloten |
| Advertentie op de kaart | **Ja**, in een geopende melding, per geopende melding |
| Vignetten (schermvullend bij doorklikken) | **Nee** |

### 7a. Auto ads: wat er aan staat (AdSense → Advertenties → Op site → potlood)

Toegepast op 23 november ±19:40; een kwartier later stond het anker al gevuld op de site.

- **Automatische advertenties: AAN.**
- Overlay-indelingen 2/3: **ankeradvertenties** aan, **zijrail-advertenties** aan (links en
  rechts), **vignetten uit**.
- Geavanceerd: *dynamische ankeradvertenties* **uit** (die veranderen van grootte); anker op
  brede schermen aan; positie **alleen onderkant**. Boven het antwoord komt dus niets.
- In-page indelingen 0/2 (banner en multiplex uit), op intentie gerichte indelingen 0/1.
- **Uitgesloten pagina's:** `wegwerkzaamhedennederland.nl` → "Alleen deze pagina". Dat is de
  kaart. Zonder die regel zou het anker over het uitschuifpaneel van de kaart komen zodra de
  kaart het AdSense-script laadt (§7b).
- *Automatisch optimaliseren* blijft **uit**.

**Het anker en de eigen balk.** Gemeten op de live site, telefoon 375 × 812: het anker is 139 px
hoog (17% van het scherm), heeft een pijltje om het in te klappen en lag over de eigen balk
"Nu: … · Andere dag". Zolang het anker onderaan staat, staat de eigen balk nu **bovenaan** het
scherm (`web/src/ui/bottom-anchor.ts`, `answer-bar.ts`): hij blijft leesbaar en de knop staat
nooit tegen een advertentie aan. Klapt de bezoeker het anker in, dan blijft er een randje staan en
blijft de balk boven. Zonder anker (adblocker, geen advertentie) staat de balk onderaan als altijd.
Tot dit live staat, ligt het anker over de balk heen.

Bij dezelfde controle gevonden en hersteld: op plaats- en gemeentepagina's (zonder wegbordje) viel
de knop "Andere dag" half buiten beeld.

### 7b. De kaart: één advertentie in een geopende melding

Eigen advertentieblok **"Kaart onder melding"**, ID `2443153207` (`ads.slots.panel`), zodat de
kaart apart in de rapporten staat (Rapporten → Ad units).

- **Waar:** in de geopende melding, onder het antwoord (oordeel, wanneer, omleiding,
  routeknoppen) en boven "Zo meldt de wegbeheerder het". Onderaan de hele melding stond het vak
  1.500 px diep in een paneel van 680 px: dan ziet niemand het. Nooit in de lijst, nooit over de
  kaart zelf. Op telefoon en breed scherm.
- **Wanneer:** pas als het vak in beeld komt (wie niet scrolt, vraagt geen advertentie aan). Het
  AdSense-script en de toestemmingsmelding laden pas bij de eerste geopende melding; wie alleen
  de kaart bekijkt, laadt niets van Google.
- **Een nieuwe advertentie** alleen als de bezoeker zelf een andere melding opent, en hooguit
  één keer per 30 seconden (`RENEW_AFTER_MS` in `web/src/ui/panel-ad.ts`). Nooit op een timer.
- **Terug naar de lijst:** de advertentie gaat uit de pagina (niet verborgen: AdSense verbiedt
  het verbergen van een blok). Wie binnen 30 seconden een volgende melding opent, ziet daar geen
  advertentie.

**Het beleidsrisico, eerlijk.** Google's regel (hulppagina 1346295, gelezen 23 november):
verversen mag niet "zonder dat de gebruiker om een verversing vraagt". Over sites die zonder
herladen van pagina wisselen, zoals deze kaart, zeggen de hulppagina's niets: niet toegestaan en
niet verboden. De redenering hier: een melding is een eigen pagina (eigen adres, titel en tekst)
en de bezoeker vraagt er zelf om. Dat is gangbaar, maar staat nergens zwart-op-wit. Komt er een
beleidsmelding over dit blok (Beleidscentrum), zet dan `ads.slots.panel` op `""`: het blok is
weg en de rest blijft werken. Wil je het zekere voor het onzekere: zet `RENEW_AFTER_MS` op een
heel groot getal, dan blijft het bij één advertentie per kaartbezoek.

**De teksten op de site** zeiden op vijf plekken "geen advertenties op de kaart". Aangepast:
colofon, cookies, over, privacy (twee plekken), plus een regel in het logboek (wijzigingen).

### 7c. Wat je ervan mag verwachten

Schattingen, geen beloftes; ze zijn van vóór de eerste meting.

| Bron | Per dag |
|---|---|
| Nu (eigen blokken op tekstpagina's) | € 2,00 |
| Anker en zijbalken | + € 0,80 tot € 1,20 |
| Kaart, per geopende melding | + € 1,00 tot € 2,00 |
| Samen | **€ 3,80 tot € 5,20** |

December helpt (adverteerders betalen meer tot ±20 december), januari valt altijd terug. De rest
moet uit meer bezoekers komen: Search Console groeide in november 6 tot 8% per week.

**Meten op 30 november** (een week na het aanzetten):

1. AdSense → Rapporten → *Ad formats*: wat anker en zijbalk opleveren naast "Display, Handmatig".
2. Rapporten → *Ad units* → "Kaart onder melding": vertoningen, zichtbaarheid, RPM. Ligt de
   zichtbaarheid onder de 40%, dan staat het vak te diep.
3. Cloudflare Web Analytics: INP en CLS van `/` (de kaart laadt nu het AdSense-script zodra een
   melding opengaat) en van de tekstpagina's (het anker), naast de week ervoor.
4. Cloudflare: paginaweergaven en bezoekduur van de kaart. Zakken die, dan kost de advertentie
   meer dan hij oplevert.
5. Beleidscentrum: moet leeg blijven.

**Nog niet gedaan, in volgorde van opbrengst.**

1. Vignetten: het meeste per stuk (schatting + € 0,50 tot € 1,50 per dag), het hinderlijkst.
   Alleen als € 5 na de meting nog buiten bereik is, en dan met de laagste frequentie.
2. Het blok `feed` ook op brede schermen, en een tweede `feed` verderop in lange lijsten
   (samen + € 0,10 tot € 0,30 per dag).
3. Eigen blokken voor `top`, `side` en `feed`, zodat elke plek apart in de rapporten staat.
4. Meer bezoekers: de A-wegpagina's (70.900 vertoningen in Google per 28 dagen, 1,5% klikt door).

**Staat los hiervan, wel doen:** AdSense meldt "Er geldt momenteel een betalingsstop omdat u uw
adres moet bevestigen". Google stuurt een brief met een pincode; zonder die code wordt er niet
uitbetaald (Betalingen → Verificatie).
