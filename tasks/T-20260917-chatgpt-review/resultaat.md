# Resultaat — T-20260917-chatgpt-review

In uitvoering.

## Voortgang

- [x] Onderzoek en ontwerpkeuzes (opdrachtdossier §Ontwerpkeuzes): één engine-opdracht `jarvis review`, het geheim in de Vault via twee databasefuncties, één ronde per pull request als deterministische grendel, eigenaarstaal als wacht in `jarvis db bericht`
- [x] Engine gebouwd: `jarvis/src/review.ts` (vraag, oordeel, eigenaarstaal), `jarvis review` in `opdrachten.ts`, `--technisch` en de wacht in `db bericht`, lintregel `eigenaarslijst_technisch` (waarschuwing), rol `reviewer` in de regie en de app, rolcontract `reviewer.md`, Orchestrator §4.7/§4.8, allowlist van de Edge Function (22 statements), app toont "Technische details" ingeklapt; 753 tests groen
- [x] Kasboek: migratie `20260917000000_review_via_vault.sql` — `jarvis.vraag_review(jsonb)`, `jarvis.lees_review(bigint)`, instelling `review_url`; apart PR-akkoord (migratie)
- [ ] Akkoord van de eigenaar op deze taak in de Jarvis-app
- [ ] Eigenaar: de API-sleutel van de reviewleverancier als Vault-secret `review_api_key` zetten (zie "Wat de eigenaar nog moet doen")
- [ ] Edge Function `jarvis-db` versie 8 uitrollen (na de merge van de engine-PR)
- [ ] Beslissing CFL-0002, daarna de pins van ToVas Flow en Kasboek op de nieuwe engine
- [ ] Routine v8: reviewstap (§4.7) en eigenaarstaal (§4.8) in de cloud-uitvoerder
- [ ] Acceptatietest 1–13 met één gecontroleerde technische taak; verslag hier
- [ ] Kennis: DEC-0046 (tweede model als reviewer; eigenaarstaal), aanvulling RSK-0022 (de sleutel in de Vault), docs/JARVIS.md

## Wat de eigenaar nog moet doen

- Stap 1: zet in de beveiligde sleutelkluis van de database (Supabase →
  Kasboek-project → Integrations → Vault → Add new secret) een geheim met de
  naam `review_api_key` en als waarde de API-sleutel van je ChatGPT-account
  (platform.openai.com → API keys → Create new secret key). Plak de sleutel
  nergens anders, ook niet in de chat; Jarvis leest hem nooit zelf.
- Controle: zodra de sleutel er staat, doet Jarvis de eerste tweede lezing op
  een echte pull request en zie je in de app onder "Team" de rol
  "Second opinion" aan het werk. Mislukt dat, dan meldt Jarvis het zelf in
  gewone taal.
