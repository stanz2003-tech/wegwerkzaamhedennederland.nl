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
| Site openbaar en bereikbaar voor de AdSense-crawler | **Goed** | Geen login; Cloudflare-regel daagt alleen buitenlands verkeer uit en laat geverifieerde bots door. "Google Adsense: Mediapartners-Google" en "Google-Display-Ads-Bot" staan in Cloudflare's lijst van geverifieerde bots |
| Pagina's in Google | **Goed** | 1.570 geïndexeerd (6 nov); /over/, /uitleg/, /wijzigingen/, /contact/, /privacy/ en de gidsen staan erin (URL-inspectie, 10 nov) |
| Privacyverklaring met cookies van derden en Google | **Goed** | /cookies/: cookies van Google en partners, gepersonaliseerde advertenties, uitschrijven via adssettings.google.com, link naar Google's partnerbeleid. /privacy/ noemt nu de verwerkingsverantwoordelijke bij naam |
| Door Google gecertificeerde toestemmingsmelding (EER) | **Klaar, nog niet zichtbaar** | "Europese regelgeving: 1 actief" in AdSense. Google toont de melding pas na goedkeuring (getest met `?fc=alwaysshow`). Na goedkeuring opnieuw controleren |
| ads.txt | **Goed** | `google.com, pub-2154960775763414, DIRECT, f08c47fec0942fa0`, status "Geautoriseerd" in AdSense |
| Ondersteunde taal | **Goed** | Nederlands |
| Geen ongeldig verkeer | **Goed** | Botverkeer uit China en via proxy's wordt sinds 25 okt en 2 nov uitgedaagd; er zijn nog geen advertentieblokken, dus er kan ook niet geklikt worden |
| Betaalgegevens | **Open, Stan** | Waarschuwing "Voeg uw betalingsgegevens toe" staat er nog (10 nov) |
| Data actueel | **Risico** | De keten viel op 9 nov weer stil. De bewaker staat klaar op branch `claude/data-watchdog`, maar is nog niet geïnstalleerd |
| Externe vermeldingen | **Zwak** | Nog geen links of vermeldingen gevonden |

---

## 2. Vóór de aanvraag: jouw stappen

1. **PR mergen** van branch `claude/google-adsense-prep-72b1ba`. Controleer na ±5 minuten op de live
   site: /over/ noemt "Stan Zegwaard (Almkerk)", en op een N-weg staat "Wie heeft het werk op de …
   aangemeld?".
2. **Betaalgegevens invullen** in AdSense → Betalingen → Informatie voor betalingen. Dat kan de
   beoordeling niet schaden, en na goedkeuring hoef je dan niet te wachten.
3. **Bewaker voor de data installeren** (sterk aangeraden): branch `claude/data-watchdog`, stappen in
   handleiding §7.4 op die branch. Je hebt een GitHub-token nodig en drie wrangler-commando's.
4. **Opnieuw inloggen bij Cloudflare** in Chrome (de sessie is verlopen). Kijk optioneel in Security →
   Events of er verzoeken van "Mediapartners-Google" zijn uitgedaagd; dat zou niet moeten.
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
