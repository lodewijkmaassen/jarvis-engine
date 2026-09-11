# CURRENT_STATE — jarvis-engine

<!-- jarvis:feiten:start -->

<!-- Dit blok wordt gegenereerd door `jarvis state`. Handmatige wijzigingen
     worden door CI gedetecteerd en overschreven. Schrijf je toelichting
     onder het blok, niet erin. -->

_Gegenereerd op 2026-09-11._

| Feit | Waarde |
|---|---|
| Hoofdbranch | `main` op `onbekend` (onbekend) |
| Hoogste migratie | onbekend |
| Testbestanden | 21 |
| Kennisrecords | DEC 0 · CON 0 · LRN 0 · RSK 0 · CFL 0 |
| Open conflicten | geen |

**Open taken:** geen.

<!-- jarvis:feiten:eind -->

## Waar staan we

De engine is afgesplitst uit het project waarin hij is gebouwd, met de
commitgeschiedenis van `jarvis/` en `tests/jarvis`. Deze repository is de bron;
consumers nemen hem op als git-afhankelijkheid op een vastgepinde commit en
roepen `npx jarvis <opdracht>` aan.

## Volgende stap

De eerste consumer overstappen op de afhankelijkheid en de poort daar de
engine-SHA laten controleren.
