# jarvis-engine

De engine van Jarvis: een provider-onafhankelijke werkomgeving voor AI-agents
met een deterministische governance-poort. Deze repository bevat gereedschap en
regels, geen projectkennis.

## Gebruik in een project

```
npm install --save-dev github:lodewijkmaassen/jarvis-engine#<commit>
npx jarvis <opdracht>
```

Een project levert `jarvis.config.yml`, `knowledge/`, `tasks/`, een
projectkaart en een `CURRENT_STATE`; verder niets. Zie `project/PROJECT.md`.

## Ontwikkelen aan de engine

```
npm ci --ignore-scripts
npm run typecheck
npm test
npm run poort
```

`npm ci` koppelt `node_modules/jarvis-engine` aan deze repository zelf
(`file:.`), zodat de canonieke workflow hier dezelfde opdracht draait als bij
elke consumer: `node node_modules/jarvis-engine/bin/jarvis.mjs poort`.

De poort (`.github/workflows/jarvis-lint.yml`) is byte-gelijk aan
`jarvis/canonical/jarvis-lint.yml`; wijzig de canonieke bron, nooit de kopie.

## Pull requests

Jarvis opent, volgt en voegt pull requests samen als de bot (`jarvis pr`).
Het token van de bot staat in `~/.jarvis-bot-token` (of het pad in
`JARVIS_BOT_TOKEN_BESTAND`), buiten elke repository, en wordt nooit getoond.
Samenvoegen gebeurt alleen met een goedkeurende review op de huidige kop en
alle checks groen. Twee soorten review tellen: een review van de eigenaar
van de repository, of een **attestatie van de poort** (hieronder).

## Autorisatie per taak en attestatie (DEC-0043)

De eigenaar autoriseert per taak, niet per pull request. Zijn akkoord staat
in de eigen database van Jarvis (`jarvis.autorisaties`): alleen zijn
ingelogde account kan er een rij schrijven, niemand kan er een wijzigen, en
elke rij draagt de SHA-256 van de scope (`tasks/<T>/opdracht.md`) die hij
zag. De goedkeurende review op GitHub is daarna techniek: de workflow
`jarvis-attestatie.yml` (canoniek in `jarvis/canonical/`, byte-identiek in
elke repository die hem draagt) draait `jarvis attestatie --pr <n>` met het
kortlevende `GITHUB_TOKEN` en keurt goed als, en alleen als:

1. de auteur de bot is en elke commit precies één `Jarvis-Task` draagt
   (meer taken in één PR mag; dan telt elk akkoord);
2. er per taak een akkoord is en de scope op de kop dezelfde hash heeft;
3. er een toetsing met oordeel GO op precies de kop staat
   (`jarvis db toetsing <repo> <n> <sha> GO --door <naam> --rapport <bestand>`);
4. er geen harde uitzondering speelt (workflows, CODEOWNERS, migraties,
   `.env*`, governanceconfiguratie, rolcontracten, de canonieke workflows,
   `.claude/`, plus `attestatie.extra_paden` uit de configuratie) en de
   PR-tekst `Uitzonderingen: geen` zegt — anders is een apart akkoord van
   soort `pr` op precies deze kop vereist;
5. de poort groen is.

Een **administratieve** PR — alleen dossiers (`tasks/`), kennisrecords
(niet `CONSTRAINTS/`), de kennisindex en het feitenblok — attesteert de
poort zonder taakakkoord en zonder toetsing (DEC-0044): dat is klasse-A-werk
dat de poort zelf toetst. De verklaring `Uitzonderingen: geen` en een groene
poort blijven nodig.

De bot vraagt de toets aan met `jarvis pr attesteren <n>`; `jarvis pr mergen`
verifieert de attestatie daarna zelf nog eens tegen de database (rol
`jarvis_werker`) voordat hij samenvoegt. Configuratie per repository in
`jarvis.config.yml`:

```yaml
attestatie:
  url: https://<project>.supabase.co     # REST-URL van de eigen database
  sleutel: sb_publishable_…              # publieke sleutel (staat in elke browser)
  bot: <login van de bot>
  extra_paden: [vercel.json]             # projectpaden die ook een apart akkoord vragen
  samenvoegen: false                     # mag de workflow ook samenvoegen? standaard nee
```

GitHub telt de goedkeuring van de workflow alleen mee als de eigenaar per
repository *Allow GitHub Actions to create and approve pull requests* heeft
aangezet. Zonder configuratie of zonder workflow blijft de review van de
eigenaar de enige autorisatie.

### Eén akkoord per taak

Een taakdossier kan in zijn front-matter aankondigen welke soorten harde
uitzondering de taak mag raken:

    uitzonderingen:
      - workflows en repository-automatisering
      - governanceconfiguratie

De eigenaar keurt die aankondiging mee goed, en dan hoeft niet elke pull
request binnen die taak opnieuw om een apart akkoord te vragen. De waarden zijn
de soortnamen die de engine kent (de `waarom`-teksten van
`HARDE_UITZONDERINGEN` in `attestatie.ts`), of `projectregel: <pad>` voor een
pad uit `attestatie.extra_paden`. Een naam die de engine niet kent dekt niets.

De scope-hash dekt `opdracht.md` als geheel, dus een soort erbij schrijven laat
het akkoord vervallen: het mandaat is alleen door de eigenaar te verruimen.

De regel `Uitzonderingen:` in de PR-tekst moet dan precies de soorten noemen die
de gewijzigde bestanden opleveren, alfabetisch en met `; ` ertussen — de
weigering drukt de verwachte regel letterlijk af. Staat er meer dan één
verschillende `Uitzonderingen:`-regel in de tekst, dan wordt er niet
geattesteerd.

`samenvoegen: true` laat de workflow de pull request die zij zojuist heeft
goedgekeurd ook samenvoegen, in een tweede job met `contents: write` die
alleen dan draait. Het oordeel komt van dezelfde beoordeling als
`jarvis pr mergen` en wordt in die tweede job opnieuw gedraaid, met dezelfde
leesbeelden en de publieke sleutel; er komt geen autorisatieweg bij. Zet het alleen aan waar dat schrijfrecht gewenst is.

## De eigen database vanuit de cloud

Een cloud-sessie van het platform kan geen Postgres-verbinding maken (ruwe
TCP is geblokkeerd; gemeten 2026-09-13) en environment variables zijn daar
leesbaar voor elke opdracht. `jarvis db` kiest daarom zelf zijn weg:

1. een verbindingsreeks (`JARVIS_DB_URL` of `~/.jarvis-db-url`) — de laptop;
2. anders de Edge Function `jarvis-db` (`JARVIS_DB_API`, of afgeleid van
   `attestatie.url` in `jarvis.config.yml`) — de cloud. De aanroep draagt
   geen token: de *API credential* van de cloud-omgeving voegt de
   `Authorization`-header toe voor de host van de functie, buiten de VM.

De functie staat in `jarvis/edge/jarvis-db/` en voert uitsluitend de
statements uit die letterlijk in `toegestaan.json` staan (gegenereerd uit
`db.ts` met `npx tsx jarvis/scripts/toegestane-sql.ts`; een test bewaakt de
gelijkheid). Ze verbindt als `jarvis_werker` via het function-secret
`JARVIS_DB_URL` en vergelijkt het token uit `JARVIS_API_TOKEN` in constante
tijd. Uitrollen: `supabase functions deploy jarvis-db --no-verify-jwt` vanuit
die map, of via de Supabase-MCP.

## Wekken zonder claude.ai

De eigen database is de enige bron (DEC-0044). Een uitvoerder die wacht op
werk draait `jarvis db wachten [--max <seconden>]`: die peilt elke twintig
seconden en stopt zodra er een nieuw antwoord, bericht of akkoord is
(exitcode 0, JSON op stdout), of na `--max` seconden (exitcode 3). De laptop
draait hem op de achtergrond; de cloud start op de brug (een push van de
database naar GitHub) en op het vangnetrooster.
