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
- [ ] Fase 4 — acceptatietest H met alle negen tests
