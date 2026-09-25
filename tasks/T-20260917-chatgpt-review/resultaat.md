# Resultaat — T-20260917-chatgpt-review

In uitvoering.

## Voortgang

- [x] Onderzoek en ontwerpkeuzes (opdrachtdossier §Ontwerpkeuzes): één engine-opdracht `jarvis review`, het geheim in de Vault via twee databasefuncties, één ronde per pull request als deterministische grendel, eigenaarstaal als wacht in `jarvis db bericht`
- [x] Engine gebouwd: `jarvis/src/review.ts` (vraag, oordeel, eigenaarstaal), `jarvis review` in `opdrachten.ts`, `--technisch` en de wacht in `db bericht`, lintregel `eigenaarslijst_technisch` (waarschuwing), rol `reviewer` in de regie en de app, rolcontract `reviewer.md`, Orchestrator §4.7/§4.8, allowlist van de Edge Function (22 statements), app toont "Technische details" ingeklapt; 753 tests groen
- [x] Kasboek: migratie `20260917000000_review_via_vault.sql` — `jarvis.vraag_review(jsonb)`, `jarvis.lees_review(bigint)`, instelling `review_url`; apart PR-akkoord (migratie)
- [ ] Akkoord van de eigenaar op deze taak in de Jarvis-app
- [x] Eigenaar: de API-sleutel van de reviewleverancier als Vault-secret `review_api_key` zetten — gedaan op 2026-09-17, gemeten op de namenlijst van de kluis op 2026-09-25
- [x] De migratie `20260917000000_review_via_vault.sql` werkelijk toegepast (2026-09-25). Zij was op 2026-09-17 samengevoegd en geautoriseerd, maar nooit uitgevoerd: `jarvis.vraag_review`, `jarvis.lees_review` en de instelling `review_url` ontbraken alle drie, waardoor `jarvis review` op `HTTP 400 — statement niet toegestaan` strandde. Alle drie nu aanwezig en geverifieerd
- [ ] Edge Function `jarvis-db` versie 8 uitrollen (na de merge van de engine-PR)
- [ ] Beslissing CFL-0002, daarna de pins van ToVas Flow en Kasboek op de nieuwe engine
- [ ] Routine v8: reviewstap (§4.7) en eigenaarstaal (§4.8) in de cloud-uitvoerder
- [ ] Acceptatietest 1–13 met één gecontroleerde technische taak; verslag hier
- [ ] Kennis: DEC-0046 (tweede model als reviewer; eigenaarstaal), aanvulling RSK-0022 (de sleutel in de Vault), docs/JARVIS.md

## Wat de eigenaar nog moet doen

Niets meer in dit dossier. Het geheim `review_api_key` staat sinds 2026-09-17 in
de sleutelkluis — gemeten op de namenlijst van de kluis op 2026-09-25, nooit op
de waarde — en het akkoord op deze taak plus het aparte akkoord voor de
migratie staan van diezelfde dag in de autorisaties.

Deze lijst stond hier tot 2026-09-25 open terwijl de handeling al gedaan was:
de kopie van dit dossier in het consumerproject was wél bijgewerkt, deze niet.
Dat is precies de drift die een punt op de telefoon van de eigenaar laat staan
nadat hij het heeft afgehandeld (CON-0016).
