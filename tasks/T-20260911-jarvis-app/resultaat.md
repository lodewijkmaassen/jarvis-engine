# Resultaat — T-20260911-jarvis-app

In uitvoering.

## Voortgang

- [x] Onderzoek: wat Kasboek technisch is en waarom de artifact-pagina niet als app te installeren is
- [x] Beslissing van de eigenaar over de richting: eigen app, samen met de eigen database (akkoord van 2026-09-12 op de hybride richting in `T-20260912-altijd-aan`)
- [x] Ontwerp: schema `jarvis` in het Kasboek-Supabase-project, inlog met het eigenaarsaccount, RLS, realtime; geen Next.js nodig — dezelfde pagina als statische app op Vercel (`jarvis/interface/app/` in de engine, engine-PR #10)
- [x] Eerste deploy (2026-09-13): https://jarvis-nine-virid.vercel.app — statisch, project `jarvis`, login met het Kasboek-account
- [x] Test van de eigenaar op de telefoon (2026-09-14): geen "App installeren", kaart vrijwel leeg, acties onzichtbaar. Oorzaken gemeten: `index.html` was een fragment zonder doctype en viewport (telefoon rendert op 980 px), het overzicht stond als JSON-string in de database (zie `T-20260914-eigen-laag`), en er was geen manifest of service worker
- [x] De app als primaire interface (engine-PR #17, uitgerold 2026-09-14): volledig document met viewport; manifest, service worker en iconen (installeerbaar als PWA); bij het openen staat de kern open met "Voor jou" — uitsluitend wat werkelijk bij de eigenaar ligt: akkoord op een taak (wat, waarom, wat Jarvis daarna doet, gevolgen, knop), apart PR-akkoord, open beslissingen; risico's die kunnen wachten apart; niets nodig = lege lijst. Overzicht kent `akkoord_nodig` per taak. Getest op telefoonformaat met de proefbron; productie geverifieerd (document, manifest, service worker, iconen)
- [x] Akkoord van de eigenaar op deze taak in de Jarvis-app — gegeven 2026-09-14 13:29 UTC (de eerste akkoord-tik uit de app; de wekker zag hem binnen een minuut, de cloud-run binnen drie seconden)
- [ ] Attestatie en merge van engine-PR #17 (wacht ook op het akkoord op T-20260914-eigen-laag) en #18 (kaart; vervangt #15)
- [ ] Kaart leesbaar (engine-PR #15: ringen naar buiten tot de teksten passen, labels aan de buitenkant) → na merge opnieuw uitrollen
- [ ] Bewijs van de migratie (acceptatiecriteria van de eigenaar, 2026-09-14): installeerbaar op de telefoon; acties zichtbaar; akkoord vanuit de app door Jarvis zelfstandig verwerkt; nieuwe opdracht vanuit de app door de cloud opgepakt zonder laptop; voortgang en resultaat terug in de app

## Verwerkte antwoorden

- 2026-09-11 "Kan je van Jarvis ook een app maken ipv enkel een webpagina?" →
  onderzoek en beslissing voorgelegd.
- 2026-09-12 "hoe komt het dat de antwoorden binnen een minuut komen ipv
  seconden? … nog niet bouwen!" → beantwoord (poll-interval van de
  uitvoerder, niet van de pagina); bouw uitgesteld tot de beslissing.
- 2026-09-12 akkoord op de hybride richting met eigen database (in
  `T-20260912-altijd-aan`) → de beslissing hier is daarmee genomen: eigen
  app op de eigen database; gebouwd als statische pagina met Supabase-login,
  zonder aparte Next.js-app. De handelingen (Vercel-login, schema zichtbaar
  maken) staan in dat dossier, niet dubbel hier.

- 2026-09-13 (interface) "kan je ervoor zorgen dat bij het Jarvis overzicht
  (de mindmap) de tekst altijd goed leesbaar is" → gebouwd: de ring van een
  sector schuift naar buiten tot de teksten van de kinderen erop passen, en
  teksten van taken en takken staan aan de buitenkant van de ring (engine-PR
  #15, QA loopt). Na merge rolt Jarvis de app opnieuw uit.

## Wat de eigenaar nog moet doen

Niets in dit dossier; de resterende handelingen staan in
`T-20260912-altijd-aan`.
