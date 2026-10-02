# QA-RAPPORT — `jarvis/akkoord-uit-de-database` — ronde 1

Taak: `T-20261002-technische-uitvoering` (deeloplevering: "het akkoord uit de
database telt mee in wie aan zet is").

## ONAFHANKELIJKHEIDSVERKLARING

```
diff zelf gelezen:        ed11a42..188289b (origin/main...HEAD), 7 gewijzigde bestanden
controles zelf gedraaid:  ja, 2026-10-02 16:54–17:05 UTC
                          branch jarvis/akkoord-uit-de-database, commit 188289b
eigen meetharnas:         ja — de echte functies uit jarvis.html uitgevoerd tegen
                          een echt gebouwd overzicht (11 scenario's), plus 11 sabotages
gebaseerd op het rapport van de bouwende rol: nee (implementatie.md bestaat niet in
                          het dossier; er is niets van de Developer geciteerd)
```

## UITGEVOERDE CONTROLES

| commando | uitkomst | relevante uitvoer |
|---|---|---|
| `npm run typecheck` | **groen** | `tsc --noEmit`, exit 0 |
| `npm test` | **groen** | `Test Files 43 passed (43) · Tests 989 passed (989)` |
| `node bin/jarvis.mjs poort` | **groen** | exit 0; workflow byte-identiek, `sanitize`: 44 bestanden, niets gevonden; `lint`: geen bevindingen |
| `git diff origin/main...HEAD --stat` | — | `attestatie.ts` en `pr.ts` staan **niet** in de diff |

Eigen meetharnas (alleen lezen, buiten de repository, in de scratchpad):
de functies `ijkZetten`, `zetVan`, `zetTekst`, `taakHtml`, `verzamelActies`,
`nulstand`, `akkoordNodig`, `akkoordHtml` zijn letterlijk uit
`jarvis/interface/jarvis.html` gehaald (haakjesmatching, geen regex-gok) en
uitgevoerd tegen een overzicht dat door de echte `bouwOverzicht` +
`bepaalRegie` is gebouwd. Zo is de keten dossier → bouw → vier plaatsen in de
pagina werkelijk waargenomen en niet beredeneerd.

## OORDEEL PER PUNT

| # | punt | oordeel |
|---|---|---|
| 1 | vier plaatsen tonen dezelfde werkelijkheid, beide richtingen | **PASS** |
| 2 | geen akkoordvraag meer bij een geldig akkoord op de huidige scope | **PASS** |
| 3 | akkoord op een gewijzigde scope vervalt wél (DEC-0043) | **PASS** |
| 4 | geen verruiming van de autorisatiecontrole (AC-8) | **PASS** |
| 5 | faalt de goede kant op als de database niet te lezen is | **PASS** (gedrag) |
| 6 | `zetVan` is alleen afzwakkend, nooit aanscherpend | **PASS** |
| 7 | zijn de nieuwe tests echte tests, zijn alle faalpaden gedekt | **FAIL** |
| 8 | taak zonder `tekst`/scope, en gesloten status | **PASS** |

### 1. Dezelfde werkelijkheid op alle vier de plaatsen — PASS

Eigen meting, 2026-10-02 17:0x UTC, met de echte paginafuncties op een echt
gebouwd overzicht. Per scenario: 1 = statusregel (`zetTekst`), 2 = "Wie en
waar" (`taakHtml`, regel 953 van `jarvis.html`), 3 = "Bij jou uit deze taak"
(`leegWaarom`, regel 957-961), 4 = centraal "Voor jou" (`verzamelActies`).

| scenario | 1 status | 2 Wie en waar | 3 Bij jou | 4 Voor jou | kaart |
|---|---|---|---|---|---|
| A geen akkoord, stand gemeten | WACHT OP JOU | wacht op jou · Jij | "Je akkoord hierboven is wat deze taak van je vraagt." | 1 (akkoord) | NOG GEEN AKKOORD + knop |
| B akkoord er, stand gemeten | JARVIS AAN ZET | wacht op een uitvoerder · Engineering | "Jarvis is aan zet." | 0 | AKKOORD |
| C akkoord net gegeven, bouw nog niet bij (`akkoorden = null`) | JARVIS AAN ZET | in uitvoering · Orchestrator + "je akkoord … is gegeven … en loopt bij de volgende bouw bij" | "Jarvis is aan zet." | 0 | AKKOORD |
| D scope gewijzigd sinds het akkoord | WACHT OP JOU | wacht op jou · Jij | "Je akkoord hierboven …" | 1 (akkoord) | SCOPE GEWIJZIGD + knop |
| E database onleesbaar én geen akkoord | WACHT OP JOU | wacht op jou · Jij | "Je akkoord hierboven …" | 1 (akkoord) | NOG GEEN AKKOORD + knop |
| F geldig akkoord + een echt eigenaarspunt | WACHT OP JOU | wacht op jou · Jij | het punt zelf ("Maak een Vercel-token aan") | 1 (actie) | AKKOORD |

De gemelde combinatie (WACHT OP JOU + "de eigenaar is aan zet" + "Niets —
Jarvis is aan zet" + "niets voor jou") komt in geen enkel scenario meer voor.
Scenario C is precies het venster waarin zij ontstond; daar zijn alle vier de
plaatsen nu eensluidend, inclusief een expliciete uitleg dat de regie van de
laatste bouw achterloopt.

Beide richtingen zijn gedekt: A/D/E vragen het akkoord op alle vier de
plaatsen, B/C vragen het nergens meer, en F laat zien dat een geldig akkoord
een echt eigenaarspunt niet wegpoetst.

### 2. Geen akkoordvraag meer bij een geldig akkoord — PASS

`jarvis/src/overzicht.ts:938-944`: `akkoordLigtEr` → `!akkoordLigtEr` als derde
voorwaarde van `akkoord_nodig`. Eigen meting scenario B: `akkoord_nodig=false`,
`aan_zet=jarvis`, regie `QUEUED` in plaats van `WAITING_FOR_USER`,
`verzamelActies().nu.length = 0`. Sabotage **S1** (de regel `!akkoordLigtEr &&`
verwijderd) laat 4 tests omvallen — de bouwkant is hier wél vastgelegd.

### 3. Akkoord op een gewijzigde scope vervalt — PASS

`overzicht.ts:938` vergelijkt `akkoorden.get(t.id) === scope_hash`, met
`scope_hash = scopeHash(t.tekst)` uit `attestatie.ts:68` (dezelfde functie als
de attestatie, inclusief CRLF-normalisatie). Eigen meting scenario D: akkoord op
een andere hash ⇒ `akkoord_nodig=true`, kaart "SCOPE GEWIJZIGD", "Voor jou" 1.
Sabotage **S2** (`akkoorden.has(t.id)` in plaats van de hashvergelijking) laat de
test *"vraagt het akkoord wél opnieuw wanneer de scope sinds het akkoord
veranderde"* omvallen. Extra eigen controle **L**: een stand met een hash voor
`T-2` laat `T-1` ongemoeid (`akkoord_nodig=true`).

### 4. Geen verruiming van de autorisatiecontrole — PASS

- `git diff origin/main...HEAD --name-only` noemt `jarvis/src/attestatie.ts` en
  `jarvis/src/pr.ts` **niet**; ook `.github/`, `jarvis/canonical/` en
  `jarvis/edge/` zijn ongewijzigd. De allowlist van de Edge Function is niet
  aangeraakt: `AUTORISATIE_TAAK_SQL` stond al in `toegestaneSql()`
  (`jarvis/src/db.ts:312`).
- Het nieuwe veto raakt uitsluitend `TaakItem.akkoord_nodig`. De enige lezers
  daarvan zijn `jarvis/src/regie.ts:352` en de pagina (gegrepen over de hele
  repository). `attestatie.ts` en `pr.ts` importeren `overzicht.ts` niet.
- De attestatie leest het akkoord rechtstreeks uit de database
  (`sqlBron`/`restBron`, `opdrachten.ts:2780-2808`) en de scope uit de **kop van
  de pull request** via de GitHub-API (`opdrachten.ts:2887-2896`), nooit uit het
  overzichtdocument. Het overzicht is dus nergens bron voor een
  autorisatiebesluit.
- Kan het veto een attestatie of merge laten slagen die eerder zou falen? Nee:
  het veto bestaat alleen in het weergavepad. Het ergst denkbare gevolg is dat
  de regie een taak als `QUEUED` aanbiedt — en dat kan alleen wanneer er
  werkelijk een akkoord met de juiste scope-hash in `jarvis.autorisaties` staat.
  Samenvoegen blijft daarna volledig afhankelijk van `attestatie.ts`.
- De poort draait groen (exit 0) en gebruikt `bouwOverzichtVanuit` niet; alleen
  `jarvis overzicht` en `jarvis regie` roepen die aan, en die hadden de database
  al nodig.

### 5. Faalt de code de goede kant op zonder database — PASS (gedrag)

`opdrachten.ts:846-864`: `verbindDb() === null` ⇒ `null`; elke uitzondering in
de leeslus ⇒ `null`; `null` ≠ lege map. In `overzicht.ts:938` levert `null`
`akkoordLigtEr = false`, dus het dossier blijft leidend en de vraag blijft
staan. Eigen meting scenario E bevestigt dat: zonder stand én zonder akkoord
staat alles op "wacht op jou" met knop. Scenario C bevestigt de andere kant: is
de stand niet gemeten maar ligt het akkoord er wél, dan corrigeert de pagina en
zegt er bovendien bij dat die bouw de akkoorden niet kon lezen
(`akkoord_gemeten === false`). Een akkoord aannemen dat er niet is, is in geen
van de paden mogelijk.

Twee kanttekeningen, niet blokkerend (zie N3 en N4).

### 6. `zetVan` is alleen afzwakkend — PASS

`jarvis.html:394-398`: de functie geeft `t.aan_zet` ongewijzigd terug tenzij die
`"eigenaar"` is, en kan dan alleen `"jarvis"` opleveren. Er is geen pad dat
`"jarvis"`, `"wacht"` of `"niemand"` naar `"eigenaar"` tilt. Twee vangrails
houden de afzwakking smal: `akkoord_open === false` (de kaart in de database ziet
het akkoord ook) én `eigen_punten === false` (er ligt geen open punt uit deze
taak in zijn lijst). Sabotage **S6** (een aanscherpende tak toegevoegd) laat 2
tests omvallen; sabotage **S7** (vangrail `eigen_punten` weg) laat 1 test
omvallen. Beide vangrails zijn dus vastgelegd op functieniveau.

### 7. Zijn de nieuwe tests echte tests — FAIL

Wat wél wordt vastgehouden (sabotages die correct omvallen):

| # | sabotage | gevallen tests |
|---|---|---|
| S1 | `!akkoordLigtEr &&` verwijderd uit `akkoord_nodig` | 4 |
| S2 | scope-hashvergelijking vervangen door `akkoorden.has(id)` | 1 |
| S3 | `akkoord_gemeten` altijd `true` | 1 |
| S6 | `zetVan` krijgt een aanscherpende tak | 2 |
| S7 | vangrail `eigen_punten` uit `zetVan` | 1 |

Wat **niet** wordt vastgehouden — elk van deze sabotages laat alle 989 tests
slagen én `tsc --noEmit` groen, terwijl de gemelde tegenspraak terugkomt of de
reparatie dood is:

| # | sabotage | uitkomst | gevolg in productie |
|---|---|---|---|
| **S15** | `bouwOverzicht(projecten, nu, kernId, akkoorden)` → `…, null` (`opdrachten.ts:826`) | 989 passed | **de hele reparatie is uitgeschakeld**: de database telt niet meer mee, elke bouw valt terug op het dossier |
| **S8** | `zetKort`/`zetTekst` lezen weer `t.aan_zet` in plaats van `zetVan(t)` | 989 passed | de statusregel zegt weer WACHT OP JOU terwijl de kaart weg is — exact het gemelde symptoom |
| **S9** | `${leegWaarom}` vervangen door de vaste tekst "Jarvis is aan zet." | 989 passed | "Niets — Jarvis is aan zet" onder een kop WACHT OP JOU — de gemelde tegenspraak zelf |
| **S10** | `regieVerouderd = false` | 989 passed | "Wie en waar" meldt weer "de eigenaar is aan zet" terwijl er niets ligt |
| **S11** | de aanroep `ijkZetten();` uit `render()` | 989 passed | `akkoord_open`/`eigen_punten` blijven `undefined`, `zetVan` zwakt nooit meer af; de hele correctielaag is dood |
| **S12** | `heeftEigenPunten` geeft altijd `false` | 989 passed | een echt eigenaarspunt kan worden weggepoetst zodra er ook een akkoordvraag staat |
| **S13** | `verbinding === null` ⇒ lege map in plaats van `null` | 989 passed | de bouw beweert gemeten te hebben terwijl ze niets las |
| **S14** | `catch { return new Map(); }` | 989 passed | idem bij een leesfout |

De suite toetst de pure functies (`leesTaken`, `zetVan`, `akkoordNodig`) en niet
de bedrading. Daarmee is precies dát ongedekt wat de eigenaar meldde: de vier
weergaveplaatsen en het productiepad dat de akkoordstand überhaupt ophaalt.
Dit is dezelfde les die in `tests/jarvis/interface-waarheid.test.ts:190-193`
al staat opgeschreven ("QA toonde met een sabotage aan dat `nulstand` volledig
uitgeschakeld kon worden zonder dat één test protesteerde"); zij is hier niet
toegepast op de nieuwe bedrading.

Het gedrag van vandaag is goed — dat heb ik gemeten. Wat ontbreekt is de
borging: niets in de repository houdt morgen tegen dat de keten weer uit elkaar
loopt.

### 8. Taak zonder `tekst`/scope, en gesloten status — PASS

Eigen meting:

| scenario | bouw | status | Bij jou | Voor jou | kaart |
|---|---|---|---|---|---|
| H taak zonder `tekst` | `akkoord_nodig=false`, `scope=null` | volgt de rest van het dossier | het echte punt, of "Niets" | correct | geen kaart |
| I `afgerond` | `aan_zet=niemand` | NIET ACTIEF | "Deze taak is niet actief." | 0 | geen kaart |
| J `vervallen` | `aan_zet=niemand` | NIET ACTIEF | "Deze taak is niet actief." | 0 | geen kaart |
| K `review` | telt als actief, akkoord verwerkt | JARVIS AAN ZET | "Jarvis is aan zet." | 0 | AKKOORD |

De drie lagen sluiten op elkaar aan: `opdrachten.ts:823` vraagt geen akkoorden
op voor een gesloten dossier (`sluitDossier`), `overzicht.ts:939-941` eist
`actief && t.tekst !== undefined`, en `akkoordNodig` in de pagina (regel 809)
weigert op `sluitDossier(t.status) || !t.scope`. `leegWaarom` kent de tak
`"niemand"` en zegt "Deze taak is niet actief." De interfacetest dekt
`status: "afgerond"` expliciet; `!t.scope` is in de suite niet gedekt (onderdeel
van bevinding B1).

## SCOPECONTROLE

Zeven bestanden, alle binnen de beschreven wijziging. Buiten het plan gewijzigd:
niets. Geen test verwijderd of overgeslagen; `tests/jarvis/regie.test.ts` krijgt
alleen het nieuwe verplichte veld, en de wijziging in
`tests/jarvis/interface-waarheid.test.ts` is een noodzakelijke aanpassing van de
extractiehulp (`zetTekst`/`nulstand` roepen nu `zetVan` aan) — geen enkele
assertie is verzwakt of geschrapt. `docs/CURRENT_STATE.md` telt 42 → 43
testbestanden, wat klopt.

Geen geheimen, sleutels of verbindingsreeksen in de diff; `jarvis sanitize`
scande 44 bestanden en vond niets. De nieuwe query is geparametriseerd
(`$1`), dus ook geen injectiepad.

## REGRESSIECONTROLE

- Volledige suite op deze commit: 989 tests groen, inclusief de bestaande
  `overzicht.test.ts`, `regie.test.ts`, `interface-waarheid.test.ts` en
  `interface-indeling.test.ts`.
- Zelf nagemeten dat `aan_zet` voor alle andere waarden onveranderd blijft
  (`zetVan` geeft `jarvis`/`wacht`/`niemand` letterlijk terug).
- Zelf nagemeten dat de wachtsoorten (`wacht op gebeurtenis/uitvoerder/taak/pull
  request`) nog door `zetKort`/`zetTekst` komen — dat pad loopt nu over `zetVan`.
- Zelf nagemeten dat `bepaalRegie` op hetzelfde overzicht geen andere toestand
  geeft dan vóór de wijziging, behalve de bedoelde `WAITING_FOR_USER` →
  `QUEUED` bij een geldig akkoord.
- De poort (`workflow`, `rollen`, `index`, `state`, `sanitize`, `lint`) is
  groen met het QA-rapport in de werkboom.

## BEVINDINGEN

### Blokkerend

**B1 — De reparatie is niet geborgd: zeven sabotages op het productiepad laten
alle 989 tests slagen.** Vindplaatsen en bewijs in punt 7 hierboven. De
belangrijkste: `jarvis/src/opdrachten.ts:826` (de akkoordstand wordt doorgegeven
aan `bouwOverzicht` — vervang het argument door `null` en de hele wijziging is
dood, zonder dat één test protesteert), en de vier weergaveplaatsen in
`jarvis/interface/jarvis.html` (regel 399/406 `zetKort`/`zetTekst`, regel 952
`regieVerouderd`, regel 957-961 `leegWaarom`, regel 1123 de aanroep van
`ijkZetten`). Ongedekt zijn verder `heeftEigenPunten`
(`jarvis.html:380-382`) en de faal-dicht-richting van `leesTaakakkoorden`
(`opdrachten.ts:850` en `:859`).

Wat het nodig maakt om op te lossen — geen productiecode, alleen tests:

1. een test die `taakHtml` uitvoert (zoals het harnas hierboven: functies uit de
   pagina halen en draaien) en vastlegt dat statusregel, "Wie en waar" en "Bij
   jou uit deze taak" in de vier scenario's A/B/C/F hetzelfde zeggen;
2. een test die `ijkZetten` + `zetVan` samen draait, zodat S11 en S12 omvallen;
3. een test op het productiepad die vastlegt dat `bouwOverzichtVanuit` de
   gemeten stand doorgeeft (S15), bijvoorbeeld door `leesTaakakkoorden`
   exporteerbaar/injecteerbaar te maken of door de bouwkant met een stub-bron te
   draaien;
4. een test op de faal-dicht-richting: geen database ⇒ `akkoord_gemeten=false`
   en de vraag blijft staan (S13/S14);
5. een test op `!t.scope` in `akkoordNodig`.

### Niet-blokkerend (naar de projectbacklog, niet naar deze taak)

- **N1 — vijfde weergaveplaats, niet gecorrigeerd.** `teamHtml`
  (`jarvis/interface/jarvis.html:891-893`, tab "Team" → "Open taken") toont
  `t.toestand` en `t.waarom` rechtstreeks uit de regie, zonder `zetVan`. In het
  venster van scenario C staat daar dus nog "wacht op jou · de eigenaar is aan
  zet: …" terwijl de taakkaart "JARVIS AAN ZET" zegt. Minder prominent dan de
  vier genoemde plaatsen en het venster sluit bij de volgende bouw, maar het is
  dezelfde soort tegenspraak.
- **N2 — een beantwoord eigenaarspunt houdt de taak op "wacht op jou".** Eigen
  meting scenario G: een punt dat de eigenaar in de app heeft beantwoord maar dat
  nog in het dossier staat, geeft statusregel WACHT OP JOU terwijl het centrale
  "Voor jou" 0 telt. De regel is zichtbaar in "Bij jou uit deze taak" met een
  chip "wacht", dus de eigenaar staat niet met lege handen. Bestaand gedrag,
  buiten het akkoordpad, door deze wijziging niet geraakt.
- **N3 — N+1 bevragingen.** `leesTaakakkoorden` stelt één query per open taak
  over één verbinding, en opent/sluit een eigen verbinding náást die welke
  `opdrachtOverzicht`/`opdrachtRegie` daarna zelf openen. Bewust gekozen en
  gemotiveerd in de code (de allowlist van de Edge Function uitbreiden vraagt een
  uitrol van de eigenaar). Bij groei van het aantal open taken is één
  `distinct on`-statement de betere weg; dat is een losse backlogpost.
- **N4 — `await verbindDb()` staat buiten de `try`** (`opdrachten.ts:848`). Een
  uitzondering uit `verbindDb` zelf (bijvoorbeeld een onbruikbare
  verbindingsreeks) ontsnapt dus en laat `jarvis overzicht`/`jarvis regie`
  afbreken in plaats van terug te vallen op het dossier. Hetzelfde patroon staat
  al bij `schrijfActiviteit`, dus het is geen nieuwe fout, maar de vangnetgedachte
  van deze functie is ermee onvolledig.

Security-relevant voor de Knowledge Manager: bevinding B1 raakt de weg waarlangs
de eigenaar autoriseert. De les — "een correctielaag in de interface moet getoetst
worden op de plek waar zij wordt gelezen, niet alleen als pure functie" — verdient
vastlegging als kennisrecord; zij is nu de tweede keer in dezelfde code gemeten.

## EINDOORDEEL

**AFGEKEURD (NO-GO).**

Motivatie: het gedrag klopt. Ik heb in elf scenario's met de echte paginafuncties
op een echt gebouwd overzicht gemeten dat de vier plaatsen dezelfde werkelijkheid
tonen, in beide richtingen; dat een geldig akkoord de vraag laat verdwijnen en
een gewijzigde scope hem terugbrengt; dat een echt eigenaarspunt niet wordt
weggepoetst; dat zonder database de vraag blijft staan in plaats van te
verdwijnen; dat `zetVan` nooit aanscherpt; en dat de autorisatiecontrole niets
heeft verloren — `attestatie.ts` en `pr.ts` zijn ongewijzigd, lezen het akkoord
rechtstreeks uit de database en kennen het overzicht niet. De drie
projectcontroles zijn groen. Toch is dit geen goedkeuring: zeven sabotages op
precies het productiepad en de vier weergaveplaatsen laten alle 989 tests
slagen, waaronder één regel in `opdrachten.ts:826` die de volledige reparatie
uitschakelt. Daarmee is het gemelde defect vandaag verholpen en morgen niet
beschermd, op de weg waarlangs de eigenaar autoriseert. De oplossing vraagt geen
productiewijziging, alleen vijf tests; daarna is een volgende ronde kort.
