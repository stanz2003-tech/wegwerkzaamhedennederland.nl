---
slug: colofon
layout: static
title: Colofon – uitgever, bronnen en licenties
description: Wie Wegwerk uitgeeft en welke bronnen en software erin zitten: open data van NDW (CC0), de BRT Achtergrondkaart van het Kadaster (CC BY 4.0) en MapLibre.
heading: Colofon
kicker: Over deze site
lead: Wegwerk is gebouwd op open data en open source. Hieronder staat wie de site uitgeeft en welke bronnen, software en diensten erin zitten, met de voorgeschreven bronvermelding.
updated: 2026-09-08
---

## Uitgever

{{site.longName}} ({{site.name}}, {{site.url}}) wordt gemaakt en uitgegeven door **{{site.owner.name}}**, gevestigd te {{site.owner.city}}. Je bereikt de uitgever via [{{site.contactEmail}}](mailto:{{site.contactEmail}}); zie ook de [contactpagina](/contact/). Zodra de site is ingeschreven bij de Kamer van Koophandel staan hier het KvK- en btw-nummer.

Wegwerk is een particulier initiatief en geen officiële website van Rijkswaterstaat, NDW, een provincie of een gemeente. Lees ook de [disclaimer](/disclaimer/).

## Bronvermelding

De verkeersinformatie en de kaart komen van de volgende bronnen. De bronvermelding staat ook, verkort, op elke kaart: *{{site.attribution}}*.

- **Verkeersdata:** Nationaal Dataportaal Wegverkeer (NDW), open data (CC0) — [https://opendata.ndw.nu](https://opendata.ndw.nu). NDW is niet betrokken bij deze website en onderschrijft de inhoud niet. Beeldmateriaal van NDW (logo's, foto's, infographics) valt niet onder CC0 en wordt niet hergebruikt.
- **Achtergrondkaart:** BRT Achtergrondkaart, © Kadaster {{year}}, CC BY 4.0 — [https://creativecommons.org/licenses/by/4.0/deed.nl](https://creativecommons.org/licenses/by/4.0/deed.nl) (bron: PDOK, [https://www.pdok.nl](https://www.pdok.nl)).
- **Plaatsnamen en zoekfunctie:** PDOK Locatieserver (Kadaster), gebaseerd op de Basisregistratie Adressen en Gebouwen (BAG) en de Basisregistratie Topografie (BRT). De lijst van gemeenten en woonplaatsen op deze site komt uit dezelfde bron.
- **Wegnummers en routenamen:** de landelijke locatietabel voor verkeersinformatie (VILD), gepubliceerd door NDW.
- **Luchtfoto**, voor zover de kaart een luchtfotolaag aanbiedt: © Beeldmateriaal.nl (CC BY 4.0) via PDOK.
- **Reservekaart:** als de kaartserver van PDOK niet bereikbaar is, schakelt de kaart over op OpenFreeMap (stijl Positron). Kaartgegevens © OpenStreetMap-bijdragers, [ODbL](https://www.openstreetmap.org/copyright); tiles: [OpenFreeMap](https://openfreemap.org).

## Software en diensten

- **Kaartsoftware:** MapLibre GL JS, BSD-3-Clause — © MapLibre contributors; bevat code van mapbox-gl-js v1.13 © 2020 Mapbox. [https://maplibre.org](https://maplibre.org)
- **Iconen:** [Lucide](https://lucide.dev), ISC-licentie.
- **Lettertypen:** Overpass (Red Hat) en IBM Plex Sans en IBM Plex Mono (IBM), beide onder de SIL Open Font License 1.1, geleverd via Google Fonts.
- **Hosting en distributie:** Cloudflare (Pages en R2). Bezoekersstatistieken, als die worden bijgehouden, via Cloudflare Web Analytics, dat geen cookies plaatst en geen bezoekers volgt; zie de [privacyverklaring](/privacy/).
- **Advertenties:** Google AdSense, alleen op de tekstpagina's en alleen met toestemming voor gepersonaliseerde advertenties; zie het [cookiebeleid](/cookies/).

## Hoe de site werkt

Wegwerk is een statische website zonder database of gebruikersaccounts. Een automatisch proces haalt de open data van NDW op, zet die om naar compacte kaartbestanden en publiceert ze: files, incidenten en brugopeningen elke {{refreshMinutes}} minuten, de planning van wegwerkzaamheden ongeveer elk kwartier. De pagina's per weg, plaats, gemeente en brug worden bij elke publicatie van de site opnieuw gegenereerd uit dezelfde bronnen; de actuele meldingen erop worden in je browser geladen.

## Auteursrecht

De teksten, de vormgeving en de broncode van Wegwerk zijn © {{year}} {{site.owner.name}}, tenzij anders vermeld. De onderliggende verkeersgegevens zijn open data van NDW en de wegbeheerders en zijn niet van Wegwerk; wil je ze zelf gebruiken, haal ze dan op bij [opendata.ndw.nu](https://opendata.ndw.nu). Linken naar Wegwerk mag altijd; het insluiten van de kaart is toegestaan met zichtbare bronvermelding.
