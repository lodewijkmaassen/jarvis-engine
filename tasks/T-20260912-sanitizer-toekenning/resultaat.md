# Resultaat — T-20260912-sanitizer-toekenning (spiegel in de engine)

Het dossier van deze taak leeft in ToVas Flow; `opdracht.md` hier is een
byte-identieke kopie zodat de attestatie (DEC-0043) de scope op de kop van
een engine-PR kan hashen.

## Voortgang

- [x] Punt 4, deel: het entropiepatroon leest een identifier van mensen
  (segmenten van alleen cijfers of alleen letters, gescheiden door `_` of
  `-`) niet meer als sleutel — migratienamen, taak-ids
- [x] Punt 1 en 2: `credential_toekenning` en `postadres_nl` gebouwd
- [x] Punt 3, deel: probeset (49 proeven) en de scan van de engine zelf
- [ ] Punt 3, rest: de scans van ToVas Flow en Kasboek schoon krijgen
- [ ] Punt 5: RSK-0019 naar `beheerst`

## Stand van 2026-09-15 (cloud, developer)

Beide patronen staan in `jarvis/src/sanitize.ts`, met een probeset van
negenveertig proeven in `tests/jarvis/sanitize-toekenning.test.ts`. De hele
suite (713 proeven) is groen, `npm run typecheck` is schoon en `node
bin/jarvis.mjs poort` op de engine zelf geeft exitcode 0 — negenendertig
bestanden gescand, niets gevonden.

Twee vormkeuzes die de eerdere, teruggedraaide poging niet had:

1. **De treffer is alleen de waarde, niet de sleutel** (lookbehind). Daardoor
   is hij vervangbaar: `SMTP_PASS=[[GEREDIGEERD:credential_toekenning:1]]`
   blijft een leesbare regel.
2. **`credential_toekenning` sluit de rij**, achter `hoge_entropie` en
   `base64_geheim`. Ervóór zou het de treffer kapen van elk secret dat nu al
   gevonden wordt en alleen de categorie veranderen. Het patroon bestaat voor
   precies één groep: waarden die te kort of te gewoon van vorm zijn.

### Wat nog niet af is

De acceptatie eist dat alle drie de repositoryscans schoon blijven. De engine
is schoon; ToVas Flow geeft nog zes bevindingen en Kasboek één. Alle zeven zijn
vals-positief en vallen in drie groepen — geen ervan is een werkend credential:

- **`Bearer` met een plaatshouder erachter** (`docs/DIAG.md:40, 312`,
  `docs/SECRETS.md:27`, `tasks/T-20260911-kasboek-aansluiten/qa-ronde-1.md:51`).
  Het schema-voorvoegsel wordt gestript, maar wat erachter staat is een
  plaatshouder in een vorm die `PLAATSHOUDERS` nog niet kent.
- **Een plaatshouderwoord als waarde** (`.github/workflows/ci.yml:36` in ToVas
  Flow, `:33` in Kasboek). Woorden als "placeholder" en "dummy" horen in
  `PLAATSHOUDERS`.
- **Een codespan die geen kale identifier is**
  (`tasks/T-20260911-kasboek-aansluiten/qa-ronde-1.md:37`). De uitzondering
  voor `` `GITHUB_TOKEN` `` is te smal.

Volgende stap: `PLAATSHOUDERS` uitbreiden met die vormen, de drie scans
herhalen, en pas dan RSK-0019 op `beheerst`. Dit is bewust niet gehaast: een
te ruime uitzondering hier is precies hoe de vorige poging sneuvelde.
