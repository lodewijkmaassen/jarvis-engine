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
| Testbestanden | 40 |
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

Een eigenaarspunt krijgt zijn soort uit structuur in het dossier, niet uit het
eerste woord van zijn titel. Dat woord bepaalde het tot nu toe: `blokkerend` in
de context, of een titel die met "beslis" begint. Een punt dat luidde "kies
tussen (a) … of (b) …" viel daardoor buiten beide en werd een handeling met één
knop "Gedaan"; de twee alternatieven die de eigenaar in de tekst kreeg
voorgelegd, bereikten de knoppen nooit, en hij heeft die kaart uiteindelijk met
"Gedaan" moeten sluiten voor een keuze die hij al in het gesprek had gegeven.

`EigenaarSoort` benoemt nu wat een punt van de eigenaar vraagt — `akkoord`,
`keuze`, `externe-handeling`, `bevestiging`, `uitstel` — en `bepaalEigenaarSoort`
kiest in deze vaste volgorde, waarbij de eerste tak die past wint:

1. een akkoordcontext (`akkoord_pr`) zónder `- Keuze:`-regel — dan `akkoord`;
2. twee of meer bruikbare alternatieven — dan `keuze`;
3. een punt dat alternatieven aandraagt maar niet bruikbaar (een `- Keuze:`-regel
   zonder twee alternatieven, of optieregels waarvan er te weinig een eigen
   sleutel én een gevolg hebben) — dan `uitstel`, alleen "Later";
4. een `- Extern:`-regel — dan `externe-handeling`;
5. een `- Bevestig:`-regel — dan `bevestiging`;
6. een `- Wacht:`-regel — dan `uitstel`;
7. anders `bevestiging` als veilige terugval.

De knoppen volgen uit het soort: "Gedaan" alleen bij een externe
handeling of een bevestiging, akkoordknoppen alleen waar de governance een
autorisatie eist, en bij een keuze de alternatieven zelf, elk met zijn gevolg.

Drie takken staan waar ze staan omdat onafhankelijke QA ze eerder ergens anders
mat. Een punt dat zelf een vraag stelt gaat vóór de akkoordcontext: een keuze
onder `akkoord_pr` kreeg "Akkoord"/"Niet akkoord" onder de vraagtitel, en de
alternatieven die het dossier had opgeschreven verdwenen volledig uit de kaart.
Zonder `- Keuze:`-regel blijft een akkoord een akkoord, ook met optieregels
erbij. `- Wacht:` staat juist achteraan, en stond één ronde ten onrechte vooraan:
daar wiste zij álle knoppen van een volledig uitgeschreven keuze — de vraag als
kaarttitel, "Later" als enige antwoord, beide alternatieven nergens — en ook de
"Gedaan" van een externe handeling die de eigenaar wél had verricht. Wachten op
iets externs maakt een vraag niet onbeantwoordbaar. Dat de twee samen in één punt
staan is een fout in het dossier, en de poort meldt haar als
`eigenaarslijst_wacht_en_keuze` in plaats van haar stil op te lossen. De derde
tak telt niet alleen een letterlijke `- Keuze:`-regel: een punt met twee
optieregels waarvan er te weinig bruikbaar zijn, viel anders stil terug op
`bevestiging` en kreeg "Gedaan" onder een beslissing die nooit is genomen.

De alternatieven komen uit eigen labelregels; `- Keuze:` draagt de vraag, zodat
de titel de hele vraag is. `- Optie A:` en `- Keuze B:` zijn de uitgeschreven vorm
en gaan vóór op elk ander label, maar zij zijn niet de enige: **elke labelregel die
geen annotatie is en een gevolg draagt, telt als alternatief zodra er twee of meer
van zijn.**

Dat was acht QA-rondes lang omgekeerd, en dat bleek het formaat van de poort in
plaats van dat van de dossiers. Gemeten over de volledige historie van de drie
projecten — 140 unieke eigenaarspunten — schreven er zestien hun alternatieven als
eigen label: `- Publiek:` / `- Privé:`, `- Laten staan:` / `- Herschrijven:`,
`- Ja:` / `- Nee:`, `- Dagelijks:` / `- Alleen bij een sessie:`. Alle zestien waren
een echte vraag aan de eigenaar, en alle zestien kwamen bij hem aan als één knop
"Gedaan" met de alternatieven volledig van de kaart verdwenen. Na deze wijziging
leveren dezelfde dossiers negentien keuzekaarten met werkelijke knoppen op, en geen
enkele kaart met alleen "Later".

Wat nooit een alternatief is, staat in `ANNOTATIELABELS`: `Stap N`, `Controle`,
`Advies`, `Waarom`, `Let op`, `Termijn`, `Gevolg`, `Bron`, `Toelichting`,
`Voorwaarde`, het kale `Keuze` en `Optie`, `Extern`, `Bevestig`, `Wacht`, en `Later`
en `Gedaan` die in de interface een vaste betekenis hebben. Met die lijst levert
dezelfde meting **nul** valse treffers: geen punt met een annotatie (`- Let op:`
naast `- Termijn:`) en geen punt met stappen die allebei moeten gebeuren
(`- Stap 3 (cloud):` naast `- Stap 4 (laptop):`) haalt de drempel. Eén los label is
nooit een keuze — dat is een annotatie, en die mag de vaste knoppen van het soort
niet verdringen. Voor bestaande dossiers herkent de engine daarnaast een
keuze die in één regel staat — in een stapregel, in de toelichting, in de titel,
en ook in de `- Keuze:`-regel zelf. Dat is een migratiepad, geen tweede formaat:
`jarvis lint` keurt een keuze in de lopende tekst af en noemt de hersteltekst.

Eén functie telt de alternatieven, `leesAlternatieven`, en de lint gebruikt
letterlijk diezelfde functie. Zolang zij haar eigen telling had, ontdubbelde de
lint op de ruwe labeltekst en de engine op `sleutelVan`; `- Optie A:` naast
`- Optie-A:` ging daardoor groen door de poort terwijl de kaart de eigenaar
alleen "Later" gaf. Een onbruikbaar alternatief maakt de hele keuze onbruikbaar
in plaats van stil weg te vallen: twee labels met dezelfde sleutel zijn niet aan
een antwoord toe te wijzen, en een optietekst die alleen opmaak is (`**`, `-`)
draagt geen gevolg. Het punt wordt dan een halve keuze en de poort keurt het af —
ook zonder `- Keuze:`-regel, want wie alternatieven aandraagt draagt er twee
bruikbare aan.

Het vangnet leest ook cijfers als merk (`(1)` naast `(a)`). Wat het net níét kan
uitpakken, dwingt de poort af met `eigenaarslijst_keuze_bijna`. Die regel is
bewust lósser dan de lezer en niet strenger: één ronde deed zij dezelfde strenge
scheidingstoets, en toen glipte elke keuze waarvan het merk achteraan stond
("betaalt (a) of pas na de levering (b)"), waar een bijzin tussen "of" en het
volgende merk stond, waar "ofwel" stond, waar een derde merk tussenkwam, of die
helemaal geen merken had ("kies of je nu betaalt of pas na de levering"), door
beide netten heen. De toets is nu: er staat een keuzewoord, én er is een
aanwijzing dat er meer dan één mogelijkheid is — twee merken, of twee keer "of".

Dat keuzewoord is dragend. Zonder die eis gold "twee merken met een of ertussen"
als keuze, en dan keurt de poort `- Lees punt (a) of (b) van het contract door`
af terwijl dat een verwijzing is. Een tekst met twee merken en géén keuzewoord is
vaker een verwijzing dan een vraag en valt daarom buiten de regel. Criterium 2
laat precies twee wegen open — de kaart herkent de keuze, of de poort dwingt het
formaat af — en beide grenzen zijn met echte teksten gemeten.

**Wat de kaart als tekst toont, leest de poort.** Die regel is omgekeerd ten
opzichte van drie eerdere rondes, en de omkering is de reden dat er nu geen volgend
label overblijft. De poort las een vaste lijst labels, de kaart een andere, en dus
vond elke ronde een label dat er niet in stond: ronde 7 een keuze in `- Extern:`,
ronde 8 een keuze in `- Voorwaarde:` en in de vette tussenkop. De motivering om
`- Let op:` en `- Controle:` uit te sluiten — "een waarschuwing hoort geen kaart met
knoppen te worden" — is meetbaar onjuist: de kaart krijgt haar knoppen uit het
soort, niet uit die lijst, dus uitsluiten verhinderde geen knoppen, alleen dat de
poort de tegenspraak meldde. De omkering kost niets: dezelfde meting over de
historie geeft vijf keuzebevindingen met de oude lijst en vijf met deze, nul nieuwe
treffers. (Hier stond eerder het getal acht; dat was inclusief een code die
inmiddels op nul staat, en onafhankelijke QA kon het niet reproduceren.)

Omgekeerd geldt ook: **wat de kaart niet toont, beoordeelt de poort niet.** Een
afgevinkt punt is gedaan, een akkoordvraag loopt over de akkoordkaart, en het
dossier van een afgeronde taak levert geen kaarten; alle drie keurde de poort af —
de eerste twee met een hersteltekst die voor een akkoord niet eens klopte, de derde
om een kaart die niet bestaat.

Naast `eigenaarslijst_wacht_en_keuze` en `eigenaarslijst_akkoord_en_keuze` staat een
derde tegenspraakregel: `eigenaarslijst_handeling_en_keuze`. Een `- Extern:`- of
`- Bevestig:`-regel naast twee alternatieven laat de keuze winnen, en daarmee
verdwijnt de knop waarmee de eigenaar de handeling zou melden.

Optieregels onder een akkoordcontext zonder `- Keuze:`-regel geven
`eigenaarslijst_akkoord_en_keuze`. De kaart blijft een akkoord — dat is de
gedocumenteerde keuze — maar het dossier zegt dan twee dingen tegelijk, net als
bij een wachtregel, en de poort zegt dat in plaats van het stil op te lossen.

Wat niet in een knop terechtkomt, staat nu wél op de kaart: de staart van een
vraag die langer is dan de titel, en de tekst van **elke** labelregel die geen eigen
veld heeft (`Stap N`, `Advies`, `Waarom` en `Controle` hebben dat wel). Dat
verdween volledig voor elk label dat het soort bepaalt of dat geen alternatief is:
een punt met `- Extern: log in op het platform en zet de sleutel onder deze naam`
kwam aan als een kop met één knop "Gedaan" en zonder de instructie, bij een
wachtregel zag de eigenaar niet waarop gewacht werd, en `- Termijn: vóór 1 oktober,
anders vervalt de licentie` kwam nergens aan. Een alternatief dat al knop is, komt
niet nóg eens als tekst terug, en de vette kop staat één keer op de kaart in plaats
van twee keer. De eigenaar zag daar eerst een vraag
zonder antwoord én zonder de tekst die het dossier voor hem had opgeschreven. Een
lege `- Keuze:`-regel geeft geen lege kaarttitel meer maar valt terug op de titel
van het punt.

De betekenisdragende labels gelden alleen op de eigenaarslijst. In de
`## Opties`-sectie van een kennisrecord zijn `Keuze`, `Extern`, `Bevestig` en
`Wacht` gewone woorden, en `- Doorgaan: nu bouwen` naast `- Wacht: nog een maand
afwachten` is daar een volwaardige keuze; één ronde lang verdwenen bij een
conflictrecord beide alternatieven. `later` en `gedaan` blijven overal beschermd:
die hebben in de interface een vaste betekenis, waar het label ook staat.

De knoppen volgen strikt uit het soort. Een eerdere opzet liet elke
`- Label: tekst`-regel vóórgaan op de knoppen van het soort; daardoor verloor
een externe handeling zijn "Gedaan" zodra er een regel `- Let op: …` bij stond,
en kon een punt met een regel `- Gedaan: …` juist "Gedaan" tonen terwijl het
soort dat niet toestaat. Alleen bij een keuze zíjn de alternatieven de knoppen.

Een keuze vraagt een keuzewoord én alternatieven die met "of" gescheiden zijn.
Twee merken alleen volstaan niet: "doe (a) het ene en (b) het andere" is één
handeling met twee delen, en "artikel 5 lid (a) en lid (b)" is een verwijzing.

De terugval is `bevestiging` en niet `uitstel`, en dat wijkt bewust af van het
uitvoeringsplan. Dat plan zet `uitstel` als laatste stap, en dat klopt zodra elk
dossierpunt expliciet zegt wat het is. Zolang dat niet zo is, betekent die
terugval iets anders: elk bestaand eigenaarspunt zonder `Extern`- of
`Bevestig`-regel verliest zijn enige knop en is voor de eigenaar niet meer af te
sluiten. Onafhankelijke QA heeft dat twee rondes achter elkaar als verlies van
werkend gedrag gemeten. `uitstel` heeft drie ingangen en geen andere: een
expliciete `- Wacht:`-regel, een `- Keuze:`-regel die haar twee bruikbare
alternatieven niet aanreikt, en een punt dat wél optieregels draagt maar er te
weinig bruikbare — ook zonder `- Keuze:`-regel. Zodra de dossiers zijn nagelopen
kan de terugval alsnog verschuiven, en is dat een keuze met een lege verzameling
gevallen in plaats van een stille breuk.

Een bronregel kan de vaste knoppen niet meer overnemen. `later` en `gedaan`
hebben een vaste betekenis in de interface; een kennisrecord met een regel
`- Later: …` gaf de enige altijd-aanwezige knop een eigen gevolg, en `- Gedaan:
…` zette een handelingsknop op een risicokaart. En één alternatief vervangt de
vaste knoppen niet: een record met één optieregel verloor daardoor zijn eigen
knoppen.

Wat hier nog niet in zit is de weg terug van gesprek naar actie (§3 van het
uitvoeringsplan): een bericht met een `item_id` sluit de bijbehorende kaart nog
niet. Een bestaand dossierpunt zonder `Extern`- of `Bevestig`-regel houdt intussen
zijn knoppen: de terugval is `bevestiging`, niet `uitstel`. Dat geldt niet voor de
drie ingangen van `uitstel` hierboven — een `- Wacht:`-regel, een `- Keuze:`-regel
zonder twee bruikbare alternatieven, en een punt dat wél alternatieven aankondigt
maar er te weinig bruikbare draagt. Daar is "Gedaan" juist de fout die deze taak
wegneemt. De dossierpunten worden in een eigen ronde nagelopen (stap 5 van
het plan), en de pin volgt pas daarna.

Wat hier ook nog niet in zit: het veld `interactie` wordt serverside bepaald maar
nergens gerenderd. De interface bouwt haar knoppen uitsluitend uit `opties`, dus
een `uitstel`-kaart staat met één knop "Later" tussen de acties zonder te zeggen
waarom er niets te doen valt — voor de eigenaar niet te onderscheiden van een
kaart waarvan de knoppen zijn weggevallen. De invariant is daarmee volledig
serverside getoetst en er is geen weergavecontrole die hem zou opmerken als hij
breekt. Gemeten door onafhankelijke QA, ronde 5.

De poort zag de eerste ongecommitte wijziging niet. `git status --porcelain` zet
de toestand in de eerste twee tekens, en een van die twee kan een spatie zijn:
`" M pad"`. De git-aanroep trimde haar uitvoer, waardoor die spatie van de eerste
regel verdween en het afsnijden van de statuskolom daarna drie tekens van het
pád afhaalde — `" M tasks/x"` werd `"sks/x"`. De eerste ongecommitte wijziging
viel daardoor buiten elke poortcontrole en `jarvis lint` gaf tijdens het
schrijven een vals groen; na committen vuurde alles weer, dus CI en de poort
vóór een pull request waren niet geraakt. De porcelain-uitvoer wordt nu ongetrimd
gelezen en per veld ontleed: de aanhalingstekens gaan er eerst af en dan de octale
escapes die `core.quotepath` erin zet, zodat een pad met een niet-ASCII-teken
bestaat en wordt gelint; en een `" -> "` binnen die aanhalingstekens is deel van de
naam, geen herbenoeming. Gevonden door onafhankelijke QA, rondes 7 en 8.

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

## Volgende stap

De eerste consumer overstappen op de afhankelijkheid.
