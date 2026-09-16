---
id: T-20260917-chatgpt-review
titel: Een tweede model als onafhankelijke reviewer in de keten, en eigenaarstaal in de app
status: actief
klasse: L
risico: C
project: jarvis
aangevraagd_door: lodewijk
datum: 2026-09-17
gebieden:
  - jarvis
  - engine
  - database
  - interface
  - governance
---

## Wat de opdrachtgever vroeg

2026-09-16 (chat), letterlijk in de kern: "Voeg twee kleine capabilities toe
aan de bestaande Jarvis-keten: 1. ChatGPT als onafhankelijke analyse-/reviewrol
naast Claude. 2. Duidelijke, korte, niet-technische Nederlandse communicatie
richting de eigenaar." Een uitvoeropdracht, geen bouwplan ter review.

Gewenste werking: regie haalt relevante kennis op → Claude onderzoekt/bouwt →
het tweede model ontvangt het resultaat plus alleen de relevante context →
review → indien nodig hoogstens één gerichte terugkoppeling naar Claude →
Jarvis vervolgt zelfstandig → de eigenaar ziet een korte begrijpelijke
conclusie of alleen een echte beslissing. De eigenaar kopieert niets meer
tussen systemen.

Bouwgrenzen: klein houden; hergebruik regie, taakstructuur, kennisvoorziening,
poort, cloud-uitvoerder, database en interface. Geen nieuw
multi-agentframework, geen nieuwe Task Controller, geen nieuwe agent-UI, geen
nieuwe Knowledge Agent, geen onbeperkte agentdiscussies, geen wijziging aan
brug v5, geen send_later-, claim- of dedup-werk. Niet onnodig afhankelijk van
één leverancier. Secrets uitsluitend via de bestaande Vault-werkwijze; is een
handeling van de eigenaar nodig, bouw dan eerst alles wat zonder kan en zet
daarna één duidelijke kaart onder "Voor jou".

Acceptatietest: één gecontroleerde technische taak waarin (1) de eigenaar
alleen de taak in Jarvis invoert, (2) Claude hem zelfstandig oppakt, (3)
bestaande kennis automatisch meegaat, (4) het resultaat automatisch naar het
tweede model gaat, (5) de review automatisch terugkomt in Jarvis, (6)
hoogstens één correctieronde, (7) niets handmatig gekopieerd, (8) Jarvis
zelfstandig verdergaat, (9) alleen een echte beslissing onder "Voor jou", (10)
een korte Nederlandse eindconclusie, (11) technische bron bewaard voor audit,
(12) geen dubbele taak of uitvoerder, (13) cloud-only met de laptop uit.

## Classificatie

- **Omvang L** — vier gebieden (engine, database, interface, governance) en
  een nieuw extern koppelvlak (de API van een tweede modelleverancier).
- **Risico C** — raakt geheimen (een API-sleutel in de Vault), een migratie
  en een betaalde dienst (CON-0011: nut, noodzaak en kosten zijn door de
  eigenaar zelf in de opdracht benoemd; de kosten per review zijn klein en
  begrensd door één ronde per pull request).
- **Bevoegdheid**: de migratie en de sleutel zijn harde uitzonderingen
  (DEC-0043 §2): apart PR-akkoord; de sleutel zet alleen de eigenaar.

## Ontwerpkeuzes (door Jarvis, binnen mandaat)

1. **Waar de review leeft**: één engine-opdracht `jarvis review <nummer>
   --repo <slug>`. De engine verzamelt de PR (titel, tekst, diff), het
   taakdossier (opdracht, acceptatiecriteria) en het contextpakket van de
   kennislaag (klasse S, gestuurd door titel en opdracht — de bestaande
   kennisvoorziening, geen nieuwe Knowledge Agent), stelt de vraag, legt het
   oordeel vast als document `review/<repo>#<nummer>` en als activiteit van
   de rol `reviewer`. Exit 0 akkoord, 4 correctie, 3 al beoordeeld.
2. **Eén ronde, deterministisch**: het reviewdocument is de grendel — een
   tweede aanroep op dezelfde pull request weigert. Een correctie herstelt
   alleen punten met ernst `hoog` in één commit; daarna QA, geen tweede
   review. Zo kan er geen lus tussen twee modellen ontstaan.
3. **Geheim in de Vault, niet in de engine**: `jarvis.vraag_review(jsonb)`
   (security definer) zet de sleutel uit Vault-secret `review_api_key` bij
   het verzoek en verstuurt het met pg_net naar de url in de instelling
   `review_url`; `jarvis.lees_review(bigint)` geeft het antwoord terug. Beide
   via de Edge Function `jarvis-db` (toegestane statements), dus laptop en
   cloud gaan dezelfde weg — dezelfde lijn als brug v5 (RSK-0022).
4. **Leveranciersneutraal**: de engine spreekt het gangbare
   chat-completions-formaat en kent geen leveranciersnaam (de
   portability-test van de engine dwingt dat af); de url is een instelling,
   het model een vlag (`--model`, standaard `gpt-5.1`). Overstappen is een
   andere url, een andere sleutel en een andere modelnaam — geen code.
5. **Eigenaarstaal als wacht, niet als advies**: `jarvis db bericht`
   weigert een tekst met technische namen (commit-sha's, PR-nummers,
   bestandsnamen, opdrachtregels, poorttermen) of langer dan 1200 tekens; de
   technische bron gaat mee in `--technisch` (context.technisch) en de app
   toont hem ingeklapt onder "Technische details". `jarvis lint` waarschuwt
   bij technische taal in "Wat de eigenaar nog moet doen".
6. **Rollen**: rolcontract `reviewer` (engine, geen platformagent) en de
   Orchestrator krijgt §4.7 (tweede lezing) en §4.8 (eigenaarstaal); de
   cloud-routine volgt dezelfde stappen.

## Werkverdeling en voortgang

| Stap | Rol | Status | Bewijs |
|---|---|---|---|
| Onderzoek: bestaande keten, Edge Function, Vault-lijn, kennisvoorziening | architect | klaar | dit dossier, §Ontwerpkeuzes |
| Engine: `jarvis review`, `review.ts`, eigenaarstaalwacht in `db bericht`, lintregel, rol `reviewer`, contracten, app | developer | klaar | jarvis-engine PR (zie resultaat.md) |
| Kasboek: migratie `vraag_review`/`lees_review` + instelling `review_url`; Edge Function v8 | developer | klaar | kasboek PR (apart akkoord: migratie) |
| Tweede lezing op de engine-PR (Reviewer) | reviewer | wacht op sleutel | eerste live review is de acceptatietest |
| QA per PR, attestatie, merge via de poort | qa / orchestrator | open | |
| Pins: ToVas Flow en Kasboek op de nieuwe engine | developer | wacht op CFL-0002 | |
| Routine v8: reviewstap en eigenaarstaal in de cloud-uitvoerder | orchestrator | open | |
| Acceptatietest 1–13 met één gecontroleerde taak | qa | open | |
| Kennis: DEC-0046, RSK-0022-aanvulling, docs/JARVIS.md | knowledge-manager | open | |
