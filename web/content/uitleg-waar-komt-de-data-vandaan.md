---
slug: uitleg-waar-komt-de-data-vandaan
layout: static
title: Waar komt de data vandaan? NDW, Melvin en DATEX II
description: Hoe wegwerkzaamheden van de wegbeheerder via Melvin en het NDW op Wegwerk komen, hoe vers de gegevens zijn, wat er ontbreekt en hoe we controleren of het oordeel klopt.
heading: Waar komt de data vandaan?
kicker: Uitleg
lead: Wegwerk maakt zelf geen verkeersinformatie. Alles wat je op de kaart ziet, komt van de Nederlandse wegbeheerders, via een vaste route van open data. Hier lees je welke route dat is, hoe vaak we de gegevens ophalen, wat er niet in zit en hoe we controleren of wat we ervan maken klopt.
published: 2026-10-25
updated: 2026-10-25
---

## Van wegbeheerder naar kaart

In Nederland zijn honderden wegbeheerders: Rijkswaterstaat voor de snelwegen en een deel van de N-wegen, de twaalf provincies voor de provinciale wegen, ruim 340 gemeenten voor de straten en wegen binnen hun grenzen, en waterschappen voor een deel van de wegen op het platteland. Al die organisaties melden hun werkzaamheden, afsluitingen en evenementen in hetzelfde systeem: **Melvin**. Daarin stemmen ze ook onderling af, zodat bijvoorbeeld de omleiding van de ene afsluiting niet over een weg loopt die een andere wegbeheerder net heeft opgebroken.

Het **Nationaal Dataportaal Wegverkeer (NDW)** verzamelt die meldingen, samen met de actuele gegevens van Rijkswaterstaat, en publiceert ze als open data in het Europese formaat **DATEX II**. Dat is een uitgebreid XML-formaat waarin per maatregel staat welke weg, welk stuk, welke rijstroken, welke voertuigen, welke periode en welke omleiding. Wegwerk gebruikt drie bestanden van NDW:

- **De planning van wegwerkzaamheden en evenementen** — alles wat in Melvin is aangemeld, van groot onderhoud aan een snelweg tot een straatfeest. Dit is het grootste bestand: ongecomprimeerd ruim tweehonderd megabyte.
- **Het actuele verkeersbeeld** — wat er op dit moment op de weg gebeurt: rijstrookafzettingen, afsluitingen, snelheidsbeperkingen, files, ongevallen, obstakels en brugopeningen.
- **De planning van brugopeningen** — de openingen van beweegbare bruggen die de beheerders vooraf aanmelden.

Een automatisch proces haalt die bestanden op, leest elke maatregel, zoekt bij elke melding de weg, de plaats en de gemeente erbij en zet het geheel om naar compacte bestanden die de kaart snel kan laden. Er zit geen handmatige stap tussen.

## Hoe vers zijn de gegevens?

Het **actuele beeld** — files, incidenten, brugopeningen en de afzettingen van dit moment — halen we elke {{refreshMinutes}} minuten op. De **planning** van wegwerkzaamheden vernieuwt NDW ongeveer elk kwartier; die verwerken we dus ook ongeveer elke {{planningMinutes}} minuten. Het tijdstip van de laatste update staat bovenaan de kaart en op elke pagina.

Lukt het ophalen een keer niet, dan blijft de vorige versie staan. Komt het actuele beeld langer dan een halfuur niet binnen, dan zie je bovenaan een melding dat de gegevens niet actueel zijn. Een aparte bewaking start het proces opnieuw als het onverhoopt stilvalt.

Daarnaast telt hoe snel de wegbeheerder zelf is. Een file of ongeval staat er binnen minuten in. Een wijziging in de planning van een groot project kan dagen duren voordat de wegbeheerder hem invoert, en gemeentelijk werk staat soms pas kort van tevoren in het systeem.

## Wat er niet in zit

De gegevens zijn uitgebreid, maar niet compleet:

- **Kleine, korte klussen** hoeven niet altijd te worden gemeld, zoals een nutsbedrijf dat een paar uur een parkeerstrook gebruikt.
- **Werk op particulier terrein**, op bedrijventerreinen en bij spoorwegovergangen van ProRail zit er meestal niet in.
- **Werktijden** staan niet altijd als losse tijdvakken in de gegevens; soms alleen in de beschrijving. Dan telt een melding de hele periode mee.
- **De werkelijkheid ter plaatse.** De gegevens zeggen wat er gepland is. Is het werk eerder klaar of loopt het uit, dan zie je dat pas als de wegbeheerder de melding aanpast.

Daarom blijven de borden langs de weg en de aanwijzingen van verkeersregelaars altijd leidend.

## Wat Wegwerk toevoegt

Wegwerk verandert niets aan de meldingen zelf. We voegen drie dingen toe:

1. **Plaats en weg.** Veel meldingen op snelwegen hebben alleen een code uit de landelijke locatietabel (VILD). Die vertalen we naar een wegnummer, de namen van begin- en eindpunt en een richting, zoals "A2 Utrecht → Amsterdam". Voor andere meldingen zoeken we via de Locatieserver van PDOK (Kadaster) de straat, de woonplaats en de gemeente erbij.
2. **Het oordeel.** Uit alle velden van een maatregel maken we één antwoord per voertuig en per moment: weg dicht, rijbaan dicht, doorrijden mogelijk of geen hinder. Hoe je dat leest, staat in [zo lees je een melding](/uitleg/meldingen-lezen/).
3. **Samenhang.** Een groot project bestaat in de gegevens vaak uit tientallen losse maatregelen: per rijbaan, per nacht, per afrit. We bundelen die tot één melding met het zwaarste oordeel, zodat je niet twintig keer hetzelfde ziet.

## Hoe we controleren of het klopt

Een oordeel als "doorrijden mogelijk" is alleen iets waard als je erop kunt vertrouwen. Daarom controleren we het werk van de software op een paar manieren:

- **Een onafhankelijke controle.** In september hebben we het oordeel van de site op 27 momenten naast een strikte lezing van de ruwe DATEX-gegevens gelegd, voor elke melding in de planning: ruim 130.000 controles. De vraag was steeds: zegt Wegwerk "je kunt erdoor" waar de gegevens de weg voor auto's afsluiten? Na de verbeteringen van eind september was het antwoord nergens ja. Latere wijzigingen hebben oordelen alleen strenger gemaakt, nooit milder; ook dat controleren we bij elke wijziging aan het oordeel.
- **Tekst tegen gegevens.** Bij elke update vergelijken we het oordeel met wat de wegbeheerder zelf schrijft. Staat er in de tekst dat de weg dicht is, dan wordt het oordeel nooit milder dan dat. Spreken tekst en gegevens elkaar tegen, dan laten we dat zien bij de melding.
- **Fouten die we vinden, herstellen we.** Zo ontdekten we in oktober dat bij een deel van de meldingen op snelwegen de richting omgedraaid stond; dat is op 12 oktober hersteld en met een aparte controle bewezen. Een overzicht van zulke verbeteringen staat op [wijzigingen](/wijzigingen/).

Zie je toch iets wat niet klopt? Een fout in de melding zelf kan alleen de wegbeheerder herstellen; bij elke melding staat wie dat is. Ziet een melding er bij ons anders uit dan bij de bron, [mail ons dan](/contact/).

## Licenties en bronvermelding

De verkeersgegevens van NDW zijn open data onder de CC0-verklaring: iedereen mag ze gebruiken. De achtergrondkaart is de BRT Achtergrondkaart van het Kadaster (CC BY 4.0), geleverd via PDOK. De volledige lijst van bronnen, software en licenties staat in het [colofon](/colofon/). Wegwerk is geen officiële website van NDW, Rijkswaterstaat of een andere wegbeheerder.
