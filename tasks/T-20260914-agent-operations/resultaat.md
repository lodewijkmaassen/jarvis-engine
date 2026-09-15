# Resultaat — T-20260914-agent-operations

## Voortgang

- [x] Onderzoek: huidige opbouw en de stilstaande taken met bewijs (`analysis.md` §1–2)
- [x] Ontwerp: afgeleid toestandsmodel, activiteit/heartbeat, `jarvis regie` als Task Controller, Team-view (`analysis.md` §3)
- [x] Dossiers rechttrekken: afgeronde stappen afvinken, kasboek-aansluiten sluiten (ToVas Flow #22); dubbele eigen-laag in het overzicht volgt in de engine
- [ ] Akkoord van de eigenaar op deze taak in de Jarvis-app → attestatie en merge van de engine-, Kasboek- en app-PR's van deze taak
- [ ] Engine: tabel `jarvis.activiteit` (migratie Kasboek, apart akkoord), `jarvis werk`, gebeurtenissen uit bestaande opdrachten
- [ ] Engine: toestandsmodel in het overzicht en `jarvis regie` (zes vragen per open taak, uitvoerbaar werk)
- [ ] App: Team-view onder de Jarvis-knoop, verantwoordelijke rol en toestand op de taakkaart, activiteitsreeks; realtime
- [ ] Routine v7: regie-stap met dispatch, claim en heartbeat
- [ ] QA per stap; end-to-end proef (stilgevallen taak, verdwijnende dependency, nieuwe taak zonder tussenkomst); acceptatiecriteria 1–16

## Bevindingen onderweg

- 2026-09-14: de keten reageert op de eigenaar en op merges, maar initieert niet; vier uitvoerbare taken lagen dagen zonder eigenaar (bewijs in `analysis.md` §2).

## Wat de eigenaar nog moet doen

Niets. Eén productkeuze kan later volgen: een hogere frequentie van de
cloud-regie als de doorstroom te traag blijkt (kosten).
