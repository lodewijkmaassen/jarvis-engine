---
id: T-20260914-eigen-laag
titel: De eigen Jarvis-laag (app en database) leidend; de artifact-database en sessiegebonden bestanden geen afhankelijkheid meer
status: actief
klasse: M
risico: B
project: jarvis
aangevraagd_door: lodewijk
datum: 2026-09-14
gebieden:
  - jarvis
  - interface
  - governance
---

## Wat de opdrachtgever vroeg

2026-09-14 (chat), na een toestemmingsprompt voor het bijwerken van de
artifact-database: "Maak de eigen Jarvis-app en eigen Jarvis-database de
primaire en leidende omgeving voor taken, dossiers, gesprekken, statussen,
autorisaties, acties en voortgang." Acht uitgangspunten, samengevat:

1. De Claude artifact-database is geen noodzakelijke afhankelijkheid meer.
2. Claude Code (cloud en laptop) zijn uitvoerders die via de eigen laag werken.
3. Een uitvoerder die stopt of herstart legt Jarvis niet stil; een andere
   neemt over.
4. Verificaties, dossier- en statusupdates en administratie gebeuren
   zelfstandig, zonder gebruikersgoedkeuring.
5. Alleen wat door externe rechten, security of een echte inhoudelijke of
   governancebeslissing uitsluitend van de eigenaar is, komt als actie bij
   hem.
6. Geen architectuur waarbij "Allow once", bestandstoegang of andere
   sessiegebonden toestemmingen nodig zijn voor normale werking.
7. De Jarvis-app is de plek voor acties, beslissingen, voortgang en gesprek.
8. Claude.ai/Claude Code is geen noodzakelijke gebruikersinterface meer.

Onderzoek eerst de afhankelijkheden, maak een migratieplan, voer uit wat
zelfstandig kan, en leg alleen voor wat uitsluitend de eigenaar kan — één
actie tegelijk.

## Afhankelijkheden op 2026-09-14 (onderzoek)

**Artifact-database (claude.ai)**

| # | Wie | Wat | Waarom het stokt |
|---|---|---|---|
| A1 | De claude.ai-pagina (`bronArtifact`) | leest overzicht/status/berichten/antwoorden, schrijft antwoorden en berichten, publiceert `signaal.json` om de laptop te wekken | leeft alleen op claude.ai; schrijven vanuit een uitvoerder vraagt een goedkeuring |
| A2 | De laptopsessie | `read_db`/`write_db` voor nieuwe items, antwoorden, overzicht en status | `write_db` met een bestand buiten de sessiemappen vraagt "Allow once"; een herstart verandert die mappen |
| A3 | De cloud-routine | terugval op de artifact-database zonder eigen database | `write_db` blijft in de cloud hangen op een goedkeuring die niemand geeft |
| A4 | De wek-keten van de laptop (DEC-0033) | artifact-wijziging → notificatie → sessie | alleen zolang de artifact-pagina wordt gebruikt |
| A5 | Kennis en documentatie | DEC-0030/0033/0035, docs/JARVIS.md §7, geheugen | beschrijven de artifact-database als bron |

**Sessiegebonden bestanden en toestemmingen**

| # | Wat | Waarom het stokt |
|---|---|---|
| B1 | Werken in de sessie-scratchpad (checkouts, overzicht.json) | verdwijnt bij een herstart; 17 commits stonden ongepusht; bestanden erbuiten vragen toestemming |
| B2 | Toestemmingsregels ontbreken in de werkmappen | standaardopdrachten (`npx jarvis …`, `git …`) vragen bij een nieuwe sessie opnieuw |
| B3 | De desktop-ochtendroutine (laptop) | duplicaat van het cloud-vangnet, alleen als de laptop aan staat |
| B4 | Uitrol van de app (`npx vercel`) | alleen vanaf de laptop; zeldzaam, geen operationele afhankelijkheid |

**Wat de eigen laag al heeft**: schema `jarvis` met antwoorden, berichten,
documenten (overzicht, status), gebeurtenissen, autorisaties, toetsingen;
de brug naar GitHub; de app op Vercel (login met het eigenaarsaccount, RLS,
realtime); `jarvis db` op de laptop; de Edge Function voor de cloud
(wacht op handeling 3).

## Migratieplan

1. **Eén bron.** Alle lees- en schrijfacties van uitvoerders lopen via
   `npx jarvis db` op de eigen database. De artifact-database wordt niet
   meer beschreven; de claude.ai-pagina wordt een verwijsbord naar de app.
2. **Wekken zonder claude.ai.** `jarvis db wachten`: een uitvoerder wacht
   op de eerstvolgende nieuwe rij (antwoord, bericht, akkoord) en gaat dan
   aan het werk; de laptopsessie draait die wachter op de achtergrond, de
   cloud start op de brug (push) en het vangnetrooster.
3. **Overneembaar werk.** Uitvoerders werken in vaste mappen
   (`~/jarvis/<repo>`), pushen elke branch direct, en claimen items vóór
   verwerking; wie er ook draait, ziet dezelfde stand.
4. **Geen toestemmingsprompts.** Toestemmingsregels voor de standaard-
   opdrachten in de vaste werkmappen (machine-lokaal, niet in de repo);
   bestanden alleen binnen werkmap of eigen mappen; geen tool die om
   goedkeuring vraagt in een routine.
5. **Administratieve PR's zonder akkoord.** Een pull request die alleen
   dossiers, kennisrecords (niet CONSTRAINTS), index en feitenblok raakt,
   attesteert de poort op grond van de poort zelf (DEC-0044): dat is
   administratie, geen inhoud waarvoor de eigenaar tekent.
6. **Kennis bijgewerkt.** DEC-0044 legt dit vast; DEC-0030/0033/0035 krijgen
   de status vervangen; docs/JARVIS.md en de routineprompt volgen.
7. **Wat overblijft voor de eigenaar**: de cloud aan de database koppelen
   (function-secrets en API credential) — credentials, uitsluitend de
   eigenaar. Eén actie, aan het eind.
