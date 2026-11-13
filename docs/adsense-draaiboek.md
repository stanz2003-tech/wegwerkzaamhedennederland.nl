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

**Goedgekeurd**
1. Maak **één advertentieblok** aan: Advertenties → Per advertentieblok → Display, vierkant,
   responsief. Zet het ID in `web/site.config.json` → `ads.slots.article`. Alleen dat blok bestaat
   in de templates (handleiding §10.2).
2. Controleer de **toestemmingsmelding**: open een tekstpagina met `?fc=alwaysshow` in een
   incognitovenster. De melding moet verschijnen, met knoppen om te accepteren, te weigeren en
   opties te beheren. "Cookie-instellingen" onderaan moet hem opnieuw openen.
3. Controleer na een week in Cloudflare de **snelheid (INP)** van de tekstpagina's.
4. Begin pas daarna met Auto ads of meer blokken, en houd de kaart reclamevrij.

**Opnieuw afgewezen**
- Lees de reden letterlijk. Bij weer "Content van weinig waarde":
  - zet het opschonen van de sitemap door: kleine plaatsen zonder meldingen eruit;
  - schrijf een paar stukken onder je eigen naam, bijvoorbeeld een wekelijks "Dit weekend op de weg";
  - werk aan externe vermeldingen: een forum, NDW, lokale pers.
- Wacht minstens 4 weken met de volgende aanvraag.
