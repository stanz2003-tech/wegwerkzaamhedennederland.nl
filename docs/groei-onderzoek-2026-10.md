# Groei-onderzoek Wegwerk: SEO, concurrenten en social (20 oktober 2026)

Doel: meer kliks, alleen voor wegwerkzaamheden.

**Bronnen:**
- Google Search Console: 3 t/m 18 oktober.
- Live HTML van 29 pagina's.
- De broncode.
- Google-zoekresultaten (google.nl, momentopname 20-10).
- Sitemaps en pagina's van concurrenten.

**Methode:** de skill `seo-audit` uit [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills), met 55.600 sterren de populairste marketing/SEO-skill op GitHub. Daarbij ook de onderdelen title-tags, rankings-push, programmatic-seo, schema en ai-seo.

---

## 1. In het kort

1. **De site staat al goed op lokaal niveau en slecht op landelijk niveau.**
   - Gemeente- en plaatspagina's: 7–8% van de mensen die ze in Google zien klikt erop. Den Bosch haalt 20%, Lexmond 41%.
   - Snelwegpagina's: 0,3–2,5%.
   - Op "wegwerkzaamheden" sta je op plek 28. Op "wegwerkzaamheden a2" sta je niet in de top 9.
2. **Google ziet je belangrijkste inhoud niet in de HTML.** De meldingen en het antwoord op "Kan ik erdoor?" komen er pas na JavaScript bij. In de HTML staat zelfs een verborgen tekst "Geen meldingen voor Eindhoven…". Dit is waarschijnlijk de hoofdreden dat maar ~700 van de ~3.900 pagina's in Google staan.
3. **Pagina's vallen elke dag in en uit Google.** Een pagina gaat op noindex zodra er die dag geen werk is. /plaats/lexmond/ staat er vandaag uit, terwijl het een toppagina is.
4. **De titels zijn te lang (76–89 tekens) en worden afgekapt of door Google herschreven.** In de zoekresultaten staat dan "Wegwerkzaamheden A12 - WEGWERK Nederland".
5. **De gevaarlijkste concurrent is niet LiveTrafik, maar Verkeer.app**, van de maker van Rijden de Treinen. Die doet nu al wat wij missen: "dit weekend" in de title, een dynamische telling in de beschrijving ("Dit weekend 4 afsluitingen op de A2") en gratis widgets voor andere sites.
6. **Ons unieke punt is "Kan ik erdoor?" per voertuig en per datum.** Niemand anders heeft dat. Het moet alleen ook zichtbaar zijn voor Google en voor AI-antwoorden.

---

## 2. Wat Search Console laat zien (3–18 okt)

Totaal: **3.620 kliks**, 62.100 vertoningen, CTR 5,8%, gemiddelde positie 7,7.

| Paginatype | Kliks | Vertoningen | CTR |
|---|---|---|---|
| Gemeente | 1.816 | 26.520 | **6,8%** |
| Plaats | 1.352 | 17.048 | **7,9%** |
| Weg | 336 | 14.298 | **2,3%** |
| Brug | 58 | 2.349 | 2,5% |
| Home + lijsten | 71 | 4.467 | 1,6% |

**De grootste lekken: veel vertoningen, bijna geen kliks**

| Pagina | Vertoningen | Kliks | CTR | Positie |
|---|---|---|---|---|
| /weg/a15/ | 1.669 | 11 | 0,7% | 10,9 |
| /afsluitingen/ | 1.620 | 31 | 1,9% | 13,9 |
| /weg/a28/ | 1.127 | 28 | 2,5% | 8,6 |
| /weg/a16/ | 1.102 | 13 | 1,2% | 9,4 |
| /weg/a2/ | 1.038 | **3** | 0,3% | 8,7 |
| /gemeente/amsterdam/ | 878 | 18 | 2,1% | 8,3 |
| /weg/a12/ | 836 | 6 | 0,7% | 13,2 |
| /weg/a27/ | 808 | 4 | 0,5% | 12,6 |
| / (home) | 770 | 13 | 1,7% | 28,7 |
| /vandaag/ | 756 | 9 | 1,2% | 17,3 |
| /dit-weekend/ | 604 | 6 | 1,0% | 13,2 |

**Ongeveer 90% van de kliks komt via long-tail-zoekopdrachten,** vaak op een straatnaam ("lakerveld afgesloten": 73% CTR; "west vlisterdijk afgesloten": 104 vertoningen). Er wordt ook gezocht op de naam van een concurrent: "van a naar beter a28" had 101 vertoningen.

---

## 3. Concurrenten

| Wie | Wat ze sterk doen | Zwak punt / wat wij beter kunnen |
|---|---|---|
| **Rijkswaterstaat** (rijkswaterstaat.nl, rwsverkeersinfo.nl, vananaarbeter.nl) | Staat bovenaan in elke zoekopdracht. Eén nieuwsartikel per grote afsluiting, met de datum in titel en URL. Feitenblok per weg. | rwsverkeersinfo is een JavaScript-app zonder H1 of canonical; ze ranken alleen op autoriteit. Geen antwoord per voertuig. Social is een tekstbot (Bluesky: 3.250 volgers, 0–1 likes per bericht). |
| **ANWB** | Duidelijke lijst met "Dicht. Van 21 okt 21:00 tot …". Stuurt door naar de Onderweg-app voor alerts. | Geen meta-description en geen canonical. Verkeer is niet hun core op social. |
| **Verkeer.app** (Calips BV, maker van Rijden de Treinen) | Title "Wegwerkzaamheden A2 – dit weekend en de komende weken". Dynamische beschrijving: "Dit weekend 4 afsluitingen op de A2". Duur per afsluiting. Gratis feeds en widgets (backlinks). Rankt al #4 op "wegwerkzaamheden a58". | ±1.200 pagina's, alleen wegen en files: **geen gemeente- of straatniveau**. Social-bot: 10 volgers na 644 posts. |
| **LiveTrafik** (livetrafik.com, Zweeds, 23 landen); **dit is de "Live Traffic" die je bedoelde** | Grote schaal: ±4.270 NL-URL's (provincie × gemeente × type), camera's, ongevallen, statistiek per weg, nieuwsblok. Rankt #4 op Den Bosch en Tilburg, #9 op Utrecht. | Sjabloontitels ("Wegwerkzaamheden op A2 — LiveTrafik"). De lijst zegt niets: geen locatie, richting of datum. Geen weekendoverzicht. Geen social, geen app. |
| **isdetunnelopen.nl** | Pagina's per zoekintentie: "afsluitingen-a12-vandaag", "werkzaamheden-…-vandaag". Rankt op "vannacht" en "brugopeningen". | Klein (474 URL's). |
| **Regionale media + Facebook** (Omroep Brabant, AD/BD, ZLV …) | Artikel per afsluiting. Facebook-posts met 110–260+ reacties staan zelf in Google. | Geen data; elk bericht is handwerk. |
| **Gemeenten/provincies** (utrecht.nl, s-hertogenbosch.nl, brabant.nl, Andes-portaal) | Lokale autoriteit. | Versnipperd: elke gemeente anders. |
| **Bruggen** (brugopen.nl, isdebrugopen.nl) | Browsermeldingen bij brugopening. | Alleen bruggen. |
| **Apps** (Flitsmeister, Waze, Google Maps) | Concurreren om de gebruiker, niet om de klik. | – |

**Wat het AI-overzicht van Google zegt:** het verschijnt bij bijna elke zoekopdracht en citeert vrijwel altijd RWS. Voor "is de a2 dicht dit weekend" zei het "geen grote weekendafsluiting gepland", terwijl er wel afsluitingen van een volledige rijbaan waren. Hier ligt een kans voor een site met een bronvast antwoord van één zin.

**Wat mensen vragen** (uit "Mensen vragen ook" en autocomplete): is de A2 dicht vandaag/vanavond/morgen/dit weekend, hoe lang is de A2 dicht, is de A12 weer open, welk deel van de A2 is dicht, welke wegen zijn dicht in Brabant, wegwerkzaamheden dit weekend Breda/Rotterdam/Utrecht/Den Haag, omleiding Merwedebrug, brugopening Haringvlietbrug vandaag.

---

## 4. Actieplan, gerangschikt op extra kliks per uur werk

### Fase 1: snelle winst (1–2 dagen werk, effect binnen 2–4 weken)

1. **Nieuwe titels en beschrijvingen** (patroon: zoekterm vooraan, ≤60 tekens, reden om te klikken):

   | Pagina | Nu | Voorstel |
   |---|---|---|
   | /weg/a2/ | Wegwerkzaamheden A2 – actuele werkzaamheden, afsluitingen en files \| Wegwerk (76) | **A2 afsluitingen & werkzaamheden: vandaag en dit weekend** |
   | /gemeente/eindhoven/ | Wegwerkzaamheden gemeente Eindhoven – alle werkzaamheden en afsluitingen \| Wegwerk (82) | **Wegwerkzaamheden Eindhoven: wat is nu dicht?** |
   | /gemeente/s-hertogenbosch/ | … (89) | **Wegwerkzaamheden Den Bosch: wat is nu dicht?** ("Den Bosch" staat nergens op de site) |
   | /afsluitingen/ | Actuele wegafsluitingen in Nederland – nu en komende 30 dagen \| Wegwerk | **Wegafsluitingen Nederland: welke wegen zijn nu dicht?** |
   | /dit-weekend/ | Wegwerkzaamheden en afsluitingen dit weekend in Nederland \| Wegwerk | **Afsluitingen dit weekend (23–26 okt): wat is dicht?** |
   | /vandaag/ | … | **Wegwerkzaamheden vandaag (di 20 okt): wat is dicht?** |
   | / | … (83) | **Wegwerkzaamheden Nederland – live kaart met afsluitingen** |

   Beschrijvingen: begin met de vraag ("Is de A2 dicht?"), geef het traject ("Luik – Empel") en eindig met "Elk kwartier bijgewerkt". Later met een telling, zoals bij Verkeer.app. Gebruik ook aliassen: Den Bosch, Den Haag.
2. **robots.txt:** voeg `Disallow: /*?c=` en `/*?b=` toe. Nu linkt elke pagina naar unieke kaart-URL's: ruim 4.000 varianten van de homepage waar Google zijn crawltijd aan besteedt.
3. **Afbeelding voor delen (og:image, 1200×630):** nu ziet iemand die een link deelt via WhatsApp of Facebook geen plaatje. Dit is ook nodig voor social.
4. **Op de homepage een blok "Drukst bezocht"** met de top 12 gemeenten en wegen. Nu linkt de home naar maar 2 wegen en geen enkele gemeente.

### Fase 2: de grote hefboom (enkele dagen werk)

5. **Meldingen en het "Kan ik erdoor?"-antwoord in de HTML zetten.** Dit is de belangrijkste verbetering voor indexatie en voor AI-antwoorden. Concreet: per pagina de antwoordzin, het aantal meldingen en de eerste 10–20 meldingen (straat, periode, soort) als echte tekst. Haal ook de verborgen tekst "Geen meldingen voor …" weg. Het kan op twee manieren:
   - een kleine Cloudflare-functie die de data-JSON in de pagina zet; dat blijft gratis binnen het Free-plan;
   - een dagelijkse momentopname met tijdstempel.
6. **Noindex niet meer elke dag laten meewisselen.** Zet een pagina pas op noindex na bijvoorbeeld 60 dagen zonder meldingen, en nooit als die pagina kliks krijgt in Search Console. Beter nog: laat een lege pagina de dichtstbijzijnde hinder tonen.
7. **Dubbele plaats- en gemeentepagina's opruimen.** /plaats/eindhoven/ concurreert met /gemeente/eindhoven/. Bij 76 gemeenten tonen beide precies hetzelfde. Kies één eigenaar en geef de andere een canonical of redirect. Dit verklaart deels de lage CTR in Eindhoven en Amsterdam.
8. **Een vraagblok bovenaan elke wegpagina**, met per vraag één dynamische zin:
   - Is de A2 vandaag dicht?
   - Vannacht?
   - Dit weekend?
   - Hoe lang nog?

   Het sluit één-op-één aan op "Mensen vragen ook" en kan door AI geciteerd worden.
9. **Interne links:** op een wegpagina "Gemeenten langs de A2", op een gemeentepagina "Wegen in deze gemeente", en "andere wegen" kiezen op ligging in plaats van op nummer.

### Fase 3: nieuwe zoekverkeer-bronnen (weken)

10. **Pagina's voor grote, benoemde afsluitingen**, zoals Merwedebrug (A27), A59 Hooipolder, A12 Lunetten–Veenendaal: omleidingskaart, datums en "Kan ik erdoor?" per voertuig. Nu ranken daar dunne nieuwsberichten van RWS en regionale media.
11. **Regionale weekendpagina's**, bijvoorbeeld "Dit weekend dicht in Brabant/Utrecht/Rotterdam/Den Haag", want die staan in de autocomplete.
12. **Gratis widget of embed voor gemeenten, dorpssites en lokale media** ("hinder in jouw gemeente"). Dat levert backlinks en naamsbekendheid op; Verkeer.app doet dit al.
13. **Straatniveau:** een groot deel van de kliks komt al van straatnamen. Zorg dat straatnamen als tekst in de HTML staan (zie punt 5).
14. **Vertrouwen (E-E-A-T):** de bronvermelding (NDW) is goed, maar de uitgever is anoniem. Zet op /over/ minimaal je stad en later een KvK-nummer, en een zin over hoe je de data controleert. Dat helpt ook bij AdSense.
15. **Later:** alerts per weg of gemeente (e-mail of webpush) voor terugkerende bezoekers. Doet de ANWB al; het kost wel meer werk.

**Meten:** verander één patroon tegelijk, noteer de cijfers van 12–18 oktober als nulmeting en beoordeel na 3–4 weken.

---

## 5. Social media campagne

**Het gat:**
- RWS en Verkeer.app plaatsen automatische tekstberichten die bijna niemand liket.
- ANWB en Flitsmeister maken merkcontent, geen weekendplanning.
- Bij regionale omroepen en lokale Facebook-pagina's zit het engagement: 110–260+ reacties op één weekendafsluiting.
- Niemand combineert data met een deelbaar beeld.

**Voorstel:**
1. **Vast format "Dit weekend dicht", elke donderdagavond.** Een Instagram-carrousel, een TikTok/Reel van 20 seconden en een Facebook-post. Inhoud: een kaartje per regio met de 3–5 grootste afsluitingen, plus "Kan ik erdoor met auto/vrachtwagen/fiets?". Link met UTM naar de weg- of regiopagina.
2. **WhatsApp-kanaal "Wegwerk – dit weekend dicht":** één bericht per week, plus een extra bericht bij grote afsluitingen. Bij concurrenten niet gevonden.
3. **"Zo rijd je om"-video's** kort voor grote afsluitingen (Merwedebrug, A59).
4. **Lokale Facebook-groepen en lokale media** de kaart of widget aanbieden. Zij hebben de reacties, wij hebben de data.
5. **Niet doen:** een bot die automatisch alleen tekst post. Verkeer.app heeft daarmee 10 volgers na 644 posts.
6. **Eerst nodig:** de deelafbeelding (og:image) en sociale profielen in het schema (`Organization.sameAs`).

---

## 6. Nog na te gaan

- **Search Console → Pagina's → "Gevonden – niet geïndexeerd":** zitten daar vooral `?c=`-URL's en plaatspagina's?
- **Core Web Vitals:** de PageSpeed-API had vandaag geen quotum meer.
- **Cloudflare:** GPTBot en ClaudeBot krijgen 403, zoekcrawlers van OpenAI en Perplexity krijgen 200. Controleer in Cloudflare of "Block AI bots" bewust zo staat.
- **Volgersaantallen** van RWS en ANWB op X, Instagram en Facebook konden niet worden opgehaald.

Ruwe data (HTML van de pagina's, analyses) staat in de scratchpad van deze sessie. De codeverwijzingen per verbetering (bestand en regel) staan in het volledige SEO-auditverslag in deze sessie.
