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
- [ ] Punt 1: toekenningspatroon invoeren — **nog niet**, de meting is rood
- [ ] Punt 2, 5: postadressen, RSK-0019 naar `beheerst`

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
