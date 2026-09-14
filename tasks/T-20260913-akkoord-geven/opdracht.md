---
id: T-20260913-akkoord-geven
titel: Autorisatie van de eigenaar via de Jarvis-interface, niet via handelingen op GitHub
status: actief
klasse: M
risico: B
project: jarvis
aangevraagd_door: lodewijk
datum: 2026-09-13
gebieden:
  - jarvis
  - governance
  - interface
---

## Wat de opdrachtgever vroeg

2026-09-13, op het item "Pull request #3 op kasboek goedkeuren": "Ik zou geen
technische handelingen meer hoeven te verrichten."

Eerder (2026-09-12): "Ik wil uiteindelijk alleen beslissingen en autorisaties
krijgen die werkelijk bij de eigenaar horen, niet de technische uitvoering
daarvan."

## Analyse langs CON-0015

Per handeling die nu bij de eigenaar ligt, de vier vragen: (1) is de
inhoudelijke autorisatie echt nodig, (2) vereist GitHub dat de eigenaar het
persoonlijk doet, (3) vereist onze governance dat bewust, (4) is het een
ontbrekende capability van Jarvis.

### "Pull request goedkeuren" (nu tien engine-/ToVas Flow-PR's en drie kasboek-PR's)

1. **Autorisatie nodig?** Volgens het rolcontract van de orchestrator (§6) is
   samenvoegen naar de beschermde hoofdbranch klasse B: een menselijke
   beslissing. Die beslissing is van de eigenaar. Maar de *vorm* — een review
   op GitHub per PR — staat nergens als eis; DEC-0039 koos die vorm omdat het
   op dat moment de enige weg was.
2. **GitHub-eis?** De rulesets eisen één goedkeurende review van iemand die
   niet de auteur is. De bot is de auteur, dus de bot kan niet goedkeuren. De
   eigenaar is nu de enige andere identiteit met schrijfrecht. GitHub eist
   dus niet de eigenaar, maar *een tweede identiteit*.
3. **Governance?** Ja, de beslissing; nee, de klik. Wat de eigenaar nu doet is
   voor negen tiende techniek: link openen, CI afwachten, "Review changes",
   "Approve", "Submit". De inhoudelijke beslissing is één woord.
4. **Capability?** Ja. Jarvis mist (a) een plek waar de eigenaar met één tik
   autoriseert en die tik aantoonbaar van de eigenaar is, en (b) een tweede
   identiteit die de GitHub-review technisch afgeeft nadat die autorisatie is
   vastgelegd.

De Jarvis-interface op de eigen database levert (a) al: de eigenaar logt in
met zijn account, RLS garandeert dat alleen hij schrijft, elke rij draagt
zijn `auth.uid()` en een tijdstempel. Een autorisatie in die database is
dus net zo herleidbaar als een review op GitHub — herleidbaarder zelfs,
want gekoppeld aan taak en item.

### "Credential plaatsen" (Vault-token, JARVIS_DB_URL, straks JARVIS_BOT_TOKEN in de cloud)

Klasse C (§6: alles wat een geheim aanmaakt, leest of doorgeeft). Bewust van
de eigenaar; de bescherming is juist dat Jarvis het niet kan. Eenmalig per
credential. Blijft.

### "Instelling wijzigen" (schema exposen, GitHub App installeren, Vercel-login)

Eigenaarschap van het platformaccount; Jarvis heeft daar bewust geen
beheerrecht (CON "wijzig geen GitHub-instellingen"; Supabase-projectinstelling;
Vercel-identiteit). Eenmalig. Blijft, maar hoort in één batch en niet
telkens opnieuw.

### "Bestaande rulesets aanpassen"

Instelling op bestaande repositories; buiten het DEC-0038-mandaat. Eenmalig.
Blijft — tenzij de keuze hieronder de rulesets overbodig verandert.

## Drie wegen voor de PR-autorisatie

**Weg 1 — tweede machine-identiteit als reviewer (advies).**
De eigenaar autoriseert in de interface (één tik: "Akkoord" of "Nee", per
PR of per taak). Jarvis legt dat vast in `jarvis.autorisaties` (eigenaar,
tijd, PR, taak) en laat daarna een tweede bot (`tovas-jarvis-reviewer`) de
goedkeurende review op GitHub afgeven met in de reviewtekst de verwijzing
naar de autorisatie. `jarvis pr mergen` eist voortaan: poort groen, QA GO in
het dossier, autorisatie van de eigenaar in de database, én de review van
de reviewer. De rulesets blijven ongewijzigd.
- Gevolg: geen GitHub-handelingen meer voor de eigenaar; de beslissing blijft
  bij hem en is op twee plekken herleidbaar (database en GitHub).
- Kosten: € 0. Eenmalig door de eigenaar: een tweede GitHub-account aanmaken
  (Jarvis mag geen accounts aanmaken), collaborator maken op de drie
  repositories, en het token in de Vault en de cloud-omgeving zetten — één
  keer, dezelfde route als bij de eerste bot.
- Risico: twee bottokens in plaats van één; beide roteerbaar, beide alleen
  via `jarvis pr`. De reviewer kan technisch elke PR goedkeuren; de rem zit
  in `jarvis pr` (geen autorisatie in de database → geen review) en in het
  feit dat de bot alleen via de engine handelt.

**Weg 2 — de bot als bypass-actor in de rulesets.**
De eigenaar zet in de drie rulesets de bot als bypass voor de review-eis;
Jarvis merget na autorisatie in de database. Eenvoudiger (één identiteit),
maar de tweede technische grendel op GitHub verdwijnt: alleen de engine
bewaakt nog. Vereist bovendien een instellingswijziging per repository door
de eigenaar.

**Weg 3 — blijven bij de review op GitHub (huidig).**
Geen bouwwerk, maar elke PR blijft vijf klikken van de eigenaar, en het
aantal PR's groeit met het werk.

## Tweede beslissing: wanneer is autorisatie per PR nodig?

Het contract zegt: elke merge naar main is klasse B. Dat betekent ook een
kleurwijziging in Kasboek of een engine-fix met QA GO. Opties:

- **Alles** (huidig): elke PR één tik in de interface.
- **Per taak**: de eigenaar autoriseert een taak (richting, dossier); PR's
  die dat dossier uitvoeren met QA GO en groene poort merget Jarvis zonder
  aparte tik. Een PR met klantimpact, productie-data, beveiliging, kosten of
  een nieuwe leverancier vraagt altijd apart.
- **Alleen klasse B-inhoud**: alleen de genoemde categorieën vragen een tik;
  de rest merget Jarvis op QA GO en poort.

Advies: **per taak**, met de harde uitzonderingen. Dat is precies "beslissingen
en autorisaties die werkelijk bij de eigenaar horen": de richting en het
risico, niet elke uitvoeringsstap.

## Beslissing van de eigenaar (2026-09-13, per chat)

Per taak autoriseren met harde uitzonderingen, niet per PR (DEC-0043). Eerst
onderzoeken of een bestaande identiteit de onafhankelijke review technisch kan
afgeven; pas een tweede botaccount als GitHub of de trust boundary dat echt
vereist. Daarna het volledige pad ontwerpen: akkoord in Jarvis →
onveranderbare koppeling aan taak/scope/commit → QA GO → vereiste
GitHub-attestatie → automatische merge → vervolgwerk.

## Onderzoek: welke identiteit kan attesteren?

Gemeten in een eenmalige cloud-run (2026-09-13 09:45 UTC,
routine "Jarvis — diagnose cloud-identiteit", eenmalig):

- De cloud heeft **geen `gh`**; GitHub-toegang loopt via de GitHub-MCP van
  claude.ai, en die is ingelogd als **`tovas-jarvis-bot`** — dezelfde
  identiteit als de auteur van elke PR. GitHub weigert een review op een
  eigen PR, dus deze identiteit kan niet attesteren.
- Git-pushes uit de cloud lopen via een proxy met het installatietoken van
  de Claude GitHub App; dat token is niet beschikbaar in de sessie, dus er
  is geen API-aanroep mee te doen. Commits uit de cloud dragen
  de naam "Claude" met het standaard-noreply-adres van Anthropic (niet toegeschreven aan een
  GitHub-account; op jarvis-engine vraagt de ruleset daarvoor een extra
  goedkeuring — de routine gaat daarom als de bot committen).
- De diagnose-agent weigerde terecht de stappen die tokentypes of de
  installatie-omvang in kaart zouden brengen en stuurde de eigenaar een
  pushmelding "verdachte taak"; er is niets getoond. Dat was Jarvis' eigen
  diagnose, geen indringer.

Conclusie: er is **geen bestaande identiteit** die de review kan afgeven.
Er zijn twee wegen naar een tweede identiteit, en één daarvan vraagt geen
account en geen langlevend credential:

**A. De poort attesteert (advies).** Een workflow `attestatie` in elke
repository (canoniek in de engine, net als `jarvis-lint.yml`) draait
`jarvis attestatie --pr <nr>` met het kortlevende, repository-gebonden
`GITHUB_TOKEN`. Slaagt de verificatie, dan geeft `github-actions[bot]` de
goedkeurende review af met de attestatietekst. GitHub telt die review mee
voor de vereiste goedkeuring zodra de eigenaar per repository
"Allow GitHub Actions to create and approve pull requests" aanzet
(Settings → Actions → General; één vinkje, drie repositories).
- Geen nieuw account, geen nieuw token: `GITHUB_TOKEN` bestaat alleen
  tijdens de run en kan buiten de workflow niets.
- De workflow draait vanaf `main` (`workflow_dispatch`), dus een PR kan de
  attestatiecode niet zelf aanpassen om zichzelf goed te keuren.
- De verificatie is deterministisch en leesbaar: dezelfde engine als de
  poort.

**B. Tweede botaccount** (`tovas-jarvis-reviewer`): account aanmaken,
collaborator op drie repositories, token in Vault en cloud, tweede
rotatiecyclus. Geeft geen sterkere scheiding dan A — Jarvis houdt in beide
gevallen beide identiteiten — maar wel een extra langlevend credential.

## Ontwerp van het autorisatiepad

Ankerpunt is de eigen database van Jarvis (schema `jarvis`), omdat alleen
daar aantoonbaar is wie iets schreef: RLS op het account van de eigenaar,
`auth.uid()` per rij.

1. **Akkoord in Jarvis.** Op een taakkaart in de interface tikt de eigenaar
   "Akkoord met deze taak". De pagina schrijft één rij in
   `jarvis.autorisaties`: `soort = 'taak'`, `project`, `taak`,
   `scope_hash` (SHA-256 van `tasks/<T>/opdracht.md` zoals het overzicht
   die meegeeft), `tekst` (de titel en de scope zoals getoond), `eigenaar =
   auth.uid()`, `op = now()`. Alleen de eigenaar mag invoegen; niemand mag
   wijzigen of verwijderen (RLS zonder update/delete-policy én een trigger
   die het ook voor de databaserol weigert). De rij is onveranderbaar en
   gekoppeld aan taak en scope-inhoud.
   Voor een uitzondering (DEC-0043 §2) verschijnt een apart item
   "Akkoord voor PR #n" op de kaart; dat schrijft `soort = 'pr'` met
   `pr_repo`, `pr_nummer`, `commit_sha` (de kop op dat moment).
   Elke nieuwe rij geeft via de brug een gebeurtenis af, zodat de cloud
   direct doorgaat.
2. **Bouwen en toetsen.** Jarvis bouwt op een `jarvis/`-branch; elke commit
   draagt `Jarvis-Task: <T>`. De QA-rol toetst onafhankelijk en het resultaat
   wordt vastgelegd in `jarvis.toetsingen` (`pr_repo`, `pr_nummer`,
   `commit_sha`, `oordeel GO/NO-GO`, `rapport` (pad in het dossier), `door`)
   door `jarvis db toetsing` (rol `jarvis_werker`; invoegen, nooit wijzigen).
   De PR-tekst draagt een regel `Uitzonderingen: geen` of
   `Uitzonderingen: <welke>` — de verklaring van de orchestrator.
3. **Attestatie.** `jarvis pr attesteren <nr>` start de workflow
   (`workflow_dispatch`, als de bot). In de workflow verifieert
   `jarvis attestatie --pr <nr>` deterministisch:
   - auteur is de bot; alle commits dragen dezelfde `Jarvis-Task`;
   - er is een `autorisaties`-rij `soort = 'taak'` voor die taak, en
     `scope_hash` is gelijk aan de hash van `opdracht.md` op de kop (anders:
     "scope gewijzigd, opnieuw autoriseren");
   - er is een `toetsingen`-rij met `oordeel = GO` op precies de kop;
   - geen harde uitzondering: de gewijzigde bestanden raken geen
     workflows, CODEOWNERS, migraties, `.env*`, `vercel.json`,
     `jarvis.config.yml`, `jarvis/allowlist.yml`, rolcontracten of
     `knowledge/CONSTRAINTS/`, en de PR-tekst zegt `Uitzonderingen: geen`;
     anders is een `autorisaties`-rij `soort = 'pr'` op deze kop vereist;
   - de poort is groen op de kop.
   De verificatie leest de database via de REST-API met de publieke
   sleutel en een leesbeeld zonder persoonsgegevens
   (`jarvis.attestatie_bron`: id, soort, project, taak, scope_hash,
   pr_repo, pr_nummer, commit_sha, oordeel, op — geen `eigenaar`-uuid).
   Slaagt alles, dan geeft de workflow een `APPROVE`-review met als tekst:
   `Attestatie: autorisatie <id> (taak <T>, scope <hash>) · toetsing <id>
   GO op <sha> · uitzonderingen: geen · poort groen`. Faalt iets, dan
   faalt de check `attestatie` met de redenen in de log en gebeurt er
   niets op de PR.
4. **Samenvoegen.** `jarvis pr mergen` (bot) accepteert voortaan een
   goedkeuring van `github-actions[bot]` op de kop mits de tekst een
   attestatie is waarvan autorisatie en toetsing in de database bestaan en
   bij de kop horen (tweede, onafhankelijke verificatie via
   `jarvis_werker`); een goedkeuring van de eigenaar zelf blijft ook geldig.
   Poort groen, geen `unstable`, mergecommit — ongewijzigd.
5. **Vervolgwerk.** De merge is een push op `main` → gebeurtenis → de cloud
   pakt de volgende open stap uit `## Voortgang` van de taak (staat al in
   de routine). Een taak sluit met de laatste stap; een nieuwe scope is een
   nieuwe taak en dus een nieuw akkoord.

Wat de eigenaar hierin nog doet: één tik per taak, één tik per
uitzondering, en eenmalig het vinkje per repository. Wat hij nooit meer
doet: reviews klikken, CI afwachten, samenvoegen.

## Bootstrap

Het pad kan zichzelf niet in gebruik nemen: de workflow, de
databasetabellen en de interface-knop komen zelf per PR binnen, en de eerste
akkoorden kunnen pas in de interface worden gegeven als die op de eigen
database draait. Daarom één laatste ronde op GitHub door de eigenaar, in
één batch met de vijf handelingen: engine #8, #9, #10 en de drie PR's van
dit ontwerp; kasboek #1, #2 en de migratie-PR. Daarna is elke volgende
autorisatie een tik in Jarvis.
