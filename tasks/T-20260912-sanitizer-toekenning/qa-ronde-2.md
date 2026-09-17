# QA-RAPPORT T-20260912-sanitizer-toekenning — ronde 2

Alle probewaarden in dit rapport staan bewust als plaatshouder (`<…>`), zodat dit
bestand — het ligt in `tasks/`, een gescand pad — de poort niet zelf rood maakt.

## ONAFHANKELIJKHEIDSVERKLARING

| Wat | Waarde |
|---|---|
| diff zelf gelezen | `origin/main...HEAD`, basis `fe24676`, kop `2ad93b2` (branch `jarvis/sanitizer-toekenning`), 4 gewijzigde bestanden |
| controles zelf gedraaid | ja, op 2026-09-15 17:38–17:43 UTC, op `jarvis/sanitizer-toekenning` @ `2ad93b2` |
| gebaseerd op het rapport van de bouwende rol | nee — `resultaat.md` is gelezen als wegwijzer, geen enkel oordeel hieronder steunt erop |
| eigen probes | 42 zelf bedachte probes (34 toekenning, 8 postadres) plus één end-to-end gang door de CLI-poort met een tijdelijk bestand in `tasks/`; alle tijdelijke bestanden verwijderd, werkboom schoon (`git status --porcelain` leeg) |

## UITGEVOERDE CONTROLES

| commando | uitkomst | relevante uitvoer |
|---|---|---|
| `npm test` (engine) | groen | `Test Files 30 passed (30)` · `Tests 728 passed (728)` |
| `npx vitest run tests/jarvis/sanitize-toekenning.test.ts` | groen | `Tests 58 passed (58)` |
| `npm run typecheck` (`tsc --noEmit`) | groen | geen uitvoer, exitcode 0 |
| `node bin/jarvis.mjs sanitize` (engine) | schoon | `39 bestand(en) gescand, niets gevonden` — exitcode 0 |
| `node …/bin/jarvis.mjs sanitize` (ToVas Flow) | schoon | `167 bestand(en) gescand, niets gevonden` — exitcode 0 |
| `node …/bin/jarvis.mjs sanitize` (Kasboek) | schoon | `22 bestand(en) gescand, niets gevonden` — exitcode 0 |
| `node bin/jarvis.mjs poort` (engine) | groen | workflow/engine/rollen/index/state/sanitize/lint alle schoon — **exitcode 0** |
| eigen end-to-end poortproef | poort slaat aan | tijdelijk `tasks/<probe>.md`: `KRITIEK … [toekenning_secret]` + `HOOG … [postadres_nl]`, **exitcode 1**; bestand daarna verwijderd |

Er is geen controle die ik niet kon draaien.

## OORDEEL PER ACCEPTATIECRITERIUM

| id | oordeel | bewijs uit eigen waarneming |
|---|---|---|
| AC-1 — de probeset: alle treffers gevonden, geen enkele niet-treffer gevlagd | **PASS** | `tests/jarvis/sanitize-toekenning.test.ts`, eigen run 2026-09-15 17:43 UTC: 58/58 groen. De probeset is echt tweezijdig: 10 treffers + 1 gatcontrole (`sanitize-toekenning.test.ts:58-84`), 24 losse niet-treffers (`:88-117`) en 5 regressieklassen uit ronde 1 (`:126-166`), plus postadres (`:196-235`) en Jarvis-id (`:218-239`). Geen test is `skip`, geen assertie is omgekeerd. |
| AC-2 — de drie repositoryscans blijven schoon | **PASS** | Drie eigen scans met de sanitizer van déze branch, 2026-09-15 17:40 UTC: engine 39/0, ToVas Flow 167/0, Kasboek 22/0, alle exitcode 0; `jarvis poort` in de engine exitcode 0. Dat de schone uitkomst geen dode letter is, toonde ik apart aan: een tijdelijk bestand met één korte toekenning en één postadres in `tasks/` gaf meteen `KRITIEK [toekenning_secret]` + `HOOG [postadres_nl]` en exitcode 1. |

Geen enkel criterium raakt een keten met een externe partij; er is dus geen
`PENDING-LIVE`.

### De vijf punten uit de opdracht, los van de acceptatie-eis

| punt | stand | eigen waarneming |
|---|---|---|
| 1 toekenningspatroon | gehaald, met één afwijking | `toekenning_secret` + `isEchteToekenning` (`jarvis/src/sanitize.ts:417-462`, def op `:813-827`), end-to-end KRITIEK bevestigd. Afwijking: de opdracht zegt "alleen buiten codeblokken die als voorbeeld zijn gemarkeerd"; de implementatie scant secrets **ook** binnen een voorbeeldblok (`sanitize.ts:1047-1051`, test `:171-174`). Dat is bestaand engine-ontwerp uit `main` — de voorbeeldmarkering onderdrukt uitsluitend contactgegevens — en de afwijking gaat de strenge kant op. Bewust, vastgelegd, geen bevinding die het werk tegenhoudt, wel iets waar de eigenaar van moet weten. |
| 2 postadrespatroon | gehaald | `postadres_nl`, categorie `pii`, eist straat én huisnummer én postcode (`sanitize.ts:766-778`); eigen probes A2/A3/A4 raak, losse postcode/jaartal/versienummer stil. |
| 3 meten tegen probeset en scans | gehaald | zie AC-1 en AC-2, beide door mijzelf herhaald. |
| 4 Jarvis-id ook in het entropiepatroon | gehaald | `isJarvisId` (`sanitize.ts:256-258`) is teken-voor-teken dezelfde uitdrukking als de regel die in `isVerdachtBase64` stond, en wordt nu óók aangeroepen in `isVerdachteEntropie` (`:313`). Geen gedragsverandering voor base64, wél de bedoelde uitbreiding voor entropie. |
| 5 RSK-0019 naar `beheerst` | **niet gedaan** | `/home/user/tovas-flow/knowledge/RISKS/RSK-0019.md:10` staat nog op `status: open`. Het record leeft in ToVas Flow en kán niet in deze engine-PR staan (`CLAUDE.md`: geen projectkennis in de engine). Het uitstel is beargumenteerd — tot ToVas Flow en Kasboek de nieuwe engine pinnen, draaien zij de oude sanitizer. Dat is verdedigbaar, maar het punt blijft open en moet worden bewaakt; zie bevinding NB-1. |

## SCOPECONTROLE

buiten het plan gewijzigd: **één ding**, inert.

- `jarvis/src/sanitize.ts:1064-1067` — `zoekTreffers` bouwt zijn zoeker nu met
  `g` + de vlaggen van de definitie in plaats van alleen `g`. Ik heb zelf
  nagegaan dat géén enkele definitie in `PATROON_DEFS` vandaag een vlag draagt,
  dus de reparatie verandert vandaag geen enkel gedrag; ze voorkomt een val voor
  een toekomstig hoofdletterongevoelig patroon. Verdedigbaar, maar zonder test
  (zie NB-5).
- `docs/CURRENT_STATE.md`: `Testbestanden 29 → 30`, gegenereerd feitenblok, klopt
  met de werkelijkheid (30 testbestanden in mijn eigen run).
- Verder uitsluitend `jarvis/src/sanitize.ts`, het nieuwe testbestand en
  `resultaat.md`. Geen aanpassing of verwijdering van bestaande tests, geen
  verzwakte drempel: `BASE64_MINIMUM_LENGTE` en `ENTROPIE_*` zijn ongemoeid.
- Geen geheim in de diff: alle waarden in het testbestand zijn verzonnen en
  `tests/` valt buiten `sanitize_paden`.

## REGRESSIECONTROLE

- Volledige suite op de branch: 728 tests, 30 bestanden, groen — inclusief de
  bestaande `tests/jarvis/sanitize.test.ts`. Geen enkele bestaande sanitizer-test
  moest worden aangepast om het nieuwe patroon groen te krijgen (de diff raakt
  alleen een nieuw testbestand).
- Voorrangsvolgorde: `toekenning_secret` staat bewust als laatste in
  `PATROON_DEFS`, zodat een leverancierspatroon dezelfde waarde eerst claimt. Ik
  heb dat in het gedrag zelf gezien: een toekenning met een Anthropic-sleutel
  komt onder `anthropic_api_key` naar buiten, niet als naamloze toekenning.
- `herkenLeveranciersSecret` slaat `toekenning_secret` over (`sanitize.ts:845-849`);
  dat is nodig omdat het een regelvormpatroon is en op een losse allowlist-waarde
  niets betekent. Zonder die uitzondering zou elke allowlist-token als
  "leverancierssecret" kunnen worden geduid.
- Drie eigen scans en de poort in de engine: schoon, exitcode 0.

## BEVINDINGEN

### blokkerend

geen.

### niet-blokkerend (naar de projectbacklog / kennislaag, niet naar deze taak)

**NB-1 — RSK-0019 staat nog op `open` en het uitstel is nergens als afspraak
vastgelegd.** `/home/user/tovas-flow/knowledge/RISKS/RSK-0019.md:10`. Punt 5 van
de opdracht is niet gehaald; de reden (engine moet eerst uit en gepind worden) is
juist, maar staat alleen in `resultaat.md` en niet in het risicorecord zelf. Wie
straks het record bijwerkt, moet ook de **restdekking** benoemen (NB-2 en NB-3),
anders belooft `beheerst` meer dan het patroon waarmaakt. Deze taak mag pas dicht
als dat gebeurd is; de engine-PR hoeft er niet op te wachten.

**NB-2 — de bewust aanvaarde vals-negatief is juist beargumenteerd, maar nog niet
in de kennislaag vastgelegd.** Een wachtwoord van uitsluitend letters glipt langs
`LOUTER_LETTERWOORDEN` (`sanitize.ts:410`). Ik heb dat end-to-end bevestigd: in
mijn tijdelijke probebestand bleef `DB_PASSWORD=<woord van alleen letters>` stil,
terwijl de regel ernaast met cijfers erin wél KRITIEK gaf.

*Is de afweging verdedigbaar?* Ja. De alternatieven zijn slechter: laat je
letterwoorden toe, dan gaat de poort af op elke `"key": "Cache-Control"`,
`"key": "X-Frame-Options"` en `no-referrer` in een `vercel.json` — precies de
klasse die de vorige poging deed terugdraaien, en een poort die ruis geeft wordt
uitgezet en bewaakt dan niets meer. De keuze offert bovendien niet de hele
dekking op: een letterwachtwoord in een verbindingsreeks valt nog steeds onder
`verbindingsreeks`, en elk gegenereerd credential heeft cijfers of een
voorvoegsel. *Is hij juist vastgelegd?* In de code (docblock bij
`LOUTER_LETTERWOORDEN`) en in `resultaat.md:122-126`: ja, expliciet en met
motief. In de **kennislaag**: nog niet — RSK-0019 beschrijft nog de oude
toestand. Dat is het gat dat NB-1 en dit punt samen moeten dichten.

**NB-3 — restklasse vals-negatieven die niet in de probeset staat.** Uit mijn
eigen probes, alle drie een realistische vorm:
1. Een naam waarin het sleutelwoord geen apart segment is, blijft stil. De
   standaard-Postgres-variabele `PGPASSWORD=<kort wachtwoord met cijfers>` gaf
   géén bevinding — ook niet in de end-to-end poortproef, waar hij naast een wél
   gevonden regel stond. `isCredentialNaam` (`sanitize.ts:394-402`) splitst op
   `_ . - [ ] " '` en camelCase, en `PGPASSWORD` is dan één segment. Zelfde
   klasse: `MYSQLPWD`, `SMTPPASS`.
2. `Authorization: Bearer <kort token>` blijft stil: `authorization` staat niet
   in `TOEKENNING_SLEUTELWOORDEN`, en zelfs mét dat woord zou de waardegreep bij
   `Bearer` stoppen (een letterwoord). Voor een lang bearer-token vangen
   `hoge_entropie`/`base64_geheim` het nog; voor een kort token niet.
3. Een markdown-tabelrij `| DB_PASSWORD | <kort wachtwoord> |` heeft geen
   toekenningsteken en valt buiten het patroon. Dat is een eerlijke grens van
   "toekenning", geen defect.

Geen van deze drie raakt een acceptatiecriterium, en 1 en 2 zijn met een kleine,
risicoarme uitbreiding te dekken (sleutelwoord óók als achtervoegsel van een
naam in hoofdletters). Waard om als vervolg te noteren, niet om deze PR voor te
blokkeren.

**NB-4 — restklasse vals-positieven, vandaag buiten de gescande paden.** Zes van
mijn niet-treffer-probes worden wél gevlagd. Alle zes vallen vandaag buiten
`sanitize_paden` van de drie repositories (die dekken `knowledge`, `tasks`,
`project`, `docs`, `jarvis`, `bin`, `.github`, `README.md` — geen `src/`), dus de
scans blijven terecht schoon. Ze kunnen wél in een taakdossier of kennisrecord
belanden:
- een vertaalstring met een zin als waarde: `"auth": "<nederlandse zin>"` —
  `LOUTER_LETTERWOORDEN` staat geen spatie toe, dus een zin telt als sleutel;
- een CI-cachesleutel: `key: <slug met cijfergroep>`;
- een datum als waarde: `sleutel_vervalt: <datum>` — precies de vorm van een
  front-matterveld in een rotatierecord;
- een pad als waarde: `key: <pad naar een pem-bestand>`;
- een URL als waarde: `auth=<https-url>`;
- een versiereeks als waarde: `"secret": "<semver met rc-achtervoegsel>"`.

Ze falen luid (exitcode 1), niet stil, dus de richting is veilig. Maar het is
dezelfde ruisklasse die de vorige poging fataal werd, en het dempen ervan kost
een allowlist-regel met de héle toekenning erin (`isToegestaan`,
`sanitize.ts:1019-1023`). Waard om als LRN vast te leggen mét de zes vormen,
zodat de volgende ronde ze als niet-treffers in de probeset kan zetten.

**NB-5 — `postadres_nl`: twee gaten en een over-redactie.**
- Een huisnummertoevoeging van meer dan één letter (`<nr>bis`, `<nr>hs`) valt
  buiten `\d{1,5}\s*[A-Za-z]?`: mijn probe met zo'n adres bleef stil.
- Een adres in kleine letters blijft stil (straat moet met een hoofdletter
  beginnen, postcodeletters moeten hoofdletters zijn). In een losse notitie is
  dat een realistische vorm.
- De treffer kan tot vier woorden vóór de straatnaam opslokken. Zelf gemeten:
  `sanitizeTekst` maakte van een zin die met drie gewone woorden begon en op een
  adres uitkwam één `[[GEREDIGEERD:postadres_nl:1]]`, inclusief die drie
  woorden. Over-redactie is de veilige kant, maar het maakt de zin onleesbaar.

**NB-6 — de vlaggenreparatie in `zoekTreffers` heeft geen test.** Zie
scopecontrole; vandaag inert, maar de volgende die een patroon met `i` toevoegt
heeft geen vangnet dat de vlag behouden blijft.

## EINDOORDEEL

**GOEDGEKEURD**

motivatie: beide acceptatiecriteria zijn PASS op eigen waarneming — de probeset
is 58/58 groen in mijn eigen run en is aantoonbaar tweezijdig opgezet, en de drie
repositoryscans plus `jarvis poort` zijn schoon met exitcode 0 op commit
`2ad93b2`. Ik heb apart aangetoond dat die schone uitkomst geen dode letter is:
een tijdelijk bestand met één korte toekenning en één postadres in een gescand
pad zette de poort onmiddellijk op KRITIEK/HOOG en exitcode 1, dus het patroon
doet in de echte gang wat de opdracht vroeg. De bewust aanvaarde vals-negatief
(een wachtwoord van uitsluitend letters) is een verdedigbare afweging — de
luidruchtige kant is wat de vorige poging fataal werd, en de dekking valt niet
weg omdat verbindingsreeksen en leverancierssleutels apart gedekt blijven — en
is in code en dossier expliciet vastgelegd, zij het nog niet in de kennislaag.
Wat openstaat, is punt 5 van de opdracht: RSK-0019 staat nog op `open` en kan
hier ook niet dicht, omdat het record in ToVas Flow leeft en het risico daar pas
beheerst is na een engine-release en het opnieuw pinnen. Dat blokkeert deze
engine-PR niet, maar het sluit de taak niet af: het risicorecord moet bij die
gelegenheid óók de restdekking uit NB-2 tot NB-5 benoemen, anders belooft
`beheerst` meer dan het patroon waarmaakt. Samenvoegen blijft een beslissing van
de eigenaar; dit rapport is daar geen toestemming voor.
