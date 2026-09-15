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

De weg van een dossierregel naar een cel van dat blok is daarna aangescherpt op
drie punten die QA-ronde 2 vond. `veiligeCel` verdubbelt nu eerst de
backslashes en ontsnapt pas daarna de pijpen, zodat een titel met `\|` de rij
niet stil een vierde kolom geeft; de ontsnapping van `<!--` is omkeerbaar
gemaakt door `&` als eerste te vervangen, zodat een titel die letterlijk
`&lt;!--` bevat niet dezelfde cel oplevert als een titel met `<!--`; en de
terugval op het id grijpt nu ook bij een lege of alleen-witruimte-titel, die
als lege string langs de nullish-variant glipte.

Eén bevinding uit dezelfde ronde staat bewust open: een dossier met kapotte
front-matter of een ander statuswoord (`open`, `gepland`) verdwijnt stil uit
het blok, met exit 0. Dat is geen slordigheid maar een vastgelegde keuze — de
test "laat afgeronde, geblokkeerde en statusloze taken buiten het feitenblok"
legt hem expliciet vast. Het omdraaien verandert wat "open taak" betekent en
hoort daarom langs een besluit te lopen, niet langs een backlogregel.

## Volgende stap

De eerste consumer overstappen op de afhankelijkheid.
