# CURRENT_STATE — jarvis-engine

<!-- jarvis:feiten:start -->

<!-- Dit blok wordt gegenereerd door `jarvis state`. Handmatige wijzigingen
     worden door CI gedetecteerd en overschreven. Schrijf je toelichting
     onder het blok, niet erin. -->

_Gegenereerd op 2026-09-15._

| Feit | Waarde |
|---|---|
| Hoofdbranch | `main` |
| Hoogste migratie | onbekend |
| Testbestanden | 29 |
| Kennisrecords | DEC 0 · CON 0 · LRN 0 · RSK 0 · CFL 0 |
| Open conflicten | geen |

**Open taken:** geen.

<!-- jarvis:feiten:eind -->

## Waar staan we

De engine is afgesplitst uit het project waarin hij is gebouwd, met de
commitgeschiedenis van `jarvis/`. Deze repository is de bron; consumers nemen
hem op als git-afhankelijkheid op een vastgepinde commit en roepen
`npx jarvis <opdracht>` aan. De poort kent twee standen: in deze repository
staat de canonieke workflow in `jarvis/canonical/`, bij een consumer komt hij
mee met de geïnstalleerde engine; de stap `engine` controleert bij een consumer
dat de gepinde, geïnstalleerde engine-SHA op `main` van deze repository staat.

De rolcontracten in `jarvis/roles/` zijn de bron; `jarvis rollen` genereert de
afgeleiden en de poort ziet drift. Er zijn er twee: de agentdefinities plus het
instapdocument van één werkomgeving (`rol_afgeleiden_map`, `rol_overzicht`), en
sinds 2026-09-15 een leveranciersneutraal manifest (`rol_manifest`) — alle
contracten in één machineleesbaar bestand, zonder gereedschapsnamen, zodat een
ander gereedschap de rollen kan overnemen zonder de contracten met de hand te
vertalen. Beide zijn optioneel: een lege configuratiewaarde laat het gedrag
ongewijzigd.

## Volgende stap

De eerste consumer overstappen op de afhankelijkheid.

Voor het manifest: een consumer zet `rol_manifest` aan en toont daarmee aan dat
een rol van leverancier kan wisselen zonder kennisverlies (AC-6, tot nu toe
PENDING-LIVE).
