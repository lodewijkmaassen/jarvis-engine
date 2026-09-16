# CURRENT_STATE — jarvis-engine

<!-- jarvis:feiten:start -->

<!-- Dit blok wordt gegenereerd door `jarvis state`. Handmatige wijzigingen
     worden door CI gedetecteerd en overschreven. Schrijf je toelichting
     onder het blok, niet erin. -->

_Gegenereerd op 2026-09-16._

| Feit | Waarde |
|---|---|
| Hoofdbranch | `main` |
| Hoogste migratie | onbekend |
| Testbestanden | 30 |
| Kennisrecords | DEC 0 · CON 0 · LRN 0 · RSK 0 · CFL 0 |
| Open conflicten | geen |

**Open taken**

| Taak | Status | Titel |
|---|---|---|
| T-20260911-jarvis-app | actief | Jarvis als app op de telefoon, zoals Kasboek |
| T-20260912-altijd-aan | actief | Opdrachten vanaf de telefoon worden ook verwerkt als de laptop uit staat |
| T-20260912-sanitizer-toekenning | actief | Sanitizer — toekenningspatroon voor korte secrets en een patroon voor postadressen |
| T-20260913-akkoord-geven | actief | Autorisatie van de eigenaar via de Jarvis-interface, niet via handelingen op GitHub |
| T-20260914-agent-operations | actief | Jarvis als observeerbaar en autonoom digitaal team — Operations-view en Task Controller |
| T-20260914-eigen-laag | actief | De eigen Jarvis-laag (app en database) leidend; de artifact-database en sessiegebonden bestanden geen afhankelijkheid meer |

<!-- jarvis:feiten:eind -->

## Waar staan we

De engine is afgesplitst uit het project waarin hij is gebouwd, met de
commitgeschiedenis van `jarvis/`. Deze repository is de bron; consumers nemen
hem op als git-afhankelijkheid op een vastgepinde commit en roepen
`npx jarvis <opdracht>` aan. De poort kent twee standen: in deze repository
staat de canonieke workflow in `jarvis/canonical/`, bij een consumer komt hij
mee met de geïnstalleerde engine; de stap `engine` controleert bij een consumer
dat de gepinde, geïnstalleerde engine-SHA op `main` van deze repository staat.

Het feitenblok noemt sinds deze wijziging de open taken die het uit de
taakdossiers afleidt. Daarvoor gaf de verzamelaar het veld hardgecodeerd leeg
mee, zodat `CURRENT_STATE.md` in elke repository "Open taken: geen" meldde —
ook met acht actieve taken. Precies de drift die dit document zou dichtzetten.

De ontsnapping van dossiertekst in dat blok is nu omkeerbaar. Een backslash
direct vóór een pijp brak de rij alsnog in tweeën, en `&lt;!--` uit een
dossier was niet te onderscheiden van een echte `<!--`; backslash en
ampersand worden daarom zelf ontsnapt, in die volgorde. Een lege of
alleen-witruimte-titel valt nu terug op het taak-id in plaats van een lege
cel te geven. Eén bevinding uit dezelfde QA-ronde staat nog open: een dossier
met kapotte front-matter of een ander statuswoord (`open`, `gepland`)
verdwijnt stil uit het blok met exit 0 — pre-existent gedrag van
`leesTaakDossiers`, en het verandert wélke taken als open tellen, dus een
eigen ronde.

Sinds `jarvis review` (DEC-0045 in ToVas Flow) heeft de engine een rol
`reviewer`: een tweede model leest een pull request met alleen de relevante
context — de PR, het taakdossier en het contextpakket van de kennislaag — en
oordeelt op aannames, risico's en samenhang; hoogstens één ronde per pull
request (het document `review/<repo>#<n>` in de eigen database is de grendel),
daarna hoogstens één correctie. De aanroep gaat via de database
(`jarvis.vraag_review`/`jarvis.lees_review`, pg_net), zodat de API-sleutel in
de Vault blijft; de engine kent geen leveranciersnaam en spreekt het gangbare
chat-completions-formaat. Tegelijk bewaakt `jarvis db bericht` de
eigenaarstaal: een bericht met technische namen wordt geweigerd, de
technische bron gaat mee in `--technisch` en de app toont hem ingeklapt.

## Volgende stap

De eerste consumer overstappen op de afhankelijkheid.
