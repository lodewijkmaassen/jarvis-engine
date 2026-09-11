# CURRENT_STATE — jarvis-engine

<!-- jarvis:feiten:start -->
<!-- jarvis:feiten:eind -->

## Waar staan we

De engine is afgesplitst uit het project waarin hij is gebouwd, met de
commitgeschiedenis van `jarvis/` en `tests/jarvis`. Deze repository is de bron;
consumers nemen hem op als git-afhankelijkheid op een vastgepinde commit en
roepen `npx jarvis <opdracht>` aan.

## Volgende stap

De eerste consumer overstappen op de afhankelijkheid en de poort daar de
engine-SHA laten controleren.
