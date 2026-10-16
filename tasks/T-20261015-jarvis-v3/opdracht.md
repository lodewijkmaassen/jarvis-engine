---
id: T-20261015-jarvis-v3
titel: Jarvis V3 — eenvoudige taakketen met mandaat
status: actief
klasse: L
risico: B
project: jarvis
aangevraagd_door: lodewijk
datum: 2026-10-15
gebieden:
  - jarvis
  - engine
  - governance
---

## Wat de opdrachtgever vroeg

2026-10-15, bericht aan de cloud-uitvoerder: V2 structureel vervangen door een
veel eenvoudiger V3. De eigenaar neemt beslissingen; Jarvis voert uit. Eén
bron van waarheid voor taakstatus (een databasetabel), één state machine die
de database afdwingt, één mandaat per opdracht dat alle technische uitvoering
dekt (inclusief productie-uitrol en migraties wanneer het mandaat dat zegt),
`Voor jou` uitsluitend gevuld met echte eigenaarsverzoeken, en voltooiing op
grond van een gemeten eindresultaat.

Besluiten van de eigenaar: governance-paden blijven buiten ieder normaal
mandaat; migraties lopen over een gecontroleerde route zonder dat Jarvis de
verbindingsreeks ziet; de dispatcher start de routine via de API met een
GitHub-secret als token.

## Voortgang

- [x] Fase 1 — databasefundament (`jarvis/migrations/v3`), getest op PostgreSQL
- [x] Fase 2 — uitvoerderslaag: `jarvis v3`-CLI, mandaatbeoordeling, dispatcher, migratieroute, workflow `jarvis-v3`
- [x] Fase 3 — interface /v3/ op de V3-views (productiemeting in de ToVas-app volgt bij de acceptatietest)
- [x] Reparatieronde na onafhankelijke QA: B1 (eigenaarsidentiteit faalt gesloten, eigenaarsviews gefilterd), B2 (oud pad bij hernoemen getoetst), B3 (noodstop `enabled: false` geldt voor V3), B4 (poortcode, pin en npm-config voor elk mandaat gesloten; `extra_paden` toegepast), B5 (migratiecontrole als scanner met whitelist), B6 (UITROL en KLAAR alleen via de CI-identiteit `jarvis_ci`)
- [x] Tweede reparatieronde (QA ronde 2): BLK-1 (de migratiescanner is een lexer die SQL leest zoals PostgreSQL en gesloten faalt, beoordeelt ook functiebodies, plus afgedwongen least-privilege-rol voor `migreer`; regressietests tegen echte PostgreSQL voor elke gevonden omzeiling), BLK-2 (tsconfig), BLK-3 (rechten voor anon/authenticated/service_role ingetrokken; volledige EXECUTE-matrix getest), R-1 (een PR wordt per taak één keer vastgelegd), R-2 (alleen samenvoegen in main), R-3 (bouwmerk mag een nazaat zijn)
- [ ] Fase 4 — acceptatietest H met alle negen tests
