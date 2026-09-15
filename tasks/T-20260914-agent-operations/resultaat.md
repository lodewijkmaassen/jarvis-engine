# Resultaat — T-20260914-agent-operations

## Voortgang

- [x] Onderzoek: huidige opbouw en de stilstaande taken met bewijs (`analysis.md` §1–2)
- [x] Ontwerp: afgeleid toestandsmodel, activiteit/heartbeat, `jarvis regie` als Task Controller, Team-view (`analysis.md` §3)
- [x] Dossiers rechttrekken: afgeronde stappen afvinken, kasboek-aansluiten sluiten (ToVas Flow #22); dubbele eigen-laag in het overzicht verholpen in de regie (dossierspiegel telt niet als tweede taak)
- [x] Akkoord van de eigenaar op deze taak in de Jarvis-app (2026-09-14 21:45 UTC)
- [x] Engine: tabel `jarvis.activiteit` (Kasboek #7, apart akkoord, migratie toegepast), `jarvis werk`, gebeurtenissen uit `pr openen`, `db toetsing` en `pr mergen` (engine #26)
- [x] Engine: toestandsmodel en `jarvis regie` (zes vragen per open taak, uitvoerbaar werk; engine #26, QA-ronde 2 GO na herstel van de PR-dependency); Edge Function `jarvis-db` v7; ToVas Flow gepind op a89bf30
- [x] App: Team-view onder de Jarvis-knoop, verantwoordelijke rol en toestand op de taakkaart, activiteitsreeks; realtime (engine #27, uitgerold; QA-ronde 1 NO-GO hersteld: geen rolomschrijving als activiteit, `herstel` benoemd, wachtrij ontsmet)
- [x] Routine v7: regie-stap met dispatch, claim en heartbeat (actief sinds 2026-09-14 23:00 UTC; werkt zodra deze pin op main staat)
- [ ] QA per stap; end-to-end proef (stilgevallen taak, verdwijnende dependency, nieuwe taak zonder tussenkomst); acceptatiecriteria 1–16

## Bevindingen onderweg

- 2026-09-14: de keten reageert op de eigenaar en op merges, maar initieert niet; vier uitvoerbare taken lagen dagen zonder eigenaar (bewijs in `analysis.md` §2).
- 2026-09-15: QA-ronde 1 op engine #26 wees af: een stap "wacht op PR #n" bleef eeuwig wachten, ook na de merge. Hersteld: de regie leest de merge-activiteit van `jarvis pr mergen` en de mergecommit in de recente historie; een dependency op een niet-bestaande taak is een afwijking, geen wachttoestand.
- 2026-09-15: de cloud-uitvoerder meldt sinds 05:21 UTC "geen schrijfrecht" op ToVas Flow en Kasboek (token van `tovas-jarvis-bot` met `push: false`, vervalt na 8 uur), terwijl de bot als collaborator met schrijfrecht staat. Gisteren werkte de cloud als `claude[bot]`. Tot dat is opgehelderd draait de dispatch vanaf de laptop; de regie zelf loopt in de cloud wel.

## Wat de eigenaar nog moet doen

Niets. Eén productkeuze kan later volgen: een hogere frequentie van de
cloud-regie als de doorstroom te traag blijkt (kosten).
