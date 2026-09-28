---
id: T-20260917-eigenaarinteracties
titel: Een eigenaarinteractie toont wat zij werkelijk is - een keuze krijgt opties, een akkoord een akkoordknop, en alleen een externe handeling krijgt "Gedaan"
status: actief
klasse: L
risico: A
project: jarvis
aangevraagd_door: lodewijk
datum: 2026-09-17
gebieden:
  - jarvis
  - engine
  - interface
  - governance
---

## Wat de opdrachtgever vroeg

2026-09-17 11:33 UTC, bericht in de Jarvis-interface bij het item
`tovas-flow:T-20260914-eigen-laag:4fca1d68`. De eigenaar moest daar inhoudelijk
kiezen tussen optie (a) en optie (b), maar de interface bood hem alleen de
knoppen "Gedaan" en "Later". Zijn woorden: *"Dat is semantisch onjuist: op het
moment dat de kaart wordt getoond heb ik nog niets gedaan; ik moet eerst een
keuze maken. Ik heb mijn keuze nu noodgedwongen via het gesprek gegeven."*

Hij vroeg nadrukkelijk niet alleen deze kaart te repareren, maar het
onderliggende patroon, en dat te bewijzen. Gewenste werking, in zijn nummering:

1. Classificeer eigenaarinteracties naar hun werkelijke betekenis, minimaal:
   akkoord/autorisatie; inhoudelijke keuze tussen opties; externe handeling die
   alleen de eigenaar kan uitvoeren; bevestiging dat een handeling daadwerkelijk
   is uitgevoerd; uitstellen.
2. Een inhoudelijke keuze toont de daadwerkelijke opties als keuzemogelijkheden,
   bijvoorbeeld "Optie A" en "Optie B", met voldoende uitleg over de gevolgen.
3. "Gedaan" alleen wanneer er werkelijk een externe handeling van hem wordt
   gevraagd die Jarvis niet zelf kan uitvoeren en hij daarna moet bevestigen dat
   die handeling is uitgevoerd.
4. Een akkoordknop alleen wanneer de governance daadwerkelijk een
   eigenaarautorisatie vereist.
5. Geeft hij een keuze of akkoord via het gesprek bij de taak en kan Jarvis die
   ondubbelzinnig aan de open eigenaaractie koppelen, dan wordt die input in
   dezelfde onderliggende actie verwerkt. Niet daarna nogmaals via een knop
   laten bevestigen.
6. Zodra de vereiste eigenaarinput geldig is verwerkt, sluit de bijbehorende
   eigenaaractie automatisch en verdwijnt hij uit "Voor jou".
7. Dezelfde inhoudelijke vraag komt niet tegelijkertijd of achtereenvolgens als
   verschillende eigenaaracties terug, tenzij nieuwe feiten aantoonbaar een
   nieuwe beslissing vereisen.
8. "Voor jou" blijft de minimale actuele exception queue: ieder item vereist nu
   aantoonbaar een handeling van hem en iedere nu vereiste handeling staat er
   precies één keer.

Onderzoek of hetzelfde probleem bij andere bestaande eigenaaracties voorkomt en
herstel daar dezelfde oorzaak. Uitvoeropdracht: onderzoek, structurele
reparatie, tests, QA/governance, uitrol en verificatie zelfstandig. Alleen
terugkomen als de governance zijn akkoord eist, een handeling technisch alleen
door hem kan worden uitgevoerd, of er een nieuwe inhoudelijke keuze ontstaat die
niet uit bestaande besluiten valt af te leiden.

## Oorzaak (gemeten 2026-09-17, cloud, in de gepinde engine `a89bf30`)

De eigenaarskaarten uit taakdossiers worden gebouwd in
`jarvis/src/overzicht.ts` van de engine, in de lus over
`leesItemsOnder(taak.resultaat, KOP_EIGENAAR)` (rond regel 647-668). Daar
gaan vier dingen mis, en ze verklaren samen precies wat de eigenaar zag.

**(1) De classificatie hangt aan één woord.** Het soort van een item is
`beslissing` als - en alleen als - de context "blokkerend" bevat of de titel met
`beslis` begint:

```ts
const beslissing = blokkerend || /^beslis/i.test(item.titel);
soort: beslissing ? "beslissing" : "actie",
```

Het item van de eigenaar had als titel *"kies tussen (a) een vercel.json met een
ignoreCommand die de"*. Dat begint met "kies", niet met "beslis", en de context
noemde het niet blokkerend. Gevolg: `soort: "actie"`, en daarmee
`STANDAARD_ACTIE` - één knop, "Gedaan", plus "Later". Een keuze die toevallig
niet met het juiste werkwoord begint, wordt dus als handeling aangeboden. Er is
geen classificatie naar betekenis; er is een woordtoets.

**(2) De opties worden niet uit de keuze afgeleid.** `bouwOpties` maakt alleen
echte keuzemogelijkheden van optieregels (`- Optie A: …`); regels met het label
`Stap N`, `Advies`, `Waarom` en `Controle` krijgen een eigen plek en tellen niet
als optie. De keuze stond in het dossier ingebed in één stapregel - *"- Stap 1:
kies tussen (a) een `vercel.json` met een `ignoreCommand` …, of (b) niets doen
…"*. Er waren dus geen optieregels, en zonder optieregels valt de kaart terug op
de standaardopties van het soort. De twee alternatieven die de eigenaar wél
kreeg voorgelegd in de tekst, bereikten de knoppen niet.

**(3) De titel wordt midden in de zin afgekapt.** De kaarttitel is het begin van
de stapregel: *"kies tussen (a) een vercel.json met een ignoreCommand die de"*.
De eigenaar kreeg een half afgemaakte vraag te zien, met de gevolgen alleen in
de toelichting.

**(4) Van gesprek naar item loopt geen weg terug.** De eigenaar gaf zijn keuze
in het gesprek bij het item; het bericht draagt `context.item_id`. Niets koppelt
zo'n bericht aan de open eigenaaractie: een item uit een taakdossier verdwijnt
alleen als de dossiertekst verandert (gemeten en vastgelegd in
`T-20260917-voor-jou-reconciliatie`). Zonder die koppeling blijft de kaart staan
en zou dezelfde beslissing daarna alsnog via een knop bevestigd moeten worden -
precies wat punt 5 en 6 verbieden.

**Voorspelling uitgekomen - gemeten 2026-09-18 08:44 UTC (cloud).** Punt (4)
is geen theoretisch risico gebleken. De eigenaar drukte op "Gedaan" bij precies
de kaart die hierboven als voorbeeld dient: item
`tovas-flow:T-20260914-eigen-laag:4fca1d68`, titel *"kies tussen (a) een
vercel.json met een ignoreCommand die de"*, soort `actie`, keuze `gedaan`. De
keuze zelf was op 2026-09-17 11:33 UTC al in het gesprek bij het item gegeven
en als `DEC-0049` vastgelegd; het dossier van `T-20260914-eigen-laag` noemt het
item sindsdien gesloten. De kaart stond er niettemin nog, en de eigenaar heeft
hem alsnog met een knop moeten afsluiten - precies de dubbele bevestiging die
punt 5 en 6 verbieden. Inhoudelijk verandert er niets: `DEC-0049` blijft staan
en de bouw blijft werk van Jarvis.

Twee oorzaken houden zo'n kaart in de lucht, en ze versterken elkaar. De eerste
is punt (4): van het gesprek loopt geen weg terug naar het item. De tweede is
in dezelfde run gemeten: `npx jarvis overzicht` weigerde opnieuw te schrijven -
`4 bevinding(en) in de uitvoer; niets geschreven`, op de regels 1674, 2122,
2402 en 3850, alle `hoge_entropie` en alle gemaskeerd als `clo...`. Op
2026-09-15 was dat nog één bevinding (zie de engine-backlog in
`T-20260914-eigen-laag`); het worden er dus meer, niet minder. Zolang
`overzicht/huidig` niet geschreven wordt, toont de app een oudere stand en
blijft ook een kaart zichtbaar die in het dossier allang gesloten is. De eerste
oorzaak maakt de kaart onsluitbaar vanuit het gesprek, de tweede laat hem ook
na een dossierwijziging nog staan. De uitvoering van deze taak moet ze allebei
raken; alleen de koppeling gesprek-naar-item herstellen is niet genoeg.

**Komt dit vaker voor?** Ja. Dezelfde vier oorzaken raken elk dossierpunt dat
een keuze in een stapregel zet, en elk punt dat om een akkoord vraagt zonder dat
`akkoord_nodig` op de taak staat. De inventarisatie per bestaand item hoort bij
acceptatiecriterium 7 en gebeurt in de uitvoering.

## Verhouding tot lopend werk

`T-20260917-voor-jou-reconciliatie` (engine-PR #49) repareert een aangrenzend
maar ander stuk: dát een item nog terecht in de lijst staat (reconciliatie,
afgevinkte punten, akkoordvragen naar `akkoord_nodig`). Deze taak gaat over hóé
een item dat terecht in de lijst staat aan de eigenaar wordt voorgelegd. De twee
mogen elkaar niet overschrijven: de bouw hier gaat op de engine-kop die #49
oplevert, en de invarianten van #49 blijven gelden.

## Acceptatiecriteria

1. **Classificatie naar betekenis.** Een eigenaarinteractie krijgt een soort uit
   een expliciete, benoemde verzameling die minimaal dekt: `akkoord`,
   `keuze`, `externe-handeling`, `bevestiging`, `uitstel`. De classificatie leunt
   niet op het toevallige eerste woord van een titel. Test: een keuzepunt dat met
   "kies", "bepaal" of "welke" begint wordt `keuze`; de test faalt op de code van
   vóór de wijziging.
2. **Een keuze toont opties.** Een item van soort `keuze` biedt de daadwerkelijke
   alternatieven als keuzemogelijkheden, elk met de gevolgen erbij, en biedt
   `Gedaan` niet aan. Alternatieven die in één regel staan ("(a) … of (b) …")
   worden herkend, of het dossierformaat dwingt aparte optieregels af via `lint`.
   Test per geval, falend op de oude code.
3. **"Gedaan" alleen bij een externe handeling.** Een item biedt `Gedaan` alleen
   aan als het soort `externe-handeling` of `bevestiging` is. Test.
4. **Akkoordknop alleen bij governance.** Een akkoordactie verschijnt alleen als
   de governance een eigenaarautorisatie vereist (`akkoord_nodig` op de taak of
   een `akkoord_pr`-context), nooit als vervanging van een keuze. Test.
5. **Keuze via het gesprek telt.** Een bericht van de eigenaar met een
   `context.item_id` dat ondubbelzinnig op een open eigenaaractie wijst, wordt in
   diezelfde actie verwerkt; de eigenaar hoeft niet daarna nog een knop te
   bedienen. Test.
6. **Automatisch sluiten.** Zodra geldige eigenaarinput is verwerkt, sluit de
   bijbehorende eigenaaractie en verschijnt hij niet opnieuw onder "Voor jou".
   Test: een reeds verwerkte keuze komt niet terug.
7. **Eén beslissing, één actie.** Eén onderliggende eigenaarbeslissing levert
   hoogstens één actuele eigenaaractie op, ook wanneer dezelfde vraag in meerdere
   bronnen staat (dossierpunt, akkoordkaart, PR-akkoord). Test.
8. **Bewijs op de echte lijst.** De inventarisatie van alle bestaande
   eigenaaracties op het moment van oplevering, per item met soort en knoppen, en
   de meting dat elk item aan criteria 1-4 voldoet. Zo niet, dan is het hersteld.
9. **Rood-tegen-oud.** Iedere test onder 1-7 faalt aantoonbaar op de engine-code
   van vóór de wijziging, gemeten met de bronbestanden van de merge-base
   uitgecheckt (zie de procesles in `T-20260914-eigen-laag`).
10. **Governance.** De engine-wijziging gaat als pull request op
    `jarvis-engine`, met een onafhankelijke QA-ronde. De pin van ToVas Flow en
    Kasboek op de nieuwe engine is een governance-uitzondering (DEC-0043 §2) en
    vraagt een apart akkoord.

## Reikwijdte

Binnen: de opbouw van eigenaarskaarten in de engine (`jarvis/src/overzicht.ts`
en wat daarop leunt), het dossierformaat voor eigenaarspunten, de koppeling van
berichten met `context.item_id` aan open acties, de invarianten en tests, en het
bijwerken van de bestaande dossiers waarvan een punt verkeerd geclassificeerd
blijkt.

Buiten: het uiterlijk van de app buiten de knoppen en hun uitleg; de
reconciliatieregels die al in `T-20260917-voor-jou-reconciliatie` liggen; elke
wijziging aan de autorisatieweg zelf (DEC-0043 blijft ongewijzigd - deze taak
verandert nooit wanneer een akkoord nodig is, alleen hoe het wordt gevraagd).
