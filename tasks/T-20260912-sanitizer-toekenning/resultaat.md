# Resultaat — T-20260912-sanitizer-toekenning (spiegel in de engine)

Het dossier van deze taak leeft in ToVas Flow; `opdracht.md` hier is een
byte-identieke kopie zodat de attestatie (DEC-0043) de scope op de kop van
een engine-PR kan hashen.

## Voortgang

- [x] Punt 4, deel: het entropiepatroon leest een identifier van mensen
  (segmenten van alleen cijfers of alleen letters, gescheiden door `_` of
  `-`) niet meer als sleutel — migratienamen, taak-ids
- [x] Punt 3, eerste helft: probeset voor het toekenningspatroon
  (`tests/jarvis/sanitize-toekenning.test.ts`) en de meting tegen de drie
  repositories — zie "Meting" hieronder
- [x] Punt 1: toekenningspatroon invoeren — ronde 2, `toekenning_secret` met
  `isEchteToekenning`: de drie repositoryscans zijn schoon en de probeset
  blijft groen; zie "Ronde 2" hieronder
- [x] Punt 2: postadrespatroon `postadres_nl` (straat én huisnummer én
  postcode), met probeset
- [x] Punt 4: de uitzondering voor Jarvis-ids geldt nu ook in het
  entropiepatroon (`isJarvisId` losgetrokken uit `isVerdachtBase64`)
- [ ] Punt 5: RSK-0019 naar `beheerst` — kan pas na een release van de engine
  en het opnieuw pinnen in ToVas Flow en Kasboek

## Meting (2026-09-15, cloud-uitvoerder)

Er staat nu een werkend toekenningspatroon `credential_toekenning` in
`jarvis/src/sanitize.ts`: een lookbehind op de naam (`WACHTWOORD=`,
`PASSWORD:`, `secret = "…"`, `SESSION_SECRET=`, `Authorization: Bearer …`),
waarbij de treffer alleen de WAARDE is, en een afwijzende waardecontrole
(`isCredentialWaarde`) die plaatshouders, verwijzingen, getallen, paden,
bestandsnamen, datums en Jarvis-ids stil houdt.

Onderweg viel één echte bug op die losstaat van dit patroon: `zoekTreffers`
bouwde zijn zoeker met `new RegExp(def.patroon.source, "g")` en liet daarmee
de vlaggen van de definitie vallen. Elk hoofdletterongevoelig patroon zou
daardoor stilzwijgend hoofdlettergevoelig zijn geworden. Gerepareerd.

**Probeset: groen.** Acht treffers (alle korter dan de base64-drempel van
tweeentwintig tekens, dus vandaag onzichtbaar) allemaal gevonden; negentien
niet-treffers allemaal stil, los en in één document.

**Repositoryscan: rood.** Tegen het bereik van `sanitize_paden` van de drie
repositories geeft het patroon **29 bevindingen**, en geen ervan is een
secret. Drie klassen:

1. **Broncode waarin de waarde een expressie is** — `const sleutel =
   normaliseer(waarde);`, `const token = stdout.trim();`, `sleutel:
   z.string().trim().default("")`. De engine scant `jarvis/` en `bin/` mee,
   dus dit is geen randgeval maar de grootste klasse.
2. **Namen als waarde** — `{ "key": "X-Frame-Options" }` in `vercel.json`.
3. **Proza en oude QA-verslagen** — "geen nieuw token: `GITHUB_TOKEN` bestaat
   alleen", en de ingekorte voorbeelden in `qa-rapport-ronde2.md`
   (`AWS_SECRET_ACCESS_KEY=wJalrXUt[ingekort]`).

Het acceptatiecriterium is "de drie repositoryscans blijven schoon". Dat
haalt dit patroon niet, dus het wordt **niet ingevoerd** zoals het er nu
staat — dezelfde fout als de eerdere, teruggedraaide poging zou zijn om het
toch te doen en de ruis later te dempen.

Wat de meting laat zien: de plek alleen is niet genoeg. Het patroon moet code
van proza kunnen onderscheiden, want in broncode is een toekenning aan een
credentialnaam de normaalvorm en staat er een verwijzing rechts, geen geheim.
Dat is de volgende stap, met de probeset hierboven als vangnet: de niet-
treffers uit de drie klassen erbij, en pas invoeren als de scan schoon is.

**Stand van de branch `jarvis/sanitizer-toekenning`: bewust rood.** Het
patroon staat er actief in, dus `jarvis poort` meldt daar de 29 bevindingen
hierboven. Dat is de meting zelf en geen defect om weg te werken; er gaat om
precies die reden **geen PR** open. Het alternatief — het patroon uit de
poort houden — zou de probeset zijn vangnet ontnemen, en de probeset is wat
de volgende ronde nodig heeft. Wie deze branch oppakt: eerst de scan schoon
krijgen, dan pas een PR.

## Ronde 2 (cloud, 2026-09-15) — scan schoon, patroon ingevoerd

De vorige ronde noemde de opgave precies: het patroon moet code van proza
kunnen onderscheiden. Dat is nu de kern van de controle, en daarmee is de
meting omgeslagen.

**Wat er anders is.** Het patroon heet `toekenning_secret`, staat als laatste
in `PATROON_DEFS` (zodat een leverancierspatroon dezelfde waarde eerst
claimt) en beslaat de hele toekenning in plaats van alleen de waarde.
`isEchteToekenning` weegt vijf dingen die de drie klassen uit ronde 1 stuk
voor stuk afvangen:

1. **De naam moet een credentialnaam zijn, per segment.** camelCase telt als
   scheidingsteken, dus `apiKey` telt mee en `bypass` niet — een deelstring-
   test sloeg daar wél op aan.
2. **De naam moet zijn clausule openen.** `opentClausule` kijkt naar alles na
   de laatste clausule-opener; staat daar nog een gewoon woord, dan is het
   lopende tekst. Dat haalt klasse 3 weg ("geen nieuw token: `GITHUB_TOKEN`")
   zonder `export const apiKey = "…"` te missen: declaratiewoorden zijn
   expliciet toegestaan. Bewust op de hele voorkant en niet op het laatste
   teken — een zin eindigt óók op een spatie, en juist die vorm gaf een
   vals-positief in het gegenereerde JSON-overzicht, waar markdown tot één
   regel is samengevoegd.
3. **De waarde mag geen verwijzing zijn** — `process.env.X`, `${{ secrets.Y }}`,
   een puntpad, iets met haakjes erin. Dat is klasse 1, de grootste.
4. **De waarde mag geen configuratiewoord zijn** — louter letterwoorden,
   eventueel met streepjes: `X-Frame-Options`, `no-referrer`, `nosniff`. Dat
   is klasse 2.
5. **De waarde mag geen afgekapte documentatiewaarde, plaatshouder,
   credentialnaam of Jarvis-id zijn**, en telt minstens zes tekens.

**Meting, beide kanten van de acceptatie-eis.**

| Wat | Uitkomst |
|---|---|
| Probeset `tests/jarvis/sanitize-toekenning.test.ts` | 58 groen |
| Scan engine | 39 bestanden, 0 bevindingen |
| Scan ToVas Flow | 167 bestanden, 0 bevindingen |
| Scan Kasboek | 22 bestanden, 0 bevindingen |
| Volledige suite | 721 groen |
| `tsc --noEmit` | schoon |
| `jarvis poort` | exitcode 0 |

De eerste versie van deze ronde gaf zelf nog zeven bevindingen — dezelfde
drie klassen. Die staan nu als regressietests in de probeset, zodat het
patroon niet stilletjes kan terugvallen.

**Geaccepteerde vals-negatief, expliciet.** Een wachtwoord dat uitsluitend uit
letters bestaat glipt langs dit patroon (regel 4). Dat is een keuze, geen
omissie: de acceptatie-eis is tweezijdig en de stille kant weegt zwaarder —
een poort die op elke `"key": "Cache-Control"` afgaat wordt genegeerd en
bewaakt dan niets meer.

**Ook in deze ronde.** Het postadrespatroon (`postadres_nl`, punt 2 van de
opdracht: straat én huisnummer én postcode, anders niet) en de gedeelde
uitzondering voor Jarvis-ids (punt 4): `isJarvisId` is losgetrokken uit
`isVerdachtBase64` en geldt nu ook in `isVerdachteEntropie`, waar
`isIdentifierVorm` een id met een cijfer-lettersegment (`RSK-0019-2fa-token`)
liet vallen. De vlaggenreparatie in `zoekTreffers` uit ronde 1 is behouden.

**Wat nog open staat.** Punt 5 van de opdracht — RSK-0019 naar `beheerst` —
kan pas na een release van de engine en het opnieuw pinnen in ToVas Flow en
Kasboek: tot dan draaien die projecten de oude sanitizer en is het risico
daar niet beheerst.
