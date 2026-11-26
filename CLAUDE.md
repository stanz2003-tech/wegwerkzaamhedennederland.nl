# Wegwerkzaamheden Nederland: werkinstructies voor Claude

Deze site (https://www.wegwerkzaamhedennederland.nl) toont wegwerkzaamheden, afsluitingen, files en
brugopeningen uit open data van het NDW. Eigenaar: Stan. **Praat Nederlands met Stan**, kort en
zonder jargon. Hij werkt vaak vanaf zijn telefoon: hij kan dan geen commando's draaien, maar wel een
PR mergen en een workflow starten in de GitHub-app.

## Waar alles draait (niet op een laptop)

| Onderdeel | Waar | Bestand |
|---|---|---|
| Data ophalen en publiceren, elke ~10 min | GitHub Actions, workflow **Data** | `.github/workflows/data.yml`, `pipeline/` |
| Cadans: wacht 8 min, controleert, start de volgende Data-run | GitHub Actions, workflow **Wekker** | `.github/workflows/wekker.yml`, `infra/wekker/` |
| Gepubliceerde data (GeoJSON, `meta.json`) | Cloudflare R2, `https://data.wegwerkzaamhedennederland.nl/v1/` | `infra/upload-r2.mjs` |
| Website (statisch) | Cloudflare Pages, workflow **Deploy** (bij push op `web/**` en 2x per dag) | `.github/workflows/deploy.yml`, `web/` |
| Waakhond: start de keten opnieuw als die stilvalt | Cloudflare Worker `wegwerk-watchdog`, elke 5 min | `infra/watchdog/` |

Achtergrond en alle details: `infra/README.md` (techniek), `docs/handleiding.md` (installatie,
§11 problemen oplossen), `docs/spec.md`.

## Werkwijze

- Test: `npm ci` en dan `npm test`. Losse onderdelen: `node --test "infra/wekker/test/*.test.mjs"`.
  Geef `node --test` altijd een glob tussen aanhalingstekens, geen kale map.
- Schrijf eerst een test die faalt en maak hem dan groen. De bestaande tests leggen echte storingen
  vast (met datum), doe dat ook bij nieuwe.
- Werk op een branch en open een PR naar `main`. Stan merget zelf. Commits: `fix: …`, `feat: …`,
  `docs: …` enzovoort.
- `main` krijgt de hele dag commits van `github-actions[bot]` ("chore(data): update caches").
  Haal `main` opnieuw op vlak voor je pusht en rebase zo nodig.
- Wijzig `pipeline/cache/*` niet met de hand en zet nooit secrets in de repo. Secrets staan in
  GitHub (Settings → Secrets) en als Worker-secret bij Cloudflare.
- Commentaar in de code is Engels, documentatie voor Stan Nederlands.

## Storing: "de data op de site is niet actueel"

Volg deze stappen in volgorde. Alles hieronder werkt zonder token, via openbare URL's.

**1. Hoe oud is de gepubliceerde data?**

```bash
curl -s "https://data.wegwerkzaamhedennederland.nl/v1/meta.json?t=$(date +%s)" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const m=JSON.parse(d);console.log(m.generated, Math.round((Date.now()-Date.parse(m.generated))/60000)+" min oud")})'
```

Gezond is minder dan 20 minuten. De site zelf waarschuwt vanaf 30 minuten.

**2. Wat doen de workflows?** Openbare GitHub API (60 verzoeken per uur zonder token):

```bash
R=stanz2003-tech/wegwerkzaamhedennederland.nl
for wf in data.yml wekker.yml; do echo "== $wf"
  curl -s "https://api.github.com/repos/$R/actions/workflows/$wf/runs?per_page=10" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{for(const r of JSON.parse(d).workflow_runs)console.log(r.created_at,r.event,r.status,r.conclusion,r.id)})'
done
```

Jobs en logregels van één run: `.../actions/runs/<id>/jobs`.

**3. Herken het patroon:**

| Wat je ziet | Oorzaak | Wat te doen |
|---|---|---|
| Data-runs elke ~10 min, maar `conclusion` is `failure` | de pipeline faalt (NDW onbereikbaar, upload naar R2, validatie exit 2) | lees de jobs van de laatste rode run en fix de oorzaak; een extra run helpt niet |
| Wekker-runs elke ~8 min, maar al lang geen nieuwe Data-run; een oude Data-run staat op `queued` of `in_progress` | spookrun: GitHub nam een run aan en startte hem nooit (25–26 nov 2026) | sinds 26 nov negeert de wekker zo'n run na 45 min en grijpt de waakhond in na 30 min stilte. Gebeurt het toch: zoek uit waarom die regels niet gelden. **Cancel workflow** haalt zo'n run níet weg |
| Geen Data- en geen Wekker-runs meer | keten gestopt (GitHub verloor een dispatch, Actions-storing) | de waakhond start hem binnen ~25 min opnieuw. Gebeurt dat niet, dan is de waakhond zelf stuk (token verlopen?) |
| Data-runs groen en `meta.json` vers, maar de site toont oude data | cache of deploy | controleer de **Deploy**-runs en de Cloudflare-cacheregels (`infra/README.md`) |

**4. Wat een cloudsessie wel en niet kan:**

- Wel: code en tests aanpassen, een branch pushen, een PR openen, alles hierboven lezen.
- Niet: zelf een workflow starten of annuleren. Daar is een token met Actions-rechten voor nodig en
  dat staat niet in deze omgeving. Vraag Stan om dit in de GitHub-app te doen:
  **Actions → Data → Run workflow** (eventueel met "Force a full run").
- Niet: de waakhond uitrollen. Een wijziging in `infra/watchdog/` staat pas live
  na `npx wrangler@4 deploy` in `infra/watchdog/`. Dat gebeurt **niet** vanzelf bij een merge en
  vraagt een Cloudflare-login op Stans laptop. Zeg dat er altijd bij.
- Een fix in `infra/wekker/` of in de workflows is live zodra hij op `main` staat: elke nieuwe
  wekker-run checkt `main` opnieuw uit.

Sluit af met wat je zag (met tijden in UTC én Nederlandse tijd), wat de oorzaak was, wat er is
aangepast en wat Stan nog moet doen. Controleer na de merge of `meta.json` weer vers wordt.
