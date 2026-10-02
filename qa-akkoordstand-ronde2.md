# QA-RAPPORT — `jarvis/akkoord-uit-de-database` (PR #80) — ronde 2

Taak: `T-20261002-technische-uitvoering`, deeloplevering "het akkoord uit de
database telt mee in wie aan zet is". Kop `c61c0a0` ("Developer: de bedrading
getoetst, niet alleen de onderdelen").

## ONAFHANKELIJKHEIDSVERKLARING

```
diff zelf gelezen:        ed11a42..c61c0a0 (origin/main...HEAD), 9 gewijzigde bestanden
                          + 188289b..c61c0a0 (wat er sinds ronde 1 bij kwam), 5 bestanden
controles zelf gedraaid:  ja, 2026-10-02 17:21-17:33 UTC
                          branch jarvis/akkoord-uit-de-database, commit c61c0a0
eigen meetharnas:         ja - 15 sabotages van ronde 1 opnieuw gedraaid, plus 15 eigen
                          nieuwe; een eigen scenariotest met de echte paginafuncties
                          (tijdelijk, niet ingecheckt, na afloop verwijderd); een eigen
                          probe op de haakjesteller van paginafuncties.ts
gebaseerd op het rapport van de bouwende rol: nee
```

Werkboom bij aanvang en bij afsluiting schoon (`git status --short` leeg). Elke
sabotage is toegepast, gemeten en met `git checkout --` teruggedraaid; na de
laatste meting is de boom opnieuw geverifieerd als schoon.

## UITGEVOERDE CONTROLES

| commando | uitkomst | relevante uitvoer |
|---|---|---|
| `npm run typecheck` | **groen** | `tsc --noEmit`, exit 0 |
| `npm test` | **groen** | `Test Files 43 passed (43) · Tests 1009 passed (1009)` |
| `node bin/jarvis.mjs poort` | **groen** | exit 0; workflow byte-identiek, `rollen` 6 contracten, `index` actueel, `state` actueel, `sanitize` 44 bestanden niets gevonden, `lint` geen bevindingen |
| `git diff origin/main...HEAD --name-only` | — | `attestatie.ts`, `pr.ts`, `.github/`, `jarvis/canonical/`, `jarvis/edge/` staan **niet** in de diff |

Er is geen vierde projectcontrole: `package.json` kent alleen `typecheck`, `test`
en `poort`. Alle drie zijn gedraaid.

## 1. DE VIJFTIEN SABOTAGES VAN RONDE 1, OPNIEUW

Uitvoerend gemeten: elke sabotage toegepast op `c61c0a0`, daarna `tsc --noEmit`
en `vitest run` volledig gedraaid.

Noot vooraf: het rapport van ronde 1 benoemt S1-S3 en S6-S15 bij naam, maar niet
S4 en S5. Die twee zijn hieronder door mij gereconstrueerd op dezelfde twee
vlakken (de hashvergelijking en `akkoord_gemeten`); dat is als zodanig gemarkeerd.

| # | sabotage | typecheck | tests | valt om? |
|---|---|---|---|---|
| S1 | `!akkoordLigtEr &&` weg (`overzicht.ts:942`) | groen | 5 failed / 1004 passed | **ja** |
| S2 | hashvergelijking → `akkoorden.has(id)` (`overzicht.ts:938`) | groen | 2 failed | **ja** |
| S3 | `akkoord_gemeten: true` (`overzicht.ts:978`) | groen | 3 failed | **ja** |
| S4\* | `akkoorden.get(id) ?? scope_hash` (ontbrekend akkoord telt als geldig) | groen | 3 failed | **ja** |
| S5\* | `akkoord_gemeten: false` | groen | 1 failed | **ja** |
| S6 | `zetVan` krijgt een aanscherpende tak | groen | 1 failed | **ja** |
| S7 | vangrail `eigen_punten` uit `zetVan` | groen | 2 failed | **ja** |
| S8a | **`zetKort` leest weer `t.aan_zet`** (`jarvis.html:400`) | groen | **0 failed / 1009 passed** | **NEE** |
| S8b | `zetTekst` leest weer `t.aan_zet` (`jarvis.html:407`) | groen | 2 failed | **ja** |
| S9 | `${leegWaarom}` → vaste tekst "Jarvis is aan zet." | groen | 1 failed | **ja** |
| S10 | `regieVerouderd = false` (`jarvis.html:952`) | groen | 1 failed | **ja** |
| S11 | `ijkZetten();` uit `render()` (`jarvis.html:1123`) | groen | 1 failed | **ja**, maar alleen op de brontekst (zie 2) |
| S12 | `heeftEigenPunten` altijd `false` | groen | 1 failed | **ja** |
| S13 | geen verbinding ⇒ lege map i.p.v. `null` | groen | 1 failed | **ja** |
| S14 | `catch { return new Map(); }` | groen | 1 failed | **ja** |
| S15 | `bouwOverzicht(…, akkoorden)` → `…, null` (`opdrachten.ts:826`) | groen | 1 failed | **ja**, maar alleen op de brontekst (zie 2) |

\* eigen reconstructie; ronde 1 documenteert S4/S5 niet.

**De claim "alle zeven uit B1 vallen nu om" houdt geen stand.**

- **S8 valt maar half om.** Ronde 1 omschreef S8 als "`zetKort`/`zetTekst` lezen
  weer `t.aan_zet`". `zetTekst` wordt vastgehouden, `zetKort` niet: met
  `zetKort` terug op `t.aan_zet` slagen alle 1009 tests. `zetKort` voedt twee
  zichtbare plaatsen — het label onder een knoop in de kaart
  (`jarvis.html:652`) en de regel onder "Takken" in een project
  (`jarvis.html:935`). In het venster dat de eigenaar meldde zegt de kaart dan
  weer "wacht op jou" terwijl de taakkaart "JARVIS AAN ZET" zegt: dezelfde
  tegenspraak, een paneel verderop.
- **S15 en S11 vallen alleen om op hun letterlijke vorm.** Zie punt 2.

### Eigen nieuwe sabotages

| # | sabotage | tests | valt om? |
|---|---|---|---|
| E1 | `const akkoorden = await leesTaakakkoorden(…) && null;` (`opdrachten.ts:821-823`) | **1009 passed** | **NEE** — en de poort is ook groen |
| E2 | sleutel van de bevraging verminkt: `.map((t) => \`${t.id} \`)` | **1009 passed** | **NEE** |
| E3 | `.slice(0, 0)` achter de takenlijst: er wordt niets opgevraagd | **1009 passed** | **NEE** |
| E4 | body van `ijkZetten` leeggemaakt (`if (o) return;`) | 1 failed | ja |
| E5 | `ijkZetten()` blijft staan, maar `akkoord_open`/`eigen_punten` worden er direct na in `render()` op `false` gezet | **1009 passed** | **NEE** |
| E6 | kleur van het kaartlabel: `zetVan(t)` → `t.aan_zet` (`jarvis.html:652`) | **1009 passed** | **NEE** |
| E7 | CSS-klasse van de statusregel: `esc(zetVan(t))` → `esc(t.aan_zet)` (`jarvis.html:944`) | **1009 passed** | **NEE** |
| E8 | `nulstand`: `zetVan(t)` → `t.aan_zet` (`jarvis.html:1054`) | **1009 passed** | **NEE** |
| E9 | `t.akkoord_open = false` in `ijkZetten` | 2 failed | ja |
| E11 | lege `scope_hash` telt als akkoord (`opdrachten.ts:871`) | 1 failed | ja |
| E13 | `leegWaarom`: de eigenaar-tak vervlakt | 1 failed | ja |
| F1 | **géén gedragswijziging**: dezelfde aanroep meerregelig met slotkomma | 1 failed | ja (**valse alarm**) |
| F2 | géén gedragswijziging: variabele hernoemd naar `akkoordstand` | typecheck rood | ja (terecht via typecheck) |

E12 (laatste rij i.p.v. eerste) is geen sabotage: `AUTORISATIE_TAAK_SQL`
(`jarvis/src/db.ts:104`) eindigt op `order by op desc limit 1`, dus beide zijn
gelijk. Niet meegeteld.

## 2. ZIJN DE TWEE BRONTESTS STRENG GENOEG? NEE

### De verdediging klopt niet

De test zegt letterlijk (`tests/jarvis/akkoord-uit-de-database.test.ts:268-272`):
"`bouwOverzichtVanuit` leest de werkmap, git en de configuratie, dus zij valt
niet uit te voeren."

Dat is feitelijk onjuist, en het tegenbewijs staat in dezelfde suite.
`tests/jarvis/extern.test.ts:39` draait

```ts
const code = await voerUit(["overzicht", "--extern", `${FIXTURE},${kaal}`, "--uit", uit]);
```

`opdrachtOverzicht` (`opdrachten.ts:905-906`) roept `bouwOverzichtVanuit` aan,
die `laadAlles()`, `leesGitLog`, `leesTaakDossiers` en `leesTaakakkoorden`
doorloopt en het volledige overzicht als JSON wegschrijft. Die weg bestaat
dus, draait vandaag in CI, en er is een fixture voor
(`jarvis/fixtures/demo-project`). "Niet uit te voeren" is weerlegd door de
testsuite zelf.

Wat werkelijk ontbrak is niet uitvoerbaarheid maar een naad om de akkoordstand
te sturen — en precies die naad is in deze commit één niveau lager wél gemaakt
(`leesTaakakkoorden` kreeg een injecteerbare `verbind`). Dezelfde techniek één
niveau hoger (`bouwOverzichtVanuit(vlaggen, leesAkkoorden = leesTaakakkoorden)`)
maakt de doorgifte een uitgevoerd gedrag in plaats van een vorm.

### De brontest is te omzeilen, met gedragsverlies

`/bouwOverzicht\(([^)]*)\)/` plus `/const akkoorden = await leesTaakakkoorden\(/`
legt de *vorm* van één aanroep vast, niet wat eruit komt. Drie eenregelige
wijzigingen passeren hem:

- **E1** — `const akkoorden = await leesTaakakkoorden(…) && null;` Een `Map` is
  waarheidswaarde `true`, dus `akkoorden` is voortaan altijd `null`. Dit is
  S15, exact, met een ander gezicht: de database telt niet meer mee, elke bouw
  valt terug op het dossier. Gemeten: `tsc --noEmit` exit 0, `vitest run`
  **1009 passed**, `node bin/jarvis.mjs poort` **exit 0**. Niets in het project
  merkt het.
- **E2** — de taak-id's worden verminkt opgevraagd (`` `${t.id} ` ``). De stand
  komt terug met sleutels die nergens op passen; geen akkoord wordt ooit nog
  herkend. 1009 passed.
- **E3** — `.slice(0, 0)`: er wordt niets opgevraagd, `leesTaakakkoorden`
  retourneert een **lege map** (de `taken.length === 0`-tak). Dat is de
  verkeerde kant op: `akkoord_gemeten` wordt `true` terwijl er niets gemeten
  is. 1009 passed.

E2 en E3 zijn geen bedachte kunstgrepen maar precies de soort fout die bij een
refactor van die `flatMap` ontstaat — en dat is wat de test had moeten vangen.

### En hij geeft vals alarm

**F1**: dezelfde aanroep meerregelig opgeschreven met slotkomma — een
gedragsneutrale herindeling — maakt de suite rood, omdat `split(",")` dan vijf
elementen oplevert. Een test die het verkeerde gedrag doorlaat én het goede
gedrag afkeurt, stuurt onderhoud de verkeerde kant op: hij wordt bij de eerste
herindeling aangepast in plaats van serieus genomen.

### De tweede brontest (`ijkZetten` in `render`)

Die is beter: hij bewaakt een volgorde die werkelijk ter zake doet, en de
inhoud van `ijkZetten` is daarnáást gedragsmatig gedekt (E4 en E9 vallen om).
Maar ook hij bewaakt alleen het aanroeppunt: **E5** laat `ijkZetten()` staan en
zet `akkoord_open`/`eigen_punten` er in `render()` direct na weer op `false` —
1009 passed, correctielaag dood. Lichter dan de eerste, en ik merk hem aan als
niet-blokkerend, maar het is dezelfde zwakte.

## 3. IS `paginafuncties.ts` BETROUWBAAR? JA — EN HET FAALT LUID

Eigen probe (`node`, eigen herimplementatie van `paginaStuk`, buiten de
repository):

- **Alle 71 top-level `function`-declaraties** in `jarvis/interface/jarvis.html`
  worden correct afgebakend en parseren alle 71 met `new Function`. Geen enkele
  wordt vandaag verkeerd geknipt.
- Elk valkuilgeval dat ik kon construeren, faalt **luid**:

| geval | uitkomst |
|---|---|
| string met losse `}` | `SyntaxError: Invalid or unexpected token` bij `new Function` |
| string met losse `{` | `Error: de functie f is niet afgesloten in jarvis.html` |
| regelcommentaar met `}` | `SyntaxError: Unexpected token ')'` |
| blokcommentaar met `}` | `SyntaxError` |
| regex met losse `}` (`/[}]/`) | `SyntaxError: Invalid regular expression` |
| sjabloonstring met losse `}` | `SyntaxError: Unexpected end of input` |
| regex met `{2}` | correct — haakjes zijn in balans |
| ontbrekende afhankelijkheid (`rolKaartHtml`) | `ReferenceError` bij aanroep — zelf tegengekomen tijdens mijn eigen harnas |

De reden dat het luid faalt, is structureel en niet toevallig: een verkeerde
afbakening levert vrijwel altijd syntactisch kapotte JavaScript op, en
`new Function` parseert het geheel vóór er iets draait.

Twee kanttekeningen, geen van beide blokkerend:

- **De toelichting klopt niet.** `paginafuncties.ts:27-29` schrijft dat de
  haakjestelling een `}` in een sjabloonstring niet laat afkappen. Dat doet zij
  niet: de teller kent strings, commentaar en regex niet. Het gaat vandaag goed
  omdat `${…}` beide haakjes meebrengt en de pagina nergens een los haakje in
  een string heeft. Een onjuiste geruststelling in een commentaar is op termijn
  gevaarlijker dan geen commentaar.
- **Eén stil geval bestaat.** Een meerregelige `const` waarvan de eerste regel
  op zichzelf een geldige expressie is, wordt stil afgekapt:
  `const A = 1\n  + 2;` levert `1`. De code eist eenregelige constanten
  (regel 31) maar dwingt dat niet af. Komt vandaag niet voor.

## 4. DE EXPORT EN DE INJECTIE VAN `leesTaakakkoorden` — GEEN VERZWAKKING

`jarvis/src/opdrachten.ts:846-854`. Beoordeeld tegen AC-8.

- De parameter is **optioneel** met de productiewaarde als standaard
  (`verbind: () => … = verbindDb`). De enige productie-aanroep
  (`opdrachten.ts:821`) geeft hem niet mee; gedrag in productie is
  byte-identiek aan ervoor.
- Injectie is alleen bereikbaar voor code die de module importeert, dus code
  die al in het engineproces draait. Er is geen CLI-vlag, geen
  omgevingsvariabele en geen gegeven uit de database dat de parameter kan
  zetten. Geen nieuw aanvalsoppervlak van buiten.
- Wat de functie leest is één `select` met `limit 1`, geparametriseerd (`$1`),
  op een statement dat al in de allowlist van de Edge Function stond
  (`jarvis/src/db.ts:312`). Er wordt niets geschreven.
- Het resultaat voedt uitsluitend `TaakItem.akkoord_nodig` en
  `TaakItem.akkoord_gemeten`. `attestatie.ts` en `pr.ts` staan niet in de diff,
  importeren `overzicht.ts` niet, en lezen het akkoord rechtstreeks uit de
  database. Een gemanipuleerde injectie kan dus een weergave vervalsen, niet
  een samenvoeging autoriseren.
- De `finally` sluit de verbinding ook bij een worp; dat is uitvoerend
  vastgelegd (`"geeft null wanneer de bevraging werpt, en sluit de verbinding
  alsnog"`) en ik heb de bijbehorende sabotage (S14) zien omvallen.

Dit is de goede soort naad, en hij hoort één niveau hoger ook te staan — zie
bevinding B1.

## 5. HERTOETSING VAN DE ACHT PUNTEN UIT RONDE 1

| # | punt | ronde 1 | ronde 2 | grond |
|---|---|---|---|---|
| 1 | vier plaatsen, beide richtingen | PASS | **PASS** | eigen harnas met de echte paginafuncties: geldig akkoord ⇒ `JARVIS AAN ZET`, `zetKort` "Jarvis aan zet", "Voor jou" 0; gewijzigde scope ⇒ `WACHT OP JOU`, "Voor jou" 1; venster C ⇒ `JARVIS AAN ZET` met uitleg |
| 2 | geen akkoordvraag bij een geldig akkoord | PASS | **PASS** | eigen meting: `akkoord_nodig=false`, `aan_zet="jarvis"`; S1 valt om |
| 3 | akkoord op gewijzigde scope vervalt | PASS | **PASS** | eigen meting; S2 en S4 vallen om |
| 4 | AC-8, geen verruiming | PASS | **PASS** | diff in `opdrachten.ts` beperkt tot twee hunks (import + `bouwOverzichtVanuit`/`leesTaakakkoorden`); `attestatie.ts`, `pr.ts`, `.github/`, `jarvis/canonical/`, `jarvis/edge/` ongewijzigd; poort exit 0 |
| 5 | faalt de goede kant op zonder database | PASS | **PASS, versterkt** | N4 is verholpen: een worp uit `verbindDb()` zelf geeft nu `null`, uitvoerend getoetst; S13/S14 vallen om; eigen meting: zonder meting blijft de vraag staan |
| 6 | `zetVan` zwakt alleen af | PASS | **PASS** | eigen eigenschapstoets over 90 combinaties van `aan_zet` × `akkoord_nodig` × `akkoord_open` × `eigen_punten`: `zetVan` geeft nooit iets anders terug dan de invoer, behalve `eigenaar → jarvis` |
| 7 | zijn de nieuwe tests echte tests | FAIL | **FAIL** | zie B1 en B2 |
| 8 | taak zonder `tekst`, gesloten status | PASS | **PASS, versterkt** | eigen meting: `afgerond`/`vervallen` ⇒ `aan_zet="niemand"`, `akkoord_nodig=false`; dossier zonder `tekst` ⇒ `scope_hash=null`, `akkoord_nodig=false`. Het gat van ronde 1 (`!t.scope`) is gedicht door de test op regel 237 |

**Geen regressie waargenomen** op de punten 1-6 en 8.

## SCOPECONTROLE

Negen bestanden; sinds ronde 1 kwamen `tests/jarvis/paginafuncties.ts` (nieuw),
275 regels in `tests/jarvis/akkoord-uit-de-database.test.ts`, 19 regels in
`opdrachten.ts`, 14 regels in `docs/CURRENT_STATE.md` en `qa-akkoordstand.md`
erbij. Buiten het plan gewijzigd: niets.

Geen test verwijderd, overgeslagen of verzwakt. `grep` over `tests/` vindt geen
`.skip`, `.only`, `.todo` of `xit`. De verwijderde regels in
`akkoord-uit-de-database.test.ts` zijn de oude, zelfgebouwde extractiehulp en
de oude `akkoordNodig`-test; beide zijn vervangen door een **strengere** vorm —
de nieuwe test gebruikt de échte `akkoordVan` uit de pagina in plaats van een
stub, en voegt het geval `!t.scope` toe.

Geen geheimen, sleutels of verbindingsreeksen in de diff; `jarvis sanitize`
scande 44 bestanden en vond niets.

Eén opmerking van orde: `qa-akkoordstand.md` (mijn rapport van ronde 1) staat
als commit in de branch en zou zo naar `main` gaan — 308 regels QA-verslag in
de hoofdmap van de engine, buiten `tasks/`. Niet blokkerend, zie N5.

## REGRESSIECONTROLE

- Volledige suite op `c61c0a0`: 43 bestanden, 1009 tests groen (989 → 1009; de
  20 nieuwe tests zijn de 5 op `leesTaakakkoorden`, 7 scenario's, 2 brontests en
  6 op `akkoordNodig`/`zetVan`).
- `zetVan` zelf nagemeten over alle 90 invoercombinaties: nooit aanscherpend.
- Zelf nagemeten dat `teamHtml` nog draait en wat hij zegt: in het venster van
  scenario C meldt "Open taken" nog altijd *1 bij de eigenaar* terwijl de
  taakkaart "JARVIS AAN ZET" zegt. Dat is N1 van ronde 1, ongewijzigd — niet
  geregresseerd, ook niet opgelost.
- `extern.test.ts` draait het hele `overzicht`-commando end-to-end en blijft
  groen; de wijziging in `bouwOverzichtVanuit` breekt dat pad niet (en de
  hernoemsabotage F2 liet zien dat dit pad werkelijk wordt uitgevoerd).
- Poort groen met beide QA-rapporten in de werkboom.

## BEVINDINGEN

### Blokkerend

**B1 — De sabotage die de hele reparatie uitschakelt, is nog steeds niet
geborgd; zij is alleen van vorm veranderd.** Vindplaats:
`tests/jarvis/akkoord-uit-de-database.test.ts:267-287` tegenover
`jarvis/src/opdrachten.ts:821-826`. De brontest legt de letterlijke vorm van
één aanroep vast, niet haar uitkomst. Gemeten: `E1`
(`… = await leesTaakakkoorden(…) && null;`) laat `akkoorden` altijd `null` zijn —
identiek aan S15 — met `tsc` exit 0, **1009 tests groen** en **de poort exit 0**.
`E2` (verminkte taak-id's) en `E3` (`.slice(0,0)`, waardoor de functie een
*lege map* teruggeeft en `akkoord_gemeten` ten onrechte `true` wordt) passeren
eveneens alle 1009 tests. Daarbovenop geeft de test vals alarm op een
gedragsneutrale herindeling (`F1`).

De motivering in de test ("`bouwOverzichtVanuit` valt niet uit te voeren") is
weerlegd door `tests/jarvis/extern.test.ts:39`, dat precies dat pad al end-to-end
draait. De oplossing vraagt geen productiewijziging van betekenis en gebruikt de
techniek die in deze commit al is toegepast: geef `bouwOverzichtVanuit` een
optionele `leesAkkoorden = leesTaakakkoorden`, draai haar met een stub die (a)
registreert welke taak-id's zijn opgevraagd en (b) een bekende hash teruggeeft,
en stel vast dat een open taak uit de fixture daarna `akkoord_nodig=false` heeft.
Die ene test vangt E1, E2, E3 én S15, en vervalt niet bij een herindeling.
De brontest mag daarna weg.

**B2 — Vier van de zeven leesplaatsen van `zetVan` zijn ongedekt; één ervan was
met zoveel woorden onderdeel van B1 uit ronde 1.** Elk van deze vier laat alle
1009 tests slagen:

1. `jarvis/interface/jarvis.html:400` — `zetKort` leest weer `t.aan_zet` (de
   onbesproken helft van S8). Zichtbaar in het knooplabel van de kaart
   (`:652`) en in de regel onder "Takken" (`:935`): daar staat dan "wacht op
   jou" terwijl de taakkaart "JARVIS AAN ZET" zegt.
2. `jarvis.html:652` — de kleur van datzelfde label leest `t.aan_zet`.
3. `jarvis.html:944` — de CSS-klasse van de statusregel (`class="zet …"`) leest
   `t.aan_zet`: de tekst zegt "JARVIS AAN ZET" in de opmaak van "wacht op jou".
4. `jarvis.html:1054-1056` — `nulstand`, de centrale "er is niets voor
   jou"-tekst, leest weer `t.aan_zet` en telt de taak weer als "bij jou".

Deze vier zijn goedkoop te dekken: de bestaande `wereld()`-helper geeft al een
echte `staat`; er zijn enkele asserties bij nodig op `zetKort(t)`, op de
`class="zet …"` in de uitvoer van `taakHtml`, en op `nulstand(o, acties)` in de
scenario's B en C.

### Niet-blokkerend (naar de projectbacklog, niet naar deze taak)

- **N1 — vijfde weergaveplaats, nog steeds niet gecorrigeerd.** `teamHtml`
  (`jarvis.html:886-897`, tab "Team" → "Open taken") leest `t.toestand` en
  `t.waarom` rechtstreeks uit de regie. Zelf nagemeten in het venster van
  scenario C: "bewaakt 1 open taak: 0 uitvoerbaar, **1 bij de eigenaar**".
  Ongewijzigd sinds ronde 1.
- **N2 — een beantwoord eigenaarspunt houdt de taak op "wacht op jou".**
  Ongewijzigd sinds ronde 1, buiten het akkoordpad.
- **N3 — N+1 bevragingen in `leesTaakakkoorden`.** Ongewijzigd en bewust;
  één `select distinct on` vraagt een uitrol van de Edge Function.
- **N4 — het aanroeppunt van `ijkZetten` is geborgd, de uitwerking erna niet.**
  `E5` laat `ijkZetten()` staan en overschrijft `akkoord_open`/`eigen_punten`
  er direct na: 1009 groen, correctielaag dood. Lichter dan B1 omdat de
  scenariotests de inhoud van `ijkZetten` wél dekken (E4, E9 en S12 vallen om).
- **N5 — `qa-akkoordstand.md` is in de branch gecommit.** 308 regels QA-verslag
  in de hoofdmap van de engine, buiten `tasks/`. Hoort in het taakdossier of
  buiten de repository, niet in de hoofdmap van `main`.
- **N6 — het commentaar bij de haakjesteller belooft meer dan de code doet.**
  `tests/jarvis/paginafuncties.ts:27-29` schrijft dat een `}` in een
  sjabloonstring de afbakening niet afkapt; de teller kent strings, commentaar
  en regex niet. Het gaat vandaag goed, maar de geruststelling is onjuist.
- **N7 — stil geval in `paginaStuk`.** Een meerregelige `const` waarvan de
  eerste regel een geldige expressie is, wordt stil afgekapt
  (`const A = 1\n + 2;` ⇒ `1`). De eenregelige eis staat in commentaar maar
  wordt niet afgedwongen; een `throw` wanneer de regel niet op `;` eindigt,
  maakt ook dit luid.
- **N8 — ronde 1 documenteerde S4 en S5 niet.** Een sabotagelijst die het
  vervolg moet kunnen herhalen, hoort compleet te zijn. Ter lering voor het
  QA-rapportsjabloon.

Security-relevant voor de Knowledge Manager, ongewijzigd en nu voor de derde
keer in dezelfde code gemeten: *een correctielaag in de interface moet getoetst
worden op de plek waar zij wordt gelezen, niet alleen als functie* — en, nieuw
uit deze ronde: *een test op brontekst borgt een vorm, geen gedrag; wie zo'n
test schrijft, moet eerst aantonen dat de uitvoerbare weg werkelijk is
afgesloten.* Beide verdienen vastlegging als kennisrecord.

## EINDOORDEEL

**AFGEKEURD (NO-GO).**

Motivatie: dit is een echte en forse stap vooruit. Van de vijftien sabotages van
ronde 1 vallen er nu dertien om in plaats van zeven; de scenariotests draaien de
werkelijke paginafuncties op een werkelijk gebouwd overzicht en leggen de vier
weergaveplaatsen naast elkaar in beide richtingen; `leesTaakakkoorden` is
uitvoerend getoetst op zijn faalrichting, inclusief de worp uit `verbindDb()`
zelf die in ronde 1 nog N4 was; `paginafuncties.ts` is solide en faalt luid;
het gedrag klopt en de punten 1 tot en met 6 en 8 zijn zonder regressie. De drie
projectcontroles zijn groen. Toch is het antwoord nee, om twee redenen die
rechtstreeks terugslaan op de bevinding van ronde 1. De sabotage die de hele
reparatie uitschakelt is niet geborgd maar van vorm veranderd: drie eenregelige
varianten — waaronder één die `akkoorden` permanent `null` maakt — passeren
typecheck, alle 1009 tests én de poort, terwijl de motivering voor die
brontest ("niet uit te voeren") door `extern.test.ts` in dezelfde suite wordt
weerlegd. En de helft van sabotage S8, met name genoemd in B1, komt er nog
steeds doorheen, samen met drie verwante leesplaatsen van `zetVan`. Het werk
dat rest is klein en vraagt opnieuw vrijwel geen productiewijziging: één
injecteerbare naad in `bouwOverzichtVanuit` met één uitvoerende test, en een
handvol asserties in de bestaande `wereld()`-scenario's.
