---
id: T-20261015-jarvis-v3
titel: Jarvis V3 — eenvoudige taakketen met mandaat
status: actief
klasse: L
risico: B
project: jarvis
aangevraagd_door: lodewijk
datum: 2026-10-15
gebieden:
  - jarvis
  - engine
  - governance
---

## Wat de opdrachtgever vroeg

2026-10-15, bericht aan de cloud-uitvoerder: V2 structureel vervangen door een
veel eenvoudiger V3. De eigenaar neemt beslissingen; Jarvis voert uit. Eén
bron van waarheid voor taakstatus (een databasetabel), één state machine die
de database afdwingt, één mandaat per opdracht dat alle technische uitvoering
dekt (inclusief productie-uitrol en migraties wanneer het mandaat dat zegt),
`Voor jou` uitsluitend gevuld met echte eigenaarsverzoeken, en voltooiing op
grond van een gemeten eindresultaat.

Besluiten van de eigenaar: governance-paden blijven buiten ieder normaal
mandaat; migraties lopen over een gecontroleerde route zonder dat Jarvis de
verbindingsreeks ziet; de dispatcher start de routine via de API met een
GitHub-secret als token.

## Voortgang

- [x] Fase 1 — databasefundament (`jarvis/migrations/v3`), getest op PostgreSQL
- [x] Fase 2 — uitvoerderslaag: `jarvis v3`-CLI, mandaatbeoordeling, dispatcher, migratieroute, workflow `jarvis-v3`
- [x] Fase 3 — interface /v3/ op de V3-views (productiemeting in de ToVas-app volgt bij de acceptatietest)
- [x] Reparatieronde na onafhankelijke QA: B1 (eigenaarsidentiteit faalt gesloten, eigenaarsviews gefilterd), B2 (oud pad bij hernoemen getoetst), B3 (noodstop `enabled: false` geldt voor V3), B4 (poortcode, pin en npm-config voor elk mandaat gesloten; `extra_paden` toegepast), B5 (migratiecontrole als scanner met whitelist), B6 (UITROL en KLAAR alleen via de CI-identiteit `jarvis_ci`)
- [x] Tweede reparatieronde (QA ronde 2): BLK-1 (de migratiescanner is een lexer die SQL leest zoals PostgreSQL en gesloten faalt, beoordeelt ook functiebodies, plus afgedwongen least-privilege-rol voor `migreer`; regressietests tegen echte PostgreSQL voor elke gevonden omzeiling), BLK-2 (tsconfig), BLK-3 (rechten voor anon/authenticated/service_role ingetrokken; volledige EXECUTE-matrix getest), R-1 (een PR wordt per taak één keer vastgelegd), R-2 (alleen samenvoegen in main), R-3 (bouwmerk mag een nazaat zijn)
- [x] Derde reparatieronde (QA ronde 3): NB-1 (EXECUTE nergens toegestaan behalve de triggerdefinitie; bodies krijgen dezelfde destructief-controles als het bovenste niveau; `do '<tekst>'` en `do language x '<tekst>'` worden als code gelezen; query_to_xml en ts_stat verboden), NB-2 (`bin/` poortcode), lineaire patronen, schemagebruik alleen voor de drie V3-rollen, hoofdletterongevoelige repo-vergelijking in R-1, en autonome migratie: de migratiejob draait direct na de sweep (`needs: sweep`) en haalt zijn werk uit de database in plaats van uit een push-event (een merge met GITHUB_TOKEN start geen push-workflow)
- [x] Vierde reparatieronde (QA ronde 4): B-1 (de uitvoerder kan `pr.merge_sha` niet meer vervalsen: `v3_overgang` bewaart alleen repo, nummer en sha; `migreer` controleert bij GitHub dat de pull request werkelijk in main is samengevoegd met precies die samenvoegcommit en bij deze taak hoort), B-2 (een woord direct voor een quote leest de lexer als tekst met de code-controle; `do language "x" '…'`, `language 'x' '…'` en aaneengeschakelde teksten tellen als code)
- [x] Vijfde reparatieronde (QA ronde 5): BLK-A (aaneengeschakelde teksten na `as`/`do`/`language x` worden eerst samengevoegd en dan als code gelezen, ook midden in een woord), BLK-B (bestandspaden in GitHub-URL's per segment gecodeerd: `encodeURI` liet `? # &` door, waardoor de poort een ander bestand toetste dan het samengevoegde)
- [x] Zesde reparatieronde (QA ronde 6): BLK-C (een E-tekst met aaneengeschakelde vervolgstukken blijft een E-tekst: de vervolgstukken worden in dezelfde modus gelezen, anders neemt de lexer code voor tekst aan); differentiële regressietest tegen echte PostgreSQL met een generator van tekstketens
- [x] Achtste reparatieronde (QA ronde 8): BLK-D (blokcommentaar voegt teksten niet samen, conform PostgreSQL), scanner: `setval`/`nextval`/`lo_*` verboden, `alter`/`merge` in bodies vragen destructief, `alter table`-whitelist eist `add` als commando en weigert `detach`/`set default`/e.d.; NO-GO op een kop weegt zwaarder dan GO (DB en sweep); lease-houders `ci`/`eigenaar`/`jarvis`/`dispatcher` gereserveerd; sweep/eindcontrole/dispatch draaien in omgeving `jarvis-ci`. **Voorwaarden bij bootstrap:** omgeving `jarvis-ci` beperkt tot branch main en met de CI-secrets (`JARVIS_CI_DB_URL`, `JARVIS_ROUTINE_*`) alleen daar; het bot-token kan geen `.github/workflows` schrijven; op main: verplichte checks en 'dismiss stale approvals'.
- [x] Negende reparatieronde (QA ronde 9): BLK-F (een NO-GO trekt de goedkeuring van de poort in en wordt vlak voor de merge opnieuw getoetst; repo-vergelijking hoofdletterongevoelig), BLK-G (de additieve migratiecontrole is nu een positieve grammatica: elke ALTER TABLE-actie begint met `add`, geen `partition of`/`inherits`, trigger/row level security/commentaar alleen op objecten uit dezelfde migratie, extensies alleen zonder schema of in public/extensions, geen `set search_path`). **Bekende grens:** een bestaande functie die de migratie aanroept (`insert … select mijn_functie()`) kan de scanner niet inzien; de rol-controle (geen USAGE op schema jarvis) en de beperkte rechten van de migratierol zijn daar de tweede laag.
- [x] Tiende reparatieronde (QA ronde 10): BLK-H (`IF NOT EXISTS` registreert een bestaand object niet meer als nieuw; aangehaalde namen worden injectief afgebeeld, dus `"T"`/`t` en `"a b"`/`a_b` vallen niet samen), BLK-I (de poort keurt pas goed als samenvoegen nu kan, trekt goedkeuringen paginerend in bij elke weigering, fout, concept-PR of mislukte merge; mislukt het intrekken, dan faalt de sweep). **Besluit over betekenis van 'additief':** nieuwe objecten, kolommen, constraints en indexen gelden als additief (ook als ze latere schrijfacties kunnen laten falen, binnen één transactie); wijzigen of verwijderen van bestaande definities of gegevens niet.
- [x] Elfde reparatieronde (QA ronde 11): BLK-J (namen met drie delen worden geweigerd in plaats van afgekapt), `blocked` telt als samenvoegbaar voor de poort (verplichte goedkeuring ontbreekt dan nog), mislukt intrekken geeft exitcode 1 op alle paden. Eerst controleren bij de eerste bootstrap-run: dat de branchregels samenvoegen na de goedkeuring van de poort toestaan.
- [x] Twaalfde reparatieronde (QA ronde 12): BLK-K (zonder `destructief: true` alleen triggerfuncties: een nieuwe functie met een passender argumenttype overschrijft anders elke bestaande aanroep, bijv. `lower(varchar)`; `OWNED BY` alleen op een tabel uit dezelfde migratie).
- [x] Dertiende reparatieronde (QA ronde 13): BLK-L (functies hebben een eigen naamruimte en maken een tabel niet 'nieuw'; triggerdoel uit de vaste syntaxis, niet het eerste `on`; `comment on function` eist naam én argumenten; bodies van triggerfuncties mogen geen comment/create/lock/set e.d.; geen tijdelijke views; bijwerkingsfuncties `pg_advisory*`, `pg_sleep*`, `pg_notify`, … verboden). Bekend en aanvaard: `select … for update` en een `add column … default <vluchtige functie>` binnen de transactie.
- [ ] Fase 4 — acceptatietest H met alle negen tests
