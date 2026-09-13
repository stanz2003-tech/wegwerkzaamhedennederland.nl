# Handleiding: Wegwerk eenmalig installeren

Voor de eigenaar, zonder technische voorkennis. De nummers komen overeen met de checklist in
`README.md`. Menu-namen staan in het Engels omdat de dashboards van GitHub en Cloudflare Engels
zijn. De klikpaden zijn op 8 september 2026 gecontroleerd in de officiële documentatie;
onderdelen die niet letterlijk te controleren waren zijn gemarkeerd met **(controleer)**.
Ziet een scherm er anders uit, zoek dan op de genoemde term — namen veranderen zelden helemaal.

Werkwijze: houd tijdens de installatie een **privé-notitie** bij (bijvoorbeeld in je
wachtwoordmanager) met de waarden uit de tabel hieronder. Zet ze **nooit** in een bestand in deze
map: de repository is openbaar.

| Waarde | Waar je hem vandaan haalt | Waar hij naartoe gaat |
|---|---|---|
| Domeinnaam | §2 | overal |
| Cloudflare Account ID | §4.3 | GitHub-secrets `R2_ACCOUNT_ID` en `CLOUDFLARE_ACCOUNT_ID` |
| R2 Access Key ID + Secret Access Key | §4.6 | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| Bucketnaam (`wegwerk-data`) | §4.2 | `R2_BUCKET` |
| Cloudflare API-token voor Pages | §5.2 | `CLOUDFLARE_API_TOKEN` |
| Pages-projectnaam (`wegwerk`) | §5.1 | variabele `CF_PAGES_PROJECT` |
| healthchecks.io ping-URL | §6.1 | `HEALTHCHECK_URL` |
| Data-URL `https://data.<domein>/v1/` | §4.4 | variabele `DATA_BASE` |

Vervang overal `<domein>` door je echte domeinnaam, bijvoorbeeld `wegwerkzaamhedennederland.nl`.

---

## 1. GitHub: account, repository en code publiceren

**Waarom publiek?** GitHub Actions (de "gratis computer" die elke 5 minuten de data ophaalt) is
alleen voor publieke repositories gratis en onbeperkt. Er staan geen geheimen in de code; de
wachtwoorden en tokens komen in de afgeschermde *Secrets* (§7).

1.1 **Account.** Ga naar github.com → *Sign up*. Bevestig je e-mailadres. Zet tweestapsverificatie
aan (*Settings > Password and authentication*) en bewaar de herstelcodes.

1.2 **GitHub Desktop.** Download van desktop.github.com, installeer, en meld je aan
(*File > Options > Accounts > Sign in*).

1.3 **Deze map toevoegen.** In GitHub Desktop: *File > Add local repository…* → *Choose…* →
kies de map `Wegwerkzaamheden Nederland.nl` → *Add repository*. (Je kunt de map ook op het
venster slepen. Meldt Desktop "This directory does not appear to be a Git repository", klik dan
op *create a repository here instead*.)

1.4 **Eerste commit.** Links staat het tabblad *Changes* met alle bestanden aangevinkt. Typ
onderin bij *Summary* bijvoorbeeld `Eerste versie` en klik **Commit to main**.

> **Kijk eerst of er niets groots tussen staat.** Heeft iemand de pipeline al eens op deze
> computer laten draaien, dan kan de map `pipeline/cache/last/` in de lijst staan met
> bestanden als `planning.ndjson` van tientallen megabytes. Die horen er niet in: haal het
> vinkje bij `pipeline/cache/last` weg (of verwijder de map van je schijf) vóór je commit.
> De drie kleine bestanden `pipeline/cache/etags.json`, `geocode.json` en
> `bruggen-seen.json` mógen wel mee — die heeft de pipeline nodig.

1.5 **Publiceren.** Klik bovenin op **Publish repository**. Naam: bijvoorbeeld `wegwerk`.
Haal het vinkje bij **Keep this code private** weg (anders is Actions niet gratis). Klik
**Publish repository**.

1.6 **Controleren.** Open github.com/<jouw-naam>/wegwerk. Tabblad **Actions**: links staan de
workflows *CI*, *Data* en *Deploy*. *CI* draait meteen een keer (moet groen worden). *Data* start
vanaf nu elke 5 minuten, maar meldt tot §7 netjes "not configured yet" en slaat de run over (grijs,
geen fout). *Deploy* wordt één keer rood met "Missing repository settings" — dat hoort, tot §7.

1.7 **Instelling (alleen als het nodig blijkt).** De workflow *Data* schrijft kleine
cache-bestanden terug in de repository. Faalt de stap *Commit updated caches* met "403", zet dan
*Settings > Actions > General > Workflow permissions* op **Read and write permissions** → *Save*.
Normaal is dit niet nodig, omdat de workflow zelf om die rechten vraagt.

---

## 2. Domein bestellen bij TransIP

2.1 Ga naar transip.nl → zoek `wegwerkzaamhedennederland.nl` → *Bestellen*. Maak een account en
betaal. Prijs (8 september 2026): €0,49 voor het eerste jaar, daarna €16,50 per jaar excl. btw
(één weergave toonde €14,99; controleer bij het bestellen). Cloudflare Registrar biedt geen `.nl`
aan, daarom TransIP.

2.2 Optioneel: bestel ook `wegwerkzaamheden-nederland.nl` als reservedomein/doorverwijzing.
De overige vrije namen uit `docs/onderzoek.md` §8 (`wegwerkkaart.nl`, `isdewegdicht.nl`,
`wegdicht.nl`) zijn merk- en campagneopties, niet nodig.

2.3 Controleer in het TransIP-controlepaneel dat **automatisch verlengen** aan staat
**(controleer** de plek: *Domein* → domeinnaam → instellingen/verlenging**)**. Zet een tweede
betaalmethode of herinnering in je agenda; een verlopen domein is het grootste risico.

---

## 3. Cloudflare-account en domein koppelen

3.1 **Account.** Ga naar dash.cloudflare.com/sign-up, maak een account (gratis) en bevestig je
e-mail. Zet ook hier tweestapsverificatie aan (*My Profile > Authentication*).

3.2 **Domein toevoegen.** Dashboard → **Domains** (linker menu; heet soms *Websites*) →
**Onboard a domain** (of *Add a domain*) → typ het domein zonder `www` → laat *Quick scan for DNS
records* aan **(controleer)** → *Continue* → kies het **Free**-plan → *Continue*. Op het scherm
*Review DNS records* mag de lijst leeg zijn; wat TransIP eventueel heeft aangemaakt (parkeerpagina)
mag weg. *Continue*.

3.3 **Nameservers.** Cloudflare toont nu twee nameservers in de vorm `naam.ns.cloudflare.com`.
Log in bij TransIP → **Domein** (of *Domein & Hosting*) → klik op de domeinnaam → scroll naar
**DNS instellingen** → **Nameservers** → kies eigen/andere nameservers, vul de twee van Cloudflare
in → **Opslaan**. TransIP meldt een verwerkingstijd van 4 tot maximaal 24 uur. Staat bij TransIP
DNSSEC aan, zet dat dan éérst uit **(controleer)**; anders werkt de overstap niet.

3.4 **Klaar.** Cloudflare mailt "…is now active on a Free plan" en het domein staat op *Active*.
Ga pas dan verder met §4.4 en §5.3 (subdomeinen koppelen). De rest van §4 kun je alvast doen.

3.5 **Beveiliging (aanbevolen).** Domein → *SSL/TLS* → *Overview*: **Full (strict)**.
*SSL/TLS > Edge Certificates*: **Always Use HTTPS** aan. **(controleer** standaardwaarden**)**.

3.6 **Reservedomein (optioneel).** Voeg `wegwerkzaamheden-nederland.nl` net zo toe (3.2–3.3) en
laat het doorverwijzen: domein → *Rules* → *Redirect Rules* → *Create rule* → naam `Naar
hoofddomein` → *All incoming requests* → *Dynamic* → expression
`concat("https://www.wegwerkzaamhedennederland.nl", http.request.uri.path)` → statuscode 301 →
*Deploy*. Maak voor dat domein ook een DNS-record aan (*DNS > Records > Add record*: type `A`, naam
`@`, IPv4 `192.0.2.1`, *Proxied* aan) zodat de regel iets heeft om op te reageren **(controleer)**.

---

## 4. Cloudflare R2: bucket, subdomein, CORS, token en Cache Rule

R2 is de opslag waar de pipeline elke 5 minuten de kaartbestanden neerzet. Bezoekers halen ze op
via `https://data.<domein>/v1/…`.

4.1 **R2 activeren.** Dashboard → **Storage & databases** → **R2** → *Overview* → doorloop het
scherm om R2 aan je account toe te voegen (gratis plan). Cloudflare kan hierbij om een
betaalmethode vragen **(controleer)**; binnen de gratis limieten (10 GB opslag, 1 miljoen
schrijf- en 10 miljoen leesoperaties per maand) wordt niets afgeschreven. Ons gemeten gebruik
(13 september 2026): minder dan 100 MB opslag en ≈ 820.000 schrijfoperaties per maand — per run
(≈ 8.640 per maand) veranderen ≈ 50 kernbestanden, en de 692 weg- en gemeentebestanden worden
alleen geüpload op de ≈ 2.880 runs per maand waarin de NDW-planningsfeed is veranderd (dan
≈ 135 stuks). Dat is 82 % van de gratis grens; zet in je agenda om dit één keer per kwartaal te
bekijken (*R2 > Overview*). Zit het boven ± 950.000, dan kan een ontwikkelaar de weg- en
gemeentebestanden minder vaak laten uploaden (`infra/README.md`, "R2 Class A operations").

4.2 **Bucket maken.** *R2 > Overview* → **Create bucket** → naam `wegwerk-data` (kleine letters,
cijfers en streepjes; 3–63 tekens) → *Location*: **Automatic** (kies níet *Specify jurisdiction*;
doe je dat toch met *European Union*, voeg dan in §7 het extra secret `R2_JURISDICTION` = `eu`
toe) → *Default storage class*: Standard → **Create bucket**.

4.3 **Account ID.** Op de pagina *R2 > Overview* staat rechts **Account details** met je
**Account ID** (32 tekens) en een kopieerknop. Noteer het: dit wordt zowel `R2_ACCOUNT_ID` als
`CLOUDFLARE_ACCOUNT_ID`.

4.4 **Subdomein koppelen** (pas nadat het domein in Cloudflare *Active* is, §3.4). Klik op de
bucket → **Settings** → **Custom Domains** → **Add** → typ `data.<domein>` → *Continue* →
*Connect domain*. Cloudflare maakt het DNS-record zelf aan; na een minuut staat er *Active*.
Laat *Public Development URL* (`r2.dev`) **uit** — die is beperkt in snelheid.

4.5 **CORS-regel.** De site (`www.<domein>`) haalt data van een ander subdomein
(`data.<domein>`); browsers eisen daarvoor een CORS-regel op de bucket. Bucket → **Settings** →
**CORS Policy** → **Add CORS policy** → plak:

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length"],
    "MaxAgeSeconds": 86400
  }
]
```

→ **Save**. (`*` is hier prima: het gaat om openbare open data.)

4.6 **API-token voor de pipeline.** *R2 > Overview* → **Account details** → **API tokens** →
**Manage** → **Create Account API token** (kies de account-variant als beide worden aangeboden)
→ naam `wegwerk-github-upload` → *Permissions*: **Object Read & Write** → *Specify bucket(s)*:
alleen `wegwerk-data` → *TTL*: **Forever** / geen vervaldatum **(controleer** de naam van de optie**)**
→ *Client IP Address Filtering*: leeg laten → **Create API Token**. Kopieer nu direct
**Access Key ID** en **Secret Access Key** — de Secret wordt maar één keer getoond. (Het lange
"Token value" bovenaan heb je niet nodig.) Noteer ook de getoonde endpoint-URL ter controle:
`https://<account-id>.r2.cloudflarestorage.com`.

4.7 **Cache Rule.** Cloudflare cachet JSON-bestanden standaard niet; met één regel wel, zodat
duizenden bezoekers de bestanden van Cloudflare krijgen en niet uit de bucket. Dashboard → jouw
domein → **Caching** → **Cache Rules** → **Create rule** → *Rule name* `R2 data cache` →
*When incoming requests match…*: **Custom filter expression** → *Field* **Hostname**, *Operator*
**equals**, *Value* `data.<domein>` → *Cache eligibility*: **Eligible for cache** → *Edge TTL*:
**Use cache-control header if present, bypass cache if not** → *Browser TTL*: **Respect origin** →
**Deploy**. De pipeline zet op elk bestand een `Cache-Control`-header (60 s voor live-data en
`meta.json`, 120 s voor bruggen, 300 s voor de rest), dus de cache volgt precies die tijden.

Zet daarnaast de **zone-brede** instelling **Caching → Configuration → Browser Cache TTL** op
**Respect Existing Headers**. De standaard (*4 hours*) overschrijft de `Cache-Control`-header van
elk bestand, zodat browsers `meta.json` vier uur vasthouden en de site verouderde data toont.

4.8 **Controle (na §8).** Open in de browser twee keer `https://data.<domein>/v1/meta.json`.
Ziet een ontwikkelaar in de response-headers `cf-cache-status: HIT`, dan werkt de cache.

---

## 5. Cloudflare Pages: de website

De website wordt gebouwd en gepubliceerd door de GitHub-workflow *Deploy* (optie A, aanbevolen).
Optie B laat Cloudflare zelf bouwen; kies één van de twee.

5.1 **Projectnaam kiezen.** Bijvoorbeeld `wegwerk` (kleine letters, streepjes toegestaan). Deze
naam wordt de GitHub-variabele `CF_PAGES_PROJECT` (§7) en het gratis adres `wegwerk.pages.dev`. Je
hoeft het project **niet** zelf aan te maken: de eerste *Deploy*-run doet dat.

5.2 **API-token voor Pages.** Klik rechtsboven op je profielicoon → **My Profile** → **API
Tokens** → **Create Token** → onderaan **Create Custom Token** → *Get started* → naam
`wegwerk-github-deploy` → *Permissions*: **Account** · **Cloudflare Pages** · **Edit** →
*Account Resources*: *Include* · jouw account → *Client IP Address Filtering* en *TTL* leeg laten →
**Continue to summary** → **Create Token** → kopieer het token (één keer zichtbaar) →
`CLOUDFLARE_API_TOKEN`.

5.3 **Domeinen koppelen (na de eerste geslaagde Deploy, §8.3).** Dashboard → **Workers & Pages**
→ project `wegwerk` → tabblad **Custom domains** → **Set up a custom domain** → `www.<domein>` →
*Continue* → *Activate domain* (het DNS-record wordt automatisch toegevoegd omdat het domein al bij
Cloudflare staat). Herhaal voor `<domein>` zonder `www`.

5.4 **Eén hoofdadres.** De site gebruikt `https://www.<domein>` als officieel adres (zet dit in
`web/site.config.json` → `url`, zonder slash aan het eind, §9). Stuur het adres zonder `www`
door: domein → **Rules** → *Overview* → *Templates* → **Redirect from Root to WWW** → *Deploy*
**(controleer** de plaats van de sjablonen**)**.

5.5 **Optie B: Cloudflare bouwt zelf** (alleen als je optie A niet wilt). **Workers & Pages** →
**Create application** → **Pages** → **Connect to Git** → koppel je GitHub-account en kies de
repository → *Set up builds and deployments*: *Framework preset* **None**, *Build command*
`npm run build -w @wegwerk/web`, *Build output directory* `web/dist`, *Root directory* `/`,
*Environment variables*: `NODE_VERSION` = `24` en `VITE_DATA_BASE` = `https://data.<domein>/v1/` →
**Save and Deploy**. Daarna verplicht: project → **Settings** → **Build** → **Build watch paths** →
*Include paths*: `web/*`, `pipeline/static/*`, `package.json`, `package-lock.json`. Zonder deze
lijst start elke cache-commit van de *Data*-workflow (vele per dag) een build en zijn de 500
gratis builds per maand binnen een paar dagen op. Schakel in GitHub de workflow *Deploy* uit
(*Actions* → *Deploy* → knop met drie puntjes → *Disable workflow*) en sla de secrets
`CLOUDFLARE_*` en de variabelen uit §7 over.

---

## 6. Bewaking: e-mail als er iets stilvalt

6.1 **healthchecks.io (hartslag van de pipeline).** Ga naar healthchecks.io → *Sign Up* (plan
*Hobbyist*, gratis, 20 checks). Klik **Add Check** → *Name* `Wegwerk data-pipeline` → *Period*
**10 minutes** → *Grace Time* **20 minutes** → *Save*. Kopieer de ping-URL in de vorm
`https://hc-ping.com/xxxxxxxx-xxxx-…` → dit wordt `HEALTHCHECK_URL`. Controleer onder
**Integrations** dat je e-mailadres als integratie is toegevoegd en voor deze check aan staat
**(controleer:** bij een nieuw account staat het account-e-mailadres er meestal al**)**. Zolang
de pipeline elke 5 minuten pingt is de check *up*; blijft de ping 30 minuten uit (10 + 20), dan
krijg je een e-mail "is DOWN".

6.2 **UptimeRobot (is de site bereikbaar en vers?).** Ga naar uptimerobot.com → gratis account
(50 monitors, interval 5 minuten, e-mailalerts). Maak drie monitors met **New monitor**
**(controleer** veldnamen**)**:
1. type **HTTP(s)**, URL `https://www.<domein>/`, interval 5 minuten;
2. type **Keyword**, URL `https://data.<domein>/v1/meta.json`, keyword `generated`, alarm als het
   woord **niet** aanwezig is;
3. bij monitor 1 de optie voor **domain expiration** / **SSL & Domain expiry** aan (waarschuwt
   enkele weken voor het verlopen van het domein; het exacte aantal dagen staat niet in de
   gecontroleerde documentatie en is dus niet nagemeten).
Alerts gaan naar het e-mailadres van je account.

---

## 7. GitHub-secrets en -variabelen invullen

Ga naar github.com/<jouw-naam>/wegwerk → **Settings** (tabblad rechts; staat het er niet, kijk
onder *More*) → in de zijbalk onder *Security*: **Secrets and variables** → **Actions**.

7.1 **Secrets** (tabblad *Secrets* → **New repository secret** → *Name* exact zoals hieronder →
*Secret* = de waarde → **Add secret**). Herhaal voor elke regel:

| Name | Waarde |
|---|---|
| `R2_ACCOUNT_ID` | Account ID uit §4.3 |
| `R2_ACCESS_KEY_ID` | Access Key ID uit §4.6 |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key uit §4.6 |
| `R2_BUCKET` | `wegwerk-data` |
| `HEALTHCHECK_URL` | ping-URL uit §6.1 |
| `CLOUDFLARE_ACCOUNT_ID` | hetzelfde Account ID als `R2_ACCOUNT_ID` |
| `CLOUDFLARE_API_TOKEN` | token uit §5.2 |
| `R2_JURISDICTION` | alleen als je in §4.2 een jurisdictie koos: `eu` |

7.2 **Variabelen** (tabblad **Variables** → **New repository variable**):

| Name | Waarde |
|---|---|
| `DATA_BASE` | `https://data.<domein>/v1/` — begint met `https://`, eindigt met `/` |
| `CF_PAGES_PROJECT` | `wegwerk` (§5.1) |

Een typefout in een naam is de meest voorkomende fout: de *Data*-workflow zegt dan "not
configured yet: missing secret(s) …" en noemt de ontbrekende naam.

---

## 8. Eerste run

8.1 **Data.** Tabblad **Actions** → links **Data** → rechts **Run workflow** → *Branch* `main` →
vinkje **Force a full run** aan → **Run workflow**. Ververs de pagina en klik op de nieuwe run.
Na 1–3 minuten zijn alle stappen groen; onder *Summary* staan twee regels. Zo zien die eruit
(getallen uit een echte run, de jouwe wijken af):

```
ok planning=17446 actueel=1110 bruggen=1610 active=5505 upcoming=7787 live=498 dropped=0 geocoded=0/13876 ms=9750 rss=501MB
upload ok uploaded=52 skipped=0 removed=0 bytes=20442403 prev=none ms=100
```

De eerste regel begint bij een geslaagde run altijd met `ok`; `planning`, `actueel` en
`bruggen` zijn de aantallen meldingen uit de drie NDW-bestanden. De tweede regel zegt hoeveel
bestanden zijn geüpload (`uploaded`) en hoeveel ongewijzigd waren (`skipped`). Bij de eerste
run is dat 52 en 0; bij latere runs meestal rond de 50 en een paar overgeslagen.

8.2 **Controleren.** Open `https://data.<domein>/v1/meta.json` in je browser: je ziet tekst die
begint met `{"generated":"2026-…`. Op healthchecks.io staat de check nu op *up*.

8.3 **Deploy.** *Actions* → **Deploy** → **Run workflow** → `main` → **Run workflow**. De stap
*Ensure the Pages project exists* maakt het project aan, *Deploy to Cloudflare Pages* zet de site
op `https://wegwerk.pages.dev`. Koppel nu de domeinen (§5.3) en test `https://www.<domein>/`.

8.4 **Vanaf nu automatisch.** De *Data*-workflow draait elke 5 minuten (soms enkele minuten
later, bijvoorbeeld op het hele uur; dat is normaal). In de geschiedenis van de repository
verschijnen commits `chore(data): update caches [skip ci]` — dat zijn de kleine cachebestanden die
de pipeline terugschrijft, en tegelijk het teken van leven waardoor GitHub het schema niet
uitschakelt.

8.5 **Gaat iets mis?** Klik op de rode run; de mislukte stap toont de melding. Veelvoorkomend:
`Missing environment variable(s)` of `403` → §7 en §4.6; `ENOTFOUND` → `R2_ACCOUNT_ID` klopt
niet; `Validation floor not met` → NDW leverde te weinig data, wacht op de volgende run.

---

## 9. Teksten en gegevens invullen

9.1 Open `web/site.config.json` in een teksteditor (Kladblok werkt; let op de aanhalingstekens
en komma's). Vul in: `url` → `https://www.<domein>` (zonder slash aan het eind),
`contactEmail`, `owner.name` (jouw naam of bedrijfsnaam), `owner.city`; `owner.kvk` pas als je
een KvK-nummer hebt. `dataBase` laat je staan: in productie gebruikt de site de variabele
`DATA_BASE`.

9.2 Open de pagina's in `web/content/` (`over.md`, `contact.md`, `privacy.md`, `cookies.md`,
`disclaimer.md`, `veelgestelde-vragen.md`, …) en vervang de plaatsaanduidingen tussen `[…]`
(naam, plaats, e-mail). Wijzig alleen tekst, niet de regels tussen `---` bovenaan.

9.3 GitHub Desktop → *Changes* → *Summary* `Gegevens ingevuld` → **Commit to main** → **Push
origin**. De *Deploy*-workflow start vanzelf en de site is binnen ± 5 minuten bijgewerkt. Zo pas
je later ook elke tekst aan.

---

## 10. Later: analytics en advertenties

10.1 **Cloudflare Web Analytics (gratis, zonder cookies, geen banner nodig).** Dashboard →
**Analytics & Logs** → **Web Analytics** → **Add a site** → kies `www.<domein>` → *Done* →
**Manage site** → kopieer uit het JS-snippet de waarde van `"token"` (32 tekens) → in
`web/site.config.json`: `"analytics": { "provider": "cloudflare", "token": "<waarde>" }` → commit
en push (§9.3).

10.2 **Google AdSense.** Vraag pas aan als de tekstpagina's (wegen, plaatsen, uitleg) live zijn
en Google ze heeft geïndexeerd; een site met alleen een kaart wordt afgewezen
(`docs/onderzoek.md` §6.1). Er is geen minimumbezoek; wel moet de privacyverklaring Google en
advertentiecookies noemen (staat in `web/content/privacy.md`). Stappen: adsense.google.com →
aanmelden → site toevoegen → je krijgt een id `ca-pub-…`. Zet in `web/site.config.json` →
`ads.adsenseClient` dat id en `ads.enabled` op `true`; commit en push. De site plaatst dan
automatisch het AdSense-script en het bestand `/ads.txt` (`google.com, pub-…, DIRECT,
f08c47fec0942fa0`). Vraag in AdSense de beoordeling aan (enkele dagen tot 2–4 weken). Maak daarna
advertentieblokken aan en zet hun ids in `ads.slots`. Ga naar **Privacy & messaging** →
*European regulations* → maak de toestemmingsmelding (Google's eigen CMP, TCF v2.3) in het
Nederlands, met de knop **"Niet akkoord"/"Do not consent"** ingeschakeld, en publiceer. Uitbetaling
vanaf €70; zie `docs/onderzoek.md` §6.4 voor KvK en btw.

---

## 11. Problemen oplossen (voor wie verder kijkt)

| Melding of symptoom | Oorzaak | Oplossing |
|---|---|---|
| *Data* → "not configured yet: missing secret(s) X" | secret ontbreekt of naam verkeerd gespeld | §7.1 |
| *Upload changed files to R2* → `403` / `SignatureDoesNotMatch` / `InvalidAccessKeyId` | token verkeerd, ingetrokken of niet op deze bucket | nieuw token (§4.6), secrets bijwerken |
| *Upload* → `NoSuchBucket` | `R2_BUCKET` klopt niet | §4.2 / §7.1 |
| *Upload* → `getaddrinfo ENOTFOUND` | `R2_ACCOUNT_ID` klopt niet, of bucket heeft een jurisdictie | §4.3; eventueel `R2_JURISDICTION` |
| *Deploy* → "Missing repository settings" | variabele of secret ontbreekt | §7 |
| *Deploy* → `Authentication error` | Pages-token heeft geen *Cloudflare Pages: Edit* | §5.2 |
| Site laadt, kaart blijft leeg; browserconsole noemt "CORS" | CORS-regel ontbreekt op de bucket | §4.5 |
| Site laadt, kaart blijft leeg, geen CORS-fout | `DATA_BASE` verkeerd (slash vergeten of verkeerd subdomein) | §7.2, daarna *Deploy* opnieuw |
| `cf-cache-status: DYNAMIC` op de data-URL | Cache Rule ontbreekt of hostnaam klopt niet | §4.7 |
| Gele balk "scheduled workflow is disabled" | 60 dagen zonder activiteit | *Enable workflow* |
| E-mail van healthchecks, maar *Data*-runs zijn groen | `HEALTHCHECK_URL` verkeerd of check-periode korter dan 10 min | §6.1 / §7.1 |

Technische details van de workflows, het uploadscript en het roteren van tokens:
`infra/README.md`. Achtergrond bij alle keuzes en cijfers: `docs/onderzoek.md`.
