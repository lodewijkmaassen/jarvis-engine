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
| Testbestanden | 28 |
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

## Providerafgeleiden

`jarvis rollen` genereert twee soorten afgeleiden uit de rolcontracten. De
eerste is de vorm van één werkomgeving: agentdefinities met front-matter en
gereedschapsnamen, plus een overzichtsblok in het instapdocument. De tweede,
nieuw, is leveranciersneutraal: één JSON-document (`rol_neutraal` in de
configuratie) met per rol de titel, de samenvatting, de vermogens, het bronpad
en de volledige contracttekst, zonder front-matter, voorvoegsel of
gereedschapsnaam. Een ander gereedschap kan daaruit zijn eigen vorm maken
zonder handwerk; de driftcontrole van de poort dekt beide vormen. De engine
schrijft de neutrale afgeleide alleen als een consumer er een pad voor
configureert; zonder pad verandert er niets.

## Volgende stap

De eerste consumer overstappen op de afhankelijkheid.
