# Resultaat — T-20260913-akkoord-geven

In uitvoering.

## Voortgang

- [x] Analyse langs CON-0015 per soort eigenaarshandeling (opdrachtdossier)
- [x] Beslissing van de eigenaar: per taak autoriseren met harde uitzonderingen (DEC-0043)
- [x] Onderzoek: de cloud-identiteit is `tovas-jarvis-bot` zelf (auteur), dus geen bestaande identiteit kan attesteren; advies: de poort attesteert via `GITHUB_TOKEN` (geen nieuw account, geen nieuw credential)
- [x] Ontwerp van het volledige pad (opdrachtdossier)
- [x] Kasboek-migratie: `jarvis.autorisaties` (alleen de eigenaar schrijft, niemand wijzigt of verwijdert — geverifieerd), `jarvis.toetsingen`, leesbeelden `autorisaties_open`/`toetsingen_open` (alleen lezen, zonder eigenaarsgegevens), gebeurtenis bij een nieuw akkoord; toegepast op het project, in kasboek-PR #2
- [x] Engine: `jarvis attestatie`, canonieke workflow `jarvis-attestatie.yml`, `jarvis pr attesteren`, `jarvis db toetsing`/`autorisaties`, `jarvis pr mergen` herbeoordeelt elke attestatie zelf tegen de database, `scope`/`scope_hash` in het overzicht — branch `jarvis/autorisatiepad`, samen met de negen eerdere engine-PR's in één PR
- [x] Interface: "Akkoord met deze taak" (hasht de getoonde scope) en "Akkoord voor PR #n" (bericht met `context.akkoord_pr`), alleen op de eigen database
- [x] QA-ronde 1 (NO-GO: mergen vertrouwde de review-identiteit; paginering; rijbinding) en ronde 2 (GO met PENDING-LIVE) verwerkt; verslag in `qa-ronde-1.md`; restrisico RSK-0023
- [x] Engine-PR #11 geopend (bundel van #2–#10 plus het autorisatiepad); #2–#10 gesloten met verwijzing
- [x] Akkoord van de eigenaar op deze taak in de Jarvis-app — gegeven 2026-09-14 14:20 UTC
- [ ] Attestatie en merge van engine-PR #16 (bundelt #13; wacht ook op het akkoord op T-20260914-eigen-laag)
- [ ] Routineprompt v3: committen als de bot; toetsing → attestatie → samenvoegen → vervolgstap
- [x] Engine #11 en kasboek #1 samengevoegd; ToVas Flow #10 en kasboek #4 (overstap met attestatieworkflow) geopend
- [x] Eerste attestatieproef: engine-PR #12 (sanitizer, gespiegeld dossier); workflow gestart via `jarvis pr attesteren`, stopt correct op de nog niet zichtbare database (406)
- [ ] Handeling 1 en 3 door de eigenaar → overzicht in de eigen database → akkoord op de taak in de lokale app → toetsing GO → attestatie → `jarvis pr mergen` #12
- [x] Bootstrap afgerond: engine #11, kasboek #1 en #4 (met #2), ToVas Flow #10 samengevoegd; attestatieworkflow op main van alle drie; routine v3 live
- [ ] Eerste PR's langs het pad: engine #12 (sanitizer, QA GO), engine #13 (laatste run per checknaam), kasboek #3 (prognosekleur) — wachten op handeling 1 en 3 en het akkoord op hun taak

## Verwerkte antwoorden

- 2026-09-13 (chat) beslissing: per taak met harde uitzonderingen; eerst
  onderzoeken of een bestaande identiteit kan attesteren → DEC-0043,
  onderzoek en ontwerp in het opdrachtdossier. Conclusie van het onderzoek:
  de enige cloud-identiteit is de bot zelf; geen tweede account nodig als
  de poort attesteert (één vinkje per repository door de eigenaar).

- 2026-09-13 (chat) "Laat de Supabase-URL en publishable key in
  jarvis.config.yml staan zoals ontworpen … RLS en de autorisatielaag
  vormen de beveiligingsgrens … Ik ga nu de eenmalige bootstrap-handelingen
  uitvoeren." → vastgelegd in DEC-0043 (gevolgen); Jarvis wacht op de
  bootstrap en voert daarna de merges, re-pins en routine v3 zelf uit.

- 2026-09-13 (interface) "Stap 1 t/m 3 staan … Voer nu zelf de eerste
  attestatie uit en verifieer end-to-end … Stap 4 pas na bevestiging" →
  eerste proef gedraaid op engine-PR #12 (een echte wijziging binnen
  T-20260912-sanitizer-toekenning, met gespiegeld dossier):
  `jarvis pr attesteren 12` startte de workflow op main; de workflow las de
  PR, commits, bestanden en het dossier op de kop, en stopte bij het lezen
  van de database: HTTP 406, schema `jarvis` is nog niet zichtbaar voor de
  API (handeling 1). Niets is op de PR gezet — precies het bedoelde gedrag.
  De rest van de keten wacht op handeling 1 en 3 en op jouw akkoord op de
  taak; de app draait daarvoor lokaal op de laptop (http://localhost:4173),
  omdat de Vercel-login (handeling 5) er nog niet is. ToVas Flow #10 en
  kasboek #4 kunnen niet zelf attesteren: de attestatieworkflow staat daar
  pas op main ná die PR's. Twee reviews blijven dus, en dat zijn de laatste.
  Stap 4 (workflow-recht) blijft staan tot jouw bevestiging.

## Wat de eigenaar nog moet doen

De handelingen staan gebundeld in `T-20260912-altijd-aan` (één batch: de
credentials, de instellingen en de laatste GitHub-ronde). Hier niets apart.
