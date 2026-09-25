# CURRENT_STATE — jarvis-engine

<!-- jarvis:feiten:start -->

<!-- Dit blok wordt gegenereerd door `jarvis state`. Handmatige wijzigingen
     worden door CI gedetecteerd en overschreven. Schrijf je toelichting
     onder het blok, niet erin. -->

_Gegenereerd op 2026-09-25._

| Feit | Waarde |
|---|---|
| Hoofdbranch | `main` |
| Hoogste migratie | onbekend |
| Testbestanden | 39 |
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
| T-20260917-chatgpt-review | actief | Een tweede model als onafhankelijke reviewer in de keten, en eigenaarstaal in de app |

<!-- jarvis:feiten:eind -->

## Waar staan we

De controle schaalt mee met de wijziging. Het rolcontract eiste vóór elke
commit alle vier de projectcontroles, ook bij een commit die alleen een dossier
of een statusdocument raakt — en die vier zeggen over een tekstbestand niets.
Ze draaien nu zodra de commit ook maar één pad raakt dat geen documentatie,
dossier of kennisrecord is; bij twijfel draaien ze wel. De poort blijft bij
elke commit staan.

Daarbij hoort een tweede regel, uit de meting: groen is een ondergrens, geen
bewijs. De fouten die in de laatste reeks wijzigingen werkelijk tot in
productie doorliepen — een veld dat stil uit de weergavelaag viel, een
botsende klassenaam, een ontbrekend configuratiebestand in een uitrol — waren
geen van drieën met de bestaande tests te vinden, terwijl die bij elke commit
groen stonden. Verandert er iets dat de eigenaar ziet, dan hoort de echte
uitkomst bij het bewijs: de pagina gerenderd, het gepubliceerde document
teruggelezen.

Een lege blokkadesectie blijft ook leeg met opmaak eromheen. `**Geen
blokkade.**` greep niet op de toets `/^(niets|geen|…)/`, want de sectie begon
met een sterretje; de zin werd daardoor zelf als blokkade met urgentie hoog
opgevoerd, en het terugdraaien kostte een volledige pull request met eigen CI-
en goedkeuringsronde. De toets kijkt nu langs de opmaaktekens heen.

Een uitrol zonder `config.js` kan niet meer stil slagen. De app kreeg haar
bron uit een `config.js` die buiten de repository in de doelmap hoorde te
staan; ontbrak hij, dan meldde `bouw.mjs` dat met een waarschuwing en eindigde
met 0, en rolde de uitrol door. De pagina slikte de laadfout ook door
(`onerror="void 0"`) en viel terug op "geen gegevens — open dit op claude.ai of
als eigen app" — een tekst die naar de verkeerde oorzaak wijst wanneer je juist
wél de eigen app draait. Zo stond er na een uitrol een lege interface zonder
dat iets de echte reden noemde.

Nu faalt de bouw met exitcode 1 en schrijft hij niets, want een halve doelmap
is erger dan een lege: die zou alsnog uitgerold worden. Met `--url` en
`--sleutel` schrijft hij de `config.js` zelf, zodat de uitrol één opdracht is
en niemand het bestand met de hand hoeft te zetten; een bestaande `config.js`
blijft staan. De twee waarden zijn publieke identifiers — ze staan in elke
browser die de interface opent — en komen van de aanroeper, niet uit een
bestand in de engine.

Het overzicht deelt het werk in vakken in, en de regie publiceert het mee. Dat
zijn de twee helften van één klacht: de administratieve nulstand was bereikt,
maar in de interface niet te zien. `overzicht/huidig` liep achter omdat
`jarvis regie --schrijf` alleen `regie/huidig` verving en het overzicht van een
losse tweede opdracht afhing; de regie bouwt dat overzicht al in dezelfde run en
schrijft het nu mee, zodat de twee documenten niet meer uiteen kunnen lopen.
Bij een sanitizerbevinding in één van de twee gaat er niets weg — alleen de
schone helft schrijven zou de scheefstand terugbrengen.

En alles wat niet van de eigenaar was, kwam op één hoop. `deelIn` zet elke taak
in precies één vak — actief, backlog, bij jou, wachtend, geparkeerd, afgerond —
en zet de open risico's er apart bij; `nulstand` zegt of er actief werk is, niet
of er niets te zien valt. Actief en backlog scheiden op beweging in het venster,
zodat een volle wachtrij niet als een druk systeem leest. De indeling staat in
de gegevenslaag en niet in de pagina: een tweede kopie van die regel is precies
hoe overzicht en regie eerder uiteen zijn gelopen. Lege vakken blijven in beeld
met een nul erbij, want een vak dat verdwijnt zodra het leeg is maakt van een
nulstand een lege pagina, en dan is niet te zien of er niets is of dat er niets
gemeten is.

Een run laat sinds deze wijziging één spoor na: `jarvis db run start` schrijft
bij het begin een regel met startmoment, oorzaak (rooster, signaal,
vervolgbeurt of handmatig) en uitvoerder, en `jarvis db run klaar` vult
diezelfde regel aan met het einde en de uitkomst. Dat maakt meetbaar wat tot
nu toe alleen indirect af te leiden was — of een push naar een `jarvis/`-branch
nog een run start — want een run die niets te doen had, liet voorheen niets
achter. Het register is bewust géén eigen tabel maar een document langs
`DOCUMENT_SQL`: dat statement staat al in `toegestaneSql()`, dus er is geen
migratie en geen nieuwe uitrol van de Edge Function voor nodig. Omdat
`toegestaneSql()` geen leesweg voor documenten kent, bewaart de lopende run
zijn startregel in een bestand buiten elke repository.

De regie herkent sinds een eerdere wijziging een uitvoerder die stilvalt. Een claim
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

Een stille claim was echter niet het hele geval. Een uitvoerder kan
springlevend lijken — zojuist nog een stap gemeld — en toch geen letter meer
verzetten, omdat hij op een goedkeuringsvraag staat. De heartbeat van de claim
zegt daar niets over. Daarom is de blokkade sinds deze wijziging losgemaakt van
de claim: naast de werkactiviteit leest de regie een tweede bron, het
uitvoerdersregister `uitvoerders/huidig`, dat zegt welke uitvoerders er bestaan
en in welke platformtoestand ze staan — ook de uitvoerder die nooit aan
schrijven toekwam. De engine bevraagt de platformlaag niet zelf: ze kent geen
tokens en mag die niet leren kennen, dus komt het register van buiten binnen —
in deze volgorde: `jarvis regie --uitvoerders <pad>` als dat is meegegeven,
anders `jarvis/uitvoerders.json` in de werkmap, anders het document
`uitvoerders/huidig` uit de eigen database. Die derde weg is de bedoelde weg, en
zij ontbrak: zolang het register alleen van schijf kwam, zag alleen de
uitvoerder die het zojuist zelf had weggeschreven het, en las elke andere
uitvoerder elke uitvoerder als `onbekend`. Nu schrijft de uitvoerder die de
platformlaag mág bevragen het document, en lezen laptop en cloud hetzelfde
beeld. De parameter blijft optioneel, zodat elke bestaande aanroep blijft werken.

Drie manieren waarop het register zelf stil kon liegen, zijn dicht. Een
platformtoestand die de engine niet kent — `requires-action` met een streepje,
`REQUIRES_ACTION`, een leeg veld — viel door de blokkerende lijst heen en werd
met een vers teken stil `ACTIEF` gelezen; `platformtoestandVan` maakt van elke
onbekende waarde `onbekend`. `gegenereerd_op` werd gelezen en nooit gebruikt,
waardoor een register van dagen oud met een `houdbaar_tot` in de toekomst als
"alles in orde" las terwijl de schrijver ervan al lang stil lag;
`registerBruikbaar` telt een register buiten zijn eigen houdbaarheid als
afwezig. En één uitvoerder kan meer dan één ingang hebben — de cloud-uitvoerder
is tegelijk een sessie die nu draait en een roosterroutine die morgen hoort te
wekken — waarvan een `Map<naam, item>` stil de laatste overhield, afhankelijk
van de schrijfvolgorde in het document; alle ingangen worden nu bewaard en het
ergste geval wint.

Een verse werkactiviteit blijft een geldig teken van leven, register of geen
register: een uitvoerder die net een stap schreef is aantoonbaar in leven. Dat
is de grens tegen vals alarm; de bewering van een verlopen register is het niet.

Het register wordt op twéé plekken gevraagd, niet op één. De blokkade hing eerst
volledig aan een lópende claim, en daardoor bleef de productiecasus buiten beeld:
onafhankelijke QA mat dat de regie-uitvoer vóór en na, op `gegenereerd_op` na,
byte-identiek was — nul geblokkeerd, nul afwijkingen — terwijl het register twee
van de drie ingangen als geblokkeerd kende. Twee oorzaken.

Een stap die aan een uitvoerder is *toegewezen* (`**Uitvoerder: laptop.**`) is werk
dat aan hém hangt, ook zonder claim. Die tak vroeg het register nooit: drie taken
stonden aan de onbereikbare laptop toegewezen als `WAITING_FOR_DEPENDENCY` met
`blokkade: null`. Nu is zo'n taak `BLOCKED` met de reden uit het register. Alleen
als het register de uitvoerder **kent**: zonder register mag hij tussen twee taken
door legitiem stil zijn, en anders wordt elke toegewezen stap een blokkade — het
valse alarm van §7.

En de regie draagt nu een lijst `uitvoerders` met per uitvoerder zijn toestand, de
reden en zijn taken. Zonder die lijst was een geblokkeerde uitvoerder alleen via
zijn taken zichtbaar, en dus onzichtbaar zodra hij er geen had. Dat is het geval
van de gepauzeerde roosterroutine: niets wekt de keten nog, geen enkele taak hangt
eraan. De slotregel van `jarvis regie` noemt hen bij naam met hun reden en telt ze
apart. Eis 9 verbiedt een tweede wekker; zíen dat de wekker uit staat is er geen.

Gemeten op de productiecasus van 2026-09-25: vóór `16 open, 5 uitvoerbaar, 0
geblokkeerd, 0 afwijking(en)`; na `16 open, 5 uitvoerbaar, 3 geblokkeerd, 2
uitvoerder(s) geblokkeerd, 3 afwijking(en)`, met beide geblokkeerde uitvoerders bij
naam en met reden. `uitvoerbaar` blijft 5: ander werk gaat door.

**Wat nog niet werkt: het documentpad in de cloud.** De gepubliceerde Edge Function
`jarvis-db` staat op versie 7 en haar allowlist kent `DOCUMENT_LEES_SQL` niet, dus
`jarvis regie` krijgt daar `HTTP 400 — statement niet toegestaan` en valt terug op
`onbekend`. Dat is gemeten, en het weerspreekt wat hier eerder stond: het statement
staat in de allowlist van de engine (`db.ts`), niet in die van de uitgerolde
functie. Tot versie 8 is uitgerold werkt alleen `jarvis regie --uitvoerders <pad>`.
Uitrollen is een deployment en valt buiten de randvoorwaarden van de
cloud-uitvoerder (DEC-0049).

`requires_action`, `blocked` en `failed` blokkeren ongeacht het teken;
`working` met een verlopen teken ook. Ontbreken is een toestand en geen leegte:
een uitvoerder die in geen enkele bron een teken binnen `UITVOERDER_TERMIJN_MINUTEN`
geeft, heet `onbekend` en telt als blokkade — een register dat stilvalt mag niet
hetzelfde effect hebben als een register dat "alles in orde" meldt. Zo'n taak
krijgt `blokkade: "uitvoerder_geblokkeerd"` met de reden in `wacht_op`, telt als
afwijking, en de slotregel van `jarvis regie` draagt een eigen blokkadeteller
naast de afwijkingsteller. Anders dan bij een gemelde fout gaat deze taak niet
vóór op gewoon werk maar zakt ze naar achteren: aan de taak zelf valt niets te
repareren en ander werk moet doorgaan. Ze blijft wel uitvoerbaar, zodat een
andere uitvoerder hem kan overnemen. Hervatten is afleiding en geen actie —
meldt het register de uitvoerder weer als actief, dan loopt de taak vanzelf. Er
komt geen scheduler, wekker of wachtrij bij; een test bewaakt dat.

De engine is afgesplitst uit het project waarin hij is gebouwd, met de
commitgeschiedenis van `jarvis/`. Deze repository is de bron; consumers nemen
hem op als git-afhankelijkheid op een vastgepinde commit en roepen
`npx jarvis <opdracht>` aan. De poort kent twee standen: in deze repository
staat de canonieke workflow in `jarvis/canonical/`, bij een consumer komt hij
mee met de geïnstalleerde engine; de stap `engine` controleert bij een consumer
dat de gepinde, geïnstalleerde engine-SHA op `main` van deze repository staat.

De regie kent sinds deze wijziging een achtste toestand, `WAITING_FOR_EVENT`:
een taak die wacht op iets buiten Jarvis dat niemand kan afdwingen — de
eigenaar die de volgende opdracht typt, een klant die zich meldt. Zo'n stap
viel eerder terug op `QUEUED` en werd elke run opnieuw aan een uitvoerder
aangeboden die er niets mee kon. De markering is expliciet (`wacht op
gebeurtenis: <wat>`) en geen woordpatroon over lopende tekst; de
verantwoordelijke blijft de task-controller, want er wordt niets van de
eigenaar gevraagd (CON-0016).

Het feitenblok noemt sinds deze wijziging de open taken die het uit de
taakdossiers afleidt. Daarvoor gaf de verzamelaar het veld hardgecodeerd leeg
mee, zodat `CURRENT_STATE.md` in elke repository "Open taken: geen" meldde —
ook met acht actieve taken. Precies de drift die dit document zou dichtzetten.

De ontsnapping van dossiertekst in dat blok is nu omkeerbaar. Een backslash
direct vóór een pijp brak de rij alsnog in tweeën, en `&lt;!--` uit een
dossier was niet te onderscheiden van een echte `<!--`; ampersand en
backslash worden daarom zelf ontsnapt, elk vóór de vervanging die ze moeten
beschermen — de ampersand vóór `<!--`, de backslash vóór de pijp. Een lege of
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

De rolcontracten in `jarvis/roles/` zijn de bron; `jarvis rollen` leidt er drie
vormen uit af en bewaakt ze op drift: de agentdefinities en het rollenblok van
de werkomgeving, en een leveranciersneutrale, machineleesbare vorm zonder
front-matter of gereedschapsnamen, zodat een tweede gereedschap dezelfde
contracten kan inlezen. Die derde vorm komt alleen mee als een project hem
configureert (`rol_neutraal`); deze repository laat hem leeg.

De eigenaarslijst wordt gereconcilieerd vóór "Voor jou" wordt opgebouwd. Een
punt was alleen te sluiten door de prozatekst te herschrijven, dus bleven
reeds uitgevoerde handelingen in de lijst staan en vroeg de app ze opnieuw;
een afgevinkt punt (`- [x] …`) telt nu niet mee. En een punt dat het akkoord
op de taak zelf vraagt stond er twee keer — als aan te vinken punt uit het
dossier en als akkoordkaart — terwijl alleen de kaart een autorisatie
vastlegt waar de poort op kan varen (DEC-0043); zo'n punt zet nu
`akkoord_nodig` op de taak in plaats van een eigen item te worden. Daarmee
geldt aan beide kanten: wat gedaan is verdwijnt, en een vereist akkoord
verschijnt precies één keer, in de vorm die het vastlegt.

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
De regie leest sinds deze wijziging ook een toewijzing aan een uitvoerder. Ze
kende drie wachtredenen in de tekst van de eerste open stap — een akkoord van
de eigenaar, een andere taak, een pull request — en een stap die per ontwerp
bij één uitvoerder hoort viel daardoor door naar `QUEUED`, `uitvoerbaar: true`.
Werk dat de cloud niet kán doen stond zo bovenaan elke cloud-dispatchlijst.
`**Uitvoerder: <naam>.**` in de steptekst maakt de stap nu uitvoerbaar voor die
uitvoerder en `WAITING_FOR_DEPENDENCY` voor elke andere; `jarvis regie` zegt
met `--door` wie de ronde draait, en zonder dat wacht een toegewezen stap.
Dat dossier verdwijnt inmiddels niet meer stil. Wélke taken als open tellen is
onveranderd — `OPEN_STATUSSEN` blijft `actief` en `review` — maar wat buiten
die tweedeling valt wordt nu gemeld: `dossiersZonderBekendeStatus` leidt het
af en `jarvis state` waarschuwt met het dossier bij naam en de status die er
staat. Een waarschuwing, geen fout: het blok blijft kloppend voor wat het wél
noemt, en één slordig dossier hoort geen repository de poort uit te werken. De
vraag of `gepland` een open taak hóórt te zijn blijft dus openstaan voor die
eigen ronde; hij is alleen niet meer onzichtbaar zolang niemand hem stelt.
**`jarvis pr attesteren` start geen run meer die vooraf al zou weigeren.** Op
2026-09-17 telde de audit 305 runs van `jarvis-attestatie`; een groot deel
daarvan startte terwijl het taakakkoord, de toetsing op de huidige kop of een
groene poort er nog niet was. De opdracht doet die beoordeling nu vooraf, met
dezelfde `beoordeelAttestatie` en dezelfde feiten als de run zelf — geen tweede
regelset, geen versoepeling, geen nieuwe bron of extra recht. Is er ten minste
één reden, dan blijft de dispatch uit, staat die reden in één regel op stderr en
is de exitcode **3**: nog niet rijp, niets gestart, en nadrukkelijk geen fout.
De voorcontrole is fail open: kan ze haar bron niet lezen — geen
databaseverbinding, een leesfout op GitHub, een onleesbare configuratie — dan
volgt één waarschuwing en gaat de dispatch gewoon door. Ze mag alleen minder
starten, nooit strenger zijn dan de run, die elke controle onveranderd zelf
blijft doen.
Sinds `jarvis review` (DEC-0046 in ToVas Flow) heeft de engine een rol
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

Sinds 2026-09-24 kent het overzicht een vierde antwoord op "wie is aan zet":
naast `jarvis`, `eigenaar` en `niemand` staat er nu `wacht`. Een open stap die
op een gebeurtenis, een andere uitvoerder, een taak of een pull request wacht,
viel daarvoor terug op `jarvis` — de interface meldde dan "JARVIS AAN ZET" over
werk dat bewust geparkeerd was, en na een paar dagen zelfs "STIL", alsof er een
storing was waar een keuze stond. De vier patronen die dat bepalen staan nu op
één plaats in `overzicht.ts` en worden door `regie.ts` geïmporteerd, zodat de
kaart en de wachtrij niet opnieuw uiteen kunnen lopen; een test vergelijkt de
twee beelden per geval. In dezelfde ronde levert een dossier dat in meer dan
één aangesloten repository staat nog maar één taakregel op — de regie had die
wacht al, het overzicht niet — en kort `wacht_op` de reden af tot één regel in
plaats van de volledige staptekst. `jarvis overzicht --schrijf` zet het
overzicht ten slotte zelf in de database, net als `jarvis regie --schrijf`:
publiceren was een losse tweede opdracht die alleen in de afsluitstap van een
routine stond, en een ronde die anders eindigde liet de interface zonder
melding op een oude wereld staan.

## Volgende stap

De eerste consumer overstappen op de afhankelijkheid.
