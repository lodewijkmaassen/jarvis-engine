# CURRENT_STATE — jarvis-engine

<!-- jarvis:feiten:start -->

<!-- Dit blok wordt gegenereerd door `jarvis state`. Handmatige wijzigingen
     worden door CI gedetecteerd en overschreven. Schrijf je toelichting
     onder het blok, niet erin. -->

_Gegenereerd op 2026-10-02._

| Feit | Waarde |
|---|---|
| Hoofdbranch | `main` |
| Hoogste migratie | onbekend |
| Testbestanden | 45 |
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
| T-20261002-technische-uitvoering | actief | Technische uitvoering volledig door Jarvis |

<!-- jarvis:feiten:eind -->

## Waar staan we

Twee reparaties aan het mandaat uit de taak, allebei door de toetsing
gevonden en allebei op de plaats waar de eigenaar beslist.

**De soorten overschaduwden elkaar.** `raaktHardeUitzondering` en
`soortenHardeUitzondering` namen de *eerste* treffer uit
`HARDE_UITZONDERINGEN`, en `/^\.github\//` staat hoog in die lijst. Daardoor
gold `.github/.env` als "workflows", net als `.github/migrations/`,
`.github/CON-*.md` en `.github/constraints/`. Een taak die alleen workflows
aankondigde kreeg er dus stilzwijgend een staand mandaat op secrets,
productiedata en governance-records bij — drie van de vier soorten die
`DEC-0043` §2 bij naam noemt. Dit was eerder één keer gerepareerd door
CODEOWNERS in de lijst naar voren te halen; dat behandelde het symptoom. Nu
verzamelen beide functies **alle** patronen die een pad raakt, en moet een
taak elke geraakte soort afzonderlijk aankondigen. De volgorde van de lijst
doet er niet meer toe.

**Het akkoordscherm beloofde het tegenovergestelde.** Onder een geldig
akkoord stond "een harde uitzondering vraagt apart", en dat is onwaar zodra
een taak er een aankondigt — dan dekt het akkoord die juist. De aankondiging
stond wel in de getoonde tekst, maar ongemarkeerd in een front-matter van elf
regels, onder een onderschrift dat haar tegensprak. Dat is geen informed
consent. De kaart leest nu dezelfde `uitzonderingen:`-sleutel uit dezelfde
tekst waarover de hash gaat, noemt met zoveel woorden wat er wordt
gemandateerd — vóór én na het akkoord — en laat de belofte "vraagt apart"
weg zodra zij niet meer klopt.

De opdrachttekst van een taak is geen administratieve wijziging meer.
`DEC-0044` laat een administratieve pull request door zonder taakakkoord,
zonder scopevergelijking én zonder onafhankelijke toetsing, en de takenmap
viel daar volledig onder — ook `tasks/<taak>/opdracht.md`, de tekst waarvan de
hash het akkoord van de eigenaar draagt en die ook de omvang van het mandaat
vastlegt. Een pull request die precies dat bestand herschreef, kreeg daarmee
de review `taken administratief · autorisaties - · scope - · toetsing -`:
goedgekeurd door de poort zelf, zonder dat één mens of één toetsing ernaar
keek (gemeten 2026-10-02 door QA, in een consumentproject).

Dat was geen weg om stiekem mandaat te winnen — zodra de tekst verandert,
klopt de hash niet meer en vervalt het akkoord, dus zo'n samenvoeging kóst
Jarvis zijn mandaat en de eigenaar ziet de nieuwe tekst voordat hij opnieuw
autoriseert. Het gat zit ervóór: die nieuwe tekst werd zonder toetsing en
zonder zijn medeweten geschreven, en hij tikt er straks op.

`herschrevenScope` scheidt nu twee gevallen die niet hetzelfde zijn. Een
*nieuw* dossier blijft administratief: het voegt een tekst toe die nog niemand
heeft goedgekeurd en die niets mandateert zolang er geen akkoord op ligt. Een
*bestaand* dossier herschrijven is dat niet — dan gelden het taakakkoord, de
scopevergelijking en de toetsing gewoon, en omdat de hash per definitie niet
meer klopt, loopt zo'n pull request over een apart akkoord van de eigenaar op
die ene pull request (`DEC-0043` §2). Een bestand zonder bekende status telt
als herschreven: onbekend mag nooit de soepelste uitkomst opleveren.

`verzamelAttestatieFeiten` is daarvoor geëxporteerd met een injecteerbare
GitHub-lezer. Dat is dezelfde les als bij de akkoordstand: twee velden die
daar wegvallen maken de beoordeling stilletjes soepeler, en dat valt alleen
vast te leggen door het samenstellen werkelijk te draaien. Vier sabotages op
de keten — het patroon niet doorgeven, de status niet doorgeven, elke status
"added" noemen, de dichting eruit — vallen nu alle vier om.

Eén uitzondering hoort erbij, en de toetsing wees haar aan: de taakstatus
staat in de front-matter van `opdracht.md`, dus een dossier sluiten is
strikt genomen een wijziging van de scope-tekst. Zonder uitzondering zou
elke afsluiting een akkoord van de eigenaar vragen, terwijl "administratief
afsluiten" juist hoort bij wat Jarvis zelf doet. `alleenStatusVerschil`
vergelijkt daarom de versie op de kop met die op de basis en laat precies één
geval door: evenveel regels, alle andere regels identiek, de veranderende
regel is aan beide kanten een `status:` binnen de front-matter, en de nieuwe
waarde is een bekend statuswoord. Een regel erbij, een andere sleutel of een
status die niet bestaat telt gewoon als herschrijven, en een bestand waarvan
de basisversie niet te lezen is ook.

Ronde 2 vond daar nog een lek in en een belofte die de code niet waarmaakte.
Het lek: alleen tellen dat er twee `---` staan is niet genoeg. Een dossier met
een lege regel en vrije tekst tussen die strepen — een front-matter die geen
front-matter is — liet een regel `status: actief` middenin de hoofdtekst als
front-matter gelden, en die mocht dan vrij veranderen. Een nieuw dossier
aanmaken is administratief, dus Jarvis kon zo'n bestand zelf neerzetten en het
later langs de uitzondering herschrijven. Het blok tussen de strepen moet nu
ook werkelijk uit sleutels en lijstitems bestaan.

De belofte: de reden "vraagt zijn akkoord op deze pull request" werd
onvoorwaardelijk opgevoerd, ook met een geldig akkoord op precies die kop.
Daarmee kon een herschreven opdrachttekst nóóit machinaal worden geattesteerd,
terwijl de tekst eromheen — en `DEC-0043` §2 — die weg juist aanwijzen. Veilig
falen is goed, maar een uitweg beloven die niet bestaat is dat niet.
`akkoordOpDezeKop` is nu één functie die beide plaatsen gebruiken.

Eén eigenschap van die uitzondering verdient het om genoemd te worden: zij is
richtingloos. `afgerond → actief` gaat er net zo goed doorheen als andersom, en
dat is juist — heropenen is even administratief als sluiten. Maar omdat het
akkoord aan de hash van het hele bestand hangt, brengt het terugdraaien van een
statusregel een hash terug die de eigenaar ooit tekende, en daarmee leeft dat
akkoord weer. Een statuswijziging is dus geen intrekkingsmechanisme; intrekken
loopt over de autorisatie zelf.

Twee kleinere dingen uit dezelfde ronde: het patroon is hoofdletterongevoelig
geworden (`Opdracht.md` kwam er anders doorheen, net zoals
`HARDE_UITZONDERINGEN` dat voor `CON-*.md` al ondervond), en een ontbrekend
scopepatroon valt nu dicht in plaats van open — het viel terug op "niets", in
tegenspraak met de regel ernaast dat onbekend nooit de soepelste uitkomst mag
geven.

De vraag "wie is aan zet" wordt nog maar op één plaats beantwoord, en de
database telt daarin mee. `akkoord_nodig` in `overzicht.ts` las eerder alleen
het dossier: vraagt de voortgangslijst of de eigenaarslijst om een akkoord, dan
stond de taak op "wacht op jou". De akkoordkaart in de interface keek daarnaast
in `jarvis.autorisaties` en verdween zodra er een geldig akkoord op de huidige
scope lag. Daardoor kon één taak tegelijk **WACHT OP JOU** tonen, in "Wie en
waar" melden dat de eigenaar aan zet was, en onder "Bij jou uit deze taak" en in
het centrale "Voor jou" **niets** laten zien. De eigenaar zag een vraag die hij
nergens kon beantwoorden, omdat hij hem al beantwoord had (gemeld 2026-10-02,
binnen `T-20261002-technische-uitvoering`).

`leesTaken` krijgt nu de gemeten akkoordstand mee — taak-id naar de
`scope_hash` van het laatste taakakkoord — en past dezelfde toets toe die de
kaart al deed: een akkoord telt alleen op precies de huidige scope, dus een
gewijzigde `opdracht.md` laat het vervallen zoals `DEC-0043` voorschrijft. De
stand komt uit `AUTORISATIES_SQL` — één vraag voor alle taken samen, over de
weg die er toch al is; er komt geen credential bij en de allowlist van de Edge
Function blijft ongemoeid. Daar hoort een grens bij: dat statement geeft de
laatste tweehonderd rijen, en valt een akkoord daarbuiten dan leest het als
"geen akkoord" — een vraag te veel, nooit een akkoord te veel. Een eerdere
versie vroeg per taak en zei erbij dat dat niets kostte; de toetsing mat dat
`jarvis overzicht` daarmee van ongeveer één seconde naar acht tot veertien
ging, omdat elke vraag een eigen HTTPS-ronde was. Is de database niet te lezen, dan is de stand *niet gemeten*
(`akkoord_gemeten: false`) en valt het overzicht terug op het dossier — liever
een vraag te veel dan een akkoord aannemen dat er niet is.

De interface leest voortaan `zetVan(t)`: één ijking per render, en daarna lezen
de kaart, de statusregel, "Wie en waar" en "Bij jou uit deze taak" uit dezelfde
twee velden. Die laag mag alleen nog afzwakken — het venster tussen een vers
akkoord en de volgende bouw — en nooit een vraag toevoegen die de bouw niet
stelde. Een punt dat werkelijk bij de eigenaar ligt, houdt de taak op "wacht op
jou", ook met een geldig akkoord.

De bedrading wordt nu ook getoetst, en niet alleen de onderdelen. QA keurde de
eerste ronde af omdat zeven sabotages op het productiepad de hele suite groen
lieten: de doorgifte van de akkoordstand doorgesneden, `zetKort`/`zetTekst`
terug op het oude veld, de ijking uit `render` gehaald — alles ongemerkt.
`tests/jarvis/paginafuncties.ts` knipt de declaraties met haakjestelling uit
`jarvis.html` en voert ze samen uit, zodat de pagina te toetsen is zoals zij
draait en niet zoals zij leest; `staat` is het enige dat de test erin brengt.
Daarop staan nu zeven scenario's die de vier plaatsen uit de melding naast
elkaar leggen. Alle zeven sabotages vallen om. `leesTaakakkoorden` is daarvoor
geëxporteerd met een injecteerbare verbinding — de enige manier om de
faalrichting uit te voeren in plaats van haar af te lezen — en vangt sinds deze
ronde ook een worp uit het opzetten van de verbinding zelf, die eerder
`jarvis overzicht` en `jarvis regie` kon afbreken.

Ronde 2 keurde opnieuw af, en wees twee dingen aan die een les dragen. De
brontest op de aanroep van `bouwOverzicht` borgde een *vorm* en geen gedrag:
`await leesTaakakkoorden(…) && null` kwam er ongemerkt doorheen, terwijl
diezelfde aanroep meerregelig geschreven de suite rood maakte. Doorlaten wat
fout is én afkeuren wat goed is. En de verdediging ervoor — "dit valt niet uit
te voeren" — was onjuist: `tests/jarvis/extern.test.ts` draait die weg al.
`bouwOverzichtVanuit` heeft nu dezelfde naad als `leesTaakakkoorden`, en de
test draait de echte opdracht op de echte dossiers met één stub op de plaats
van de database. Wie een test op brontekst schrijft, hoort eerst aan te tonen
dat de uitvoerbare weg werkelijk is afgesloten.

Het tweede: vier leesplaatsen van `zetVan` bleven onbewaakt, en ze één voor
één afdekken dekt de volgende niet. Daarvoor staat er nu een invariant op de
pagina — buiten `zetVan` en de filter op "niemand" leest niets `aan_zet`
rechtstreeks — en een tweede die zegt dat `akkoord_open` en `eigen_punten`
precies één schrijver hebben. Samen vangen zij ook het geval dat de ijking
wél draait maar erna wordt overschreven.

Een dossier kan nu sluiten zonder te beweren dat er iets is opgeleverd. Naast
`afgerond` kent een taakdossier het statuswoord `vervallen`: beëindigd, bewaard
als historie, en niets geleverd. Eén bron bepaalt dat — `sluitDossier` in
`overzicht.ts` — en de regie, het feitenblok, de eigenaarslijst en de interface
lezen alle vier uit die ene bron. Dat was nodig omdat dezelfde vraag op vier
plaatsen zijn eigen antwoord had: vier keer `status !== "afgerond"`, elk met
zijn eigen kans om een nieuw sluitwoord te missen.

Het onderscheid is geen woordenspel. Werk beëindigen door het `afgerond` te
noemen, laat de interface tegen de eigenaar zeggen dat niet-opgeleverd werk
klaar is — een statusdocument dat achterloopt maar wél vertrouwd wordt, precies
het faalpad dat `openTakenUitDossiers` ooit dichtzette. Daarom draagt het vak
`afgerond` voor zo'n taak de reden "vervallen, niet opgeleverd", en niet
"afgerond".

Twee gevolgen die uit de regel volgen en apart zijn vastgelegd: een vervallen
dossier levert geen punten meer voor de eigenaarslijst (anders blijft een
beëindigd akkoordverzoek elke ronde terugkomen), en een stap die op een
vervallen taak wacht is een AFWIJKING en geen wachttoestand — die taak wordt
nooit meer afgerond, dus wachten is eeuwig wachten.

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
tokens en mag die niet leren kennen, dus komt het register als bestand binnen
(`jarvis regie --uitvoerders <pad>`, standaard `jarvis/uitvoerders.json`), en
is de parameter optioneel zodat elke bestaande aanroep blijft werken.

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

Sinds 2026-09-29 telt per controle alleen nog het resultaat dat nog geldt. De
poortworkflow draait op `push`, op `pull_request` en op `pull_request_review`,
en alle drie checken dezelfde commit uit; op één kop staan dus meerdere runs met
dezelfde jobnaam. `laatstePerNaam` liet daarvan alleen een opgevolgde
GEANNULEERDE run weg, zodat een eerdere rode run voorgoed bleef meetellen naast
een latere groene. Dat zette de ack-constructie buiten werking voor precies het
geval waarvoor ze is gebouwd: de `pull_request_review`-run is de enige die de
`REVIEW_*`-omgeving krijgt en dus de ack van de eigenaar ziet, maar zij kon de
rode run vóór haar niet overstemmen. Een run vervalt nu voor een latere geldige
run van dezelfde workflow. Bewust smal: vergeleken wordt op naam én herkomst
(het workflow-id), zodat QA-bevinding N-1 blijft staan en een toegevoegde
workflow met een job `poort` een echte rode poort niet onzichtbaar maakt. Een
geannuleerde run vervangt niets, en zonder bekende herkomst vervalt er niets.
Aan de autorisatie — goedkeuring, attestatie, scopecontrole — is niets gewijzigd.


Nieuw sinds 2026-10-02: **de attestatieworkflow voegt zelf samen wat zij heeft
goedgekeurd**, wanneer `attestatie.samenvoegen` in `jarvis.config.yml` aanstaat.

De aanleiding staat los van de governance en zat in de uitvoeringsomgeving. De
uitvoerder kan `jarvis pr mergen` niet draaien: de permissieclassificatie van
zijn omgeving weigert dat met "Merge Without Review", ook wanneer de
goedkeurende review er aantoonbaar staat en de opdracht zelf zegt "klaar om
samen te voegen". Die classificatie leest de opdrachtregel en kan de
autorisatietoestand niet zien, dus meer bewijs leveren helpt niet. Daardoor
bleef de laatste stap van een volledig geautoriseerde keten liggen voor een
mens.

Er komt geen autorisatieweg bij. De run leest de pull request opnieuw (de
review die zij zojuist afgaf hoort erbij te staan), velt het oordeel met
dezelfde `beoordeelSamenvoegen` die `jarvis pr mergen` gebruikt, en pint de
merge op de kop die is geattesteerd — duwt iemand er een commit tussen, dan
weigert GitHub. Nog niet rijp is geen fout: de attestatie staat en blijft
staan, en een volgende ronde voegt samen.

Het samenvoegen is een **eigen job** met `contents: write`, die alleen draait
wanneer de eerste job meldt dat de configuratie het aanzet. Rechten gelden per
job: zat het in één job, dan kreeg elke repository die deze workflow spiegelt
schrijfrecht op haar hoofdbranch, ook zonder de functie te gebruiken. Op
workflowniveau staan nu geen rechten. De tweede job neemt niets aan uit de
eerste: dezelfde beoordeling draait er opnieuw op de huidige feiten, en de
configuratie moet het daar ook nog toestaan.

Twee dingen die uit de toetsing kwamen en er wezenlijk bij horen. Het
samenvoegen leest de database via dezelfde leesbeelden als het attesteren, want
in een runner is er geen verbindingsreeks en draagt de Edge Function geen
credential — zonder dat zou elke attestatie daar "niet te verifiëren" heten. En
een al bestaande attestatie is geen reden om te stoppen: GitHub berekent
`mergeable` asynchroon, dus de eerste ronde strandt regelmatig op een kop die
nog niet beoordeeld is. De samenvoegstap wacht daar kort en begrensd op, en een
volgende ronde probeert gewoon opnieuw.

De uitkomst is machineleesbaar (`samenvoegen` en `samengevoegd` in
`$GITHUB_OUTPUT`), zodat "geattesteerd maar niet samengevoegd" van buitenaf
zichtbaar is in plaats van te verdwijnen achter een exitcode 0.

Nieuw sinds 2026-10-02: de keten kan voorbij de repositorygrens kijken.
`bouw.mjs` zet met `--merk <commit>` een `<meta name="jarvis-bouwmerk">` in de
gebouwde `index.html`, de pagina toont dat merk afgekort naast `v${versie}`, en
`jarvis uitrol --url <adres> --merk <commit>` haalt de uitgerolde pagina op en
vergelijkt. De aanleiding is één gemeten geval: een uitrol van de interface
verving de bestanden niet, elke stap ervoor was groen, en het defect zat precies
in het gat tussen bron en productie. Daar was geen controle, dus was "klaar" een
aanname.

Drie regels die bij die controle horen. Een ontbrekend merk is een fout en geen
onbekende — de pagina is dan niet vervangen of niet met een merk gebouwd, en in
beide gevallen is de uitrol niet aangetoond. Een pagina die niet op te halen is,
is eveneens rood: niet gemeten is niet geslaagd. En de controle vraagt het
gewone adres zonder cache-brekende parameter op, want een CDN dat een oude
pagina blijft serveren is zelf een van de manieren waarop een uitrol mislukt.

De bouw zonder `--merk` blijft werken en waarschuwt alleen; de uitrolworkflow
die dit merk verplicht stelt, is nog niet gebouwd.

Nieuw sinds 2026-10-02: **een taak kan haar eigen harde uitzonderingen
aankondigen, en het akkoord van de eigenaar dekt die dan in één keer.**

`DEC-0043` §2 eiste tot nu toe een apart akkoord op élke kop die een harde
uitzondering raakt. Binnen één taak die nu eenmaal workflows en
governanceconfiguratie moet aanpassen, betekende dat een akkoord per pull
request — vier keer dezelfde vraag voor vier leveringen die allemaal binnen
dezelfde goedgekeurde opdracht vielen. Dat is het tegenovergestelde van wat
één akkoord op een afgebakende taak hoort te betekenen.

De vraag verhuist naar voren. `opdracht.md` kondigt in zijn front-matter aan
welke soorten de taak raakt (`uitzonderingen: [...]`), en de eigenaar keurt
dát goed. `gemandateerdeUitzonderingen` leest die aankondiging, maar alleen
van taken waarvan het akkoord op deze kop geldig is.

Wat dit dichthoudt is de scope-hash, en dat is geen bijvangst maar de reden
dat het kan: de hash gaat over `opdracht.md` als geheel. Een soort bijschrijven
verandert de hash en laat het akkoord vervallen, dus een pull request kan zijn
eigen mandaat niet schrijven. Het mandaat groeit alleen doordat de eigenaar
opnieuw goedkeurt — hij beslist nog steeds alles, maar één keer per taak in
plaats van één keer per levering.

Vijf grenzen houden het mandaat smal, en de eerste is de belangrijkste omdat
zij uit een toetsing kwam die een echt gat vond.

1. **De regel `Uitzonderingen:` in de PR-tekst moet precies zijn wat de
   bestanden opleveren.** Die regel is het enige kanaal voor een uitzondering
   zónder bestandspad — een productieactie, een sleutelrotatie, een extern
   account. Zonder deze eis lift zo'n verklaring mee op een gemandateerde
   treffer: een pull request die een aangekondigde workflow wijzigt én in zijn
   tekst een sleutelrotatie aankondigt, werd zonder enig akkoord geattesteerd.
2. **Alleen soorten die werkelijk worden geraakt hoeven gedekt te zijn**, en
   één ongedekte soort is genoeg om te weigeren.
3. **Geen mandaat bij meer dan één taak in één pull request.** Dan is niet te
   zien welk bestand bij welke taak hoort, en zou de aankondiging van de ene
   de andere dekken.
4. **Een soort die niet bestaat geeft geen mandaat.** Een typefout in het
   dossier levert dus geen stille dekking op maar gewoon geen.
5. **Het aparte akkoord per kop werkt onveranderd**, voor alles wat een taak
   vooraf niet kon zien.

`CODEOWNERS` heeft daarbij een eigen soort gekregen: hij viel onder het
patroon van `.github/`, zodat een mandaat op workflows er ongemerkt een
staand mandaat op wie-wat-mag-beoordelen bij gaf.

**En de beslissende code is nu zelf een harde uitzondering.** Dat sluit wat
het zelfstandig samenvoegen openzette: een pull request die alleen
`attestatie.ts` of `pr.ts` wijzigt raakte geen enkele harde uitzondering, werd
dus door de poort zelf geattesteerd en samengevoegd, en elke volgende levering
werd daarna door de gewijzigde code beoordeeld. Niet in één stap — de
beslissende code draait van de hoofdbranch, dus een pull request keurt zichzelf
niet goed — maar wel in twee. Gemeten in deze repository: `jarvis/src/` stond
niet in `extra_paden`, en de beveiliging van de hoofdbranch dwingt review door
de code-eigenaar niet af.

Standaard is die soort niet onder een taakmandaat te brengen: een taak moet
haar uitdrukkelijk aankondigen, en dan heeft de eigenaar het gezien in het
dossier dat hij goedkeurt. Zonder aankondiging vraagt zo'n wijziging een apart
akkoord op de kop — veilig als uitgangspunt, zonder dat hij iets hoeft te
beslissen.

De attestatietekst noemt voortaan de grond — `apart akkoord <id>` of `mandaat
uit <taak>` — zodat achteraf te zien is waarop is geattesteerd.


## Volgende stap

De eerste consumer overstappen op de afhankelijkheid.
