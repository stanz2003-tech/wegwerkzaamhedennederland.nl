---
slug: over
layout: static
title: Over Wegwerk – alle wegwerkzaamheden van Nederland op één kaart
description: Wat Wegwerk is, waar de gegevens over werkzaamheden, afsluitingen en files vandaan komen, hoe vaak ze worden vernieuwd en wie de site maakt.
heading: Over Wegwerk
kicker: Over deze site
lead: Wegwerk zet alle wegwerkzaamheden, afsluitingen, omleidingen, files en incidenten van Nederland op één kaart. Gratis, zonder account en zonder app, met open data van de Nederlandse wegbeheerders.
updated: 2026-09-08
---

## Wat is Wegwerk?

Wegwerk is een onafhankelijke kaart van alles wat het verkeer in Nederland hindert of binnenkort gaat hinderen. Je ziet in één oogopslag waar op dit moment gewerkt wordt, welke wegen zijn afgesloten, welke omleidingen gelden, waar files staan en waar een ongeval of obstakel is gemeld. Per weg is er een eigen pagina, bijvoorbeeld [Wegwerkzaamheden A2](/weg/a2/), met de actuele en geplande werkzaamheden op die weg.

De site is bedoeld voor iedereen die de weg op gaat: forensen die willen weten of hun vaste route dit weekend open is, chauffeurs die een rit plannen, bezoekers van een evenement, aannemers, en bewoners die willen weten waarom er borden in hun straat staan.

## Waar komen de gegevens vandaan?

Alle verkeersinformatie komt van het **Nationaal Dataportaal Wegverkeer (NDW)**, het gezamenlijke dataportaal van Rijkswaterstaat, de provincies en de gemeenten. Wegbeheerders voeren hun werkzaamheden, afsluitingen en evenementen in via **Melvin**, het landelijke systeem voor het melden en afstemmen van wegwerkzaamheden. NDW publiceert die gegevens als open data. Wegwerk gebruikt de volgende bronnen:

- **Planning van wegwerkzaamheden en evenementen** – alle geplande en lopende werkzaamheden en afsluitingen van Rijkswaterstaat, provincies, gemeenten en waterschappen, inclusief omleidingsroutes en hindercategorie.
- **Actueel verkeersbeeld** – wat er op dit moment op de weg speelt: rijstrookafzettingen, afsluitingen, tijdelijke snelheidsbeperkingen, files, ongevallen, obstakels en brugopeningen.
- **Planning van brugopeningen** – de openingen van beweegbare bruggen die de beheerders vooraf aanmelden.

De achtergrondkaart is de **BRT Achtergrondkaart** van het Kadaster, geleverd via [PDOK](https://www.pdok.nl). De kaartsoftware is het open-sourceproject MapLibre GL JS. Alle bronnen en licenties staan in de [disclaimer](/disclaimer/).

## Hoe actueel is de informatie?

Het **actuele beeld** — files, incidenten, brugopeningen en de afzettingen van dit moment — halen we **elke {{refreshMinutes}} minuten** opnieuw op bij NDW. De **planning** van wegwerkzaamheden vernieuwt NDW ongeveer elk kwartier; die verwerken we dus ook ongeveer elke {{planningMinutes}} minuten. Het tijdstip van de laatste update staat altijd bovenaan de kaart en op elke wegpagina. Lukt het ophalen van een bron een keer niet, dan blijft de vorige versie staan en zie je een melding dat die bron tijdelijk niet is bijgewerkt.

Bedenk wel: de kaart toont wat de wegbeheerder heeft **ingevoerd**. Werk dat eerder klaar is, uitloopt of niet is gemeld, zie je hier niet of pas later. Meer daarover lees je bij de [veelgestelde vragen](/veelgestelde-vragen/).

## Wat Wegwerk niet doet

- We passen de gegevens **niet** aan, vullen ze niet aan en controleren ze niet ter plaatse. Wat de wegbeheerder invoert, is wat je ziet.
- We zijn **geen navigatiedienst**. Gebruik de kaart om je te informeren en volg onderweg altijd de borden en de aanwijzingen van verkeersregelaars.
- We slaan **geen** persoonlijke routes of locaties op. Zoekopdrachten worden alleen in je browser verwerkt.

## Onafhankelijk

Wegwerk is een particulier initiatief en **geen officiële website** van Rijkswaterstaat, NDW, een provincie of gemeente. De site wordt betaald uit advertenties, die alleen worden getoond nadat je daar toestemming voor hebt gegeven. We verkopen geen gegevens over bezoekers. Hoe we met privacy omgaan, staat in de [privacyverklaring](/privacy/) en het [cookiebeleid](/cookies/).

## Wie maakt Wegwerk?

Wegwerk wordt gemaakt en onderhouden door {{site.owner.name}}. Vragen, opmerkingen of een fout gezien? Kijk op de [contactpagina](/contact/). Fouten in de verkeersinformatie zelf meld je het snelst bij de wegbeheerder; ook dat staat daar uitgelegd.
