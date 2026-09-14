# CURRENT_STATE — jarvis-engine

<!-- jarvis:feiten:start -->

<!-- Dit blok wordt gegenereerd door `jarvis state`. Handmatige wijzigingen
     worden door CI gedetecteerd en overschreven. Schrijf je toelichting
     onder het blok, niet erin. -->

_Gegenereerd op 2026-09-14._

| Feit | Waarde |
|---|---|
| Hoofdbranch | `main` op `4908ec5` (2026-09-13) |
| Hoogste migratie | onbekend |
| Testbestanden | 27 |
| Kennisrecords | DEC 0 · CON 0 · LRN 0 · RSK 0 · CFL 0 |
| Open conflicten | geen |

**Open taken:** geen.

<!-- jarvis:feiten:eind -->

## Waar staan we

De engine is afgesplitst uit het project waarin hij is gebouwd en is de bron
voor drie consumers (ToVas Flow, Kasboek en de engine zelf), die hem als
git-afhankelijkheid op een vastgepinde commit opnemen en `npx jarvis <opdracht>`
aanroepen. De poort kent twee standen: hier de canonieke workflows in
`jarvis/canonical/`, bij een consumer komen ze mee met de geïnstalleerde engine.

Sinds 13 september draagt de engine het autorisatiepad (DEC-0043): akkoord van
de eigenaar per taak in de eigen Jarvis-app, toetsing per commit, attestatie
door de poort (`jarvis attestatie`, `jarvis pr attesteren`) en samenvoegen
uitsluitend via `jarvis pr mergen`, dat alles zelf opnieuw verifieert. De eigen
database van Jarvis (`jarvis db`) is de enige gegevensbron (DEC-0044): op de
laptop rechtstreeks, in de cloud via de Edge Function `jarvis-db` en de
API-credential van het platform (`jarvis/edge/jarvis-db/`).

De interface (`jarvis/interface/jarvis.html`) wordt als eigen app uitgerold
(`jarvis/interface/app/`): een volledig document, installeerbaar als PWA, met
bij het openen de acties die werkelijk bij de eigenaar liggen.

## Volgende stap

ToVas Flow en Kasboek opnieuw op deze engine pinnen zodra de open pull
requests zijn samengevoegd, en de eerste volledige keten meten: akkoord in de
app → cloud-uitvoerder → attestatie → merge, zonder laptop.
