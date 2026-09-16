# De wekker

Een Cloudflare Worker die één ding doet: elke tien minuten de Data-workflow op GitHub starten, en
daarna controleren of de hele keten nog werkt.

## Waarom dit bestaat

GitHub voert `schedule:`-triggers naar eigen inzicht uit. Op deze repository liet hij er bijna alles
vallen: een cron die om 288 runs per dag vroeg leverde er tussen 13 en 16 september 2026 negentien in
drie dagen, met gaten tot 5 uur en 53 minuten. Daardoor stond op elke pagina van de site dat files en
incidenten elke vijf minuten worden ververst, terwijl de gegevens gemiddeld bijna vier uur oud waren.

Cloudflare voert zijn Cron Triggers wél uit. De Worker doet zelf geen rekenwerk — hij belt de GitHub
API en de pipeline draait waar hij al draaide.

## Wat hij nog meer doet

De hartslag van de workflow bewijst alleen dat een taak groen werd. Hij ziet niet dat een deploy is
mislukt, dat de cacheregel een oude 404 uitserveert of dat een token is verlopen. Deze Worker pingt
`HEALTHCHECK_URL` daarom alleen als **alle drie** kloppen:

1. GitHub accepteerde de dispatch (HTTP 204);
2. de site antwoordt met een 200;
3. de gepubliceerde `meta.json` is jonger dan `MAX_DATA_AGE_MINUTES`.

Eén stille hartslag betekent dus: er is iets stuk in de keten — welke schakel dan ook. Dat is één
alarm in plaats van drie losse bewakingen die elk maar een stukje zien.

## Instellen

### 1. Token aanmaken (dit moet de eigenaar zelf doen)

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token.

| Veld | Waarde |
| --- | --- |
| Token name | `wegwerk-wekker` |
| Expiration | de langst mogelijke looptijd; noteer de vervaldatum |
| Repository access | Only select repositories → `wegwerkzaamhedennederland.nl` |
| Permissions | Repository permissions → **Actions: Read and write** |

Meer rechten zijn niet nodig. Met alleen dit token kan iemand de pipeline starten — niet de code
lezen, wijzigen of secrets uitlezen.

### 2. Worker uitrollen

```bash
cd infra/worker
npx wrangler login      # eenmalig, opent de browser
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN     # plak het token uit stap 1
```

Of via het dashboard: Workers & Pages → Create → Worker → naam `wegwerk-wekker` → de inhoud van
`src/index.mjs` plakken → Deploy → Settings → Variables → **Secret** toevoegen met naam
`GITHUB_TOKEN` → Settings → Triggers → Cron `*/10 * * * *`.

### 3. Controleren

Open de URL van de Worker in een browser. Hij start dan niets, maar rapporteert wat er is ingesteld:

```json
{ "worker": "wegwerk-wekker", "ingesteld": { "GITHUB_TOKEN": true, ... } }
```

Staat `GITHUB_TOKEN` op `false`, dan is het secret niet aangekomen. Daarna: kijk in de Actions-lijst
van de repository of er binnen tien minuten een run verschijnt met trigger `workflow_dispatch`.

## Kosten

Nul. Op het gratis plan: 5 cron triggers per account (we gebruiken er 1), 100.000 aanroepen per dag
(we gebruiken er 144), 10 ms rekentijd per aanroep (de Worker wacht vooral op het netwerk, en wachten
telt niet mee) en 50 subrequests per aanroep (we doen er maximaal 4).

## Onderhoud

Het enige dat slijt is het token: fine-grained tokens verlopen. Als dat gebeurt stopt de verversing,
stopt de hartslag en krijgt de eigenaar één mail van healthchecks.io. Zet de vervaldatum in
`HERSTEL.md` en vernieuw het token vóór die datum.

## Tests

```bash
node --test "infra/worker/test/*.test.mjs"
```

De tests draaien zonder Cloudflare: `runCheck()` neemt een `fetchImpl` aan, zodat het gedrag dat
ertoe doet — wanneer wél en wanneer géén hartslag — buiten de cloud te toetsen is.
