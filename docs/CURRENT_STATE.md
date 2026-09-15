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

De rolcontracten in `jarvis/roles/` zijn de bron; `jarvis rollen` leidt er drie
vormen uit af en bewaakt ze op drift: de agentdefinities en het rollenblok van
de werkomgeving, en een leveranciersneutrale, machineleesbare vorm zonder
front-matter of gereedschapsnamen, zodat een tweede gereedschap dezelfde
contracten kan inlezen. Die derde vorm komt alleen mee als een project hem
configureert (`rol_neutraal`); deze repository laat hem leeg.

## Volgende stap

De eerste consumer overstappen op de afhankelijkheid.
