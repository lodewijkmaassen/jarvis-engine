# CURRENT_STATE — jarvis-engine

<!-- jarvis:feiten:start -->

<!-- Dit blok wordt gegenereerd door `jarvis state`. Handmatige wijzigingen
     worden door CI gedetecteerd en overschreven. Schrijf je toelichting
     onder het blok, niet erin. -->

_Gegenereerd op 2026-09-17._

| Feit | Waarde |
|---|---|
| Hoofdbranch | `main` |
| Hoogste migratie | onbekend |
| Testbestanden | 31 |
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

De regie herkent sinds deze wijziging een uitvoerder die stilvalt. Een claim
waarvan de heartbeat verliep zonder fout, klaar of vrijgave viel terug op
`QUEUED`: de taak werd opnieuw aangeboden, maar de blokkade zelf stond nergens
— ze telde niet als afwijking en de rol bleef "beschikbaar" heten. Een
regieronde kon daardoor een rustige wachtrij melden terwijl er een sessie op
een goedkeuringsvraag stond. Die stilte is juist de handtekening van dat geval,
want zo'n sessie stopt met heartbeaten zonder luid te falen; detectie kan dus
niet op een melding wachten en leunt op het uitblijven ervan. Nu krijgt zo'n
taak `blokkade: "uitvoerder_stil"` en telt ze als afwijking, en komt de rol
waarvan de uitvoering vastliep op `herstel` in plaats van `beschikbaar` — voor
elke rol, de task-controller inbegrepen, want ook die kan zelf claimen.

Wat de blokkade met de *toestand* doet, hangt af van wat de taak verder
tegenhoudt. Houdt niets anders haar tegen, dan is de vastgelopen uitvoerder de
blokkade: `BLOCKED`, herstel bij de task-controller, uitvoerbaar en vóór op
gewoon werk, zodat een andere uitvoerder hem kan overnemen. Wacht de taak
daarnaast op een akkoord van de eigenaar of op een merge, dan blijft díé
toestand staan en reist de blokkade er alleen in mee. Dat is bewust: anders zou
een kaart voor de eigenaar een ronde lang uit beeld raken, en zou "opnieuw
dispatchen" verkeerd advies zijn aan een taak die op een pull request wacht.
Het `waarom` draagt dan de opdracht om eerst de vastgelopen claim op te ruimen.

Ander werk raakt dit niet en de taak hervat vanzelf zodra er weer activiteit
is. Een gemelde fout krijgt `blokkade: "fout"` en telt niet als afwijking: die
staat al luid in de regie. Het herstel is nooit werk voor de eigenaar — een
vastgelopen sessie is een ontbrekende capability of een interne
toolgoedkeuring, en die zijn van Jarvis.

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

`jarvis pr attesteren` noemt zijn eigen terugval. Een geweigerde
workflow-dispatch gaf een kale 403, waarna de uitvoerder per run opnieuw moest
uitzoeken dat dezelfde workflow langs een andere weg wél op gang komt. De
opdracht scheidt nu de weigering van het uitvoeringsplatform ("not permitted
for this session type" — geen uitspraak over de bevoegdheid van Jarvis) van
een ontbrekend `actions: write`-recht en van alle overige weigeringen, en
noemt bij de eerste twee de terugval mét workflow, ref en invoer. De weigering
zelf blijft de eerste regel, zodat de meting niet uit het logboek verdwijnt;
bij een bruikbare terugval is de exitcode 4 in plaats van 1, zodat een routine
erop kan vertakken zonder de tekst te lezen.

`jarvis pr wie` meet de drie rechten apart en vat ze nergens samen. Lezen,
schrijven op inhoud en het recht een workflow te starten zijn verschillende
dingen, maar de opdracht goot ze in één uitspraak over "schrijfrecht". Op de
cloud was die uitspraak onjuist — de bot had de rol `write` en pushte, opende
pull requests en voegde samen, terwijl `wie` "geen schrijfrecht" meldde omdat
de attestatie een 403 gaf over iets heel anders — en de routineprompt bindt er
een gevolg aan: bij "geen schrijfrecht" slaat een run alles over wat een pull
request opent, attesteert of samenvoegt. `duidRechten` geeft nu per soort een
eigen regel. Schrijfrecht blijft `null` zodra het permissions-veld ontbreekt of
de uitvoerder in de cloud draait, want daar zegt dat veld niets (gemeten
2026-09-14 en 2026-09-15). Het recht een workflow te starten is nooit `true` of
`false`: een dispatch ís de handeling, dus vooraf niet te meten zonder
bijwerking; de regel verwijst naar waar het wél blijkt, en in de cloud naar de
vastgelegde weigering van het sessietype.

## Volgende stap

De eerste consumer overstappen op de afhankelijkheid.
