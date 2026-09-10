# Ops-checklist

**Wie:** de Architect, verplicht, bij elke taak met risicoklasse B of C, en bij
elke taak die een pad raakt dat in `jarvis.config.yml` als statuspad staat.
**Wanneer:** tijdens de analyse, vóór er één regel code wordt geschreven.
**Waar:** ingevuld overgenomen in sectie 9 van `tasks/<taak-id>/analysis.md`.

**Bewijsplicht.** Elk antwoord is een feitelijke uitspraak, niet een intentie.
Bij "ja" hoort altijd een vindplaats (pad, commando, of waarneembaar effect) of
een expliciet "onbekend". "Onbekend" is een geldig antwoord dat uitzoekwerk
oplevert; een leeg antwoord of "waarschijnlijk niet" is dat niet. Een checklist
met één leeg antwoord is niet ingevuld en het plan wordt teruggestuurd.

Deze checklist is bewust generiek geformuleerd: hij bevat geen namen van
leveranciers, diensten of onderdelen van dit specifieke project. Voor de
projectinvulling — welke planner er draait, welke koppelvlakken bestaan, waar
back-ups staan, welke controles er zijn en wie waarover een melding krijgt — geldt
`docs/OPERATIONS.md` als bron.

---

## 1. Welke operationele onderdelen raakt deze wijziging?

Beantwoord elk punt met ja of nee. Bij ja: wat verandert er precies, en hoe stel je
vóór uitrol vast dat het nog werkt?

| # | Onderdeel | Raakt deze wijziging het? | Zo ja: wat verandert er + hoe geverifieerd |
|---|---|---|---|
| 1.1 | **Periodiek draaiende taken** (planner, terugkerende verwerking, opruimtaken) | ja / nee | |
| 1.2 | **Inkomende meldingen van buiten** (koppelvlakken waar een externe partij naar toe schrijft) | ja / nee | |
| 1.3 | **Uitgaande berichten** naar gebruikers of eindklanten | ja / nee | |
| 1.4 | **Back-up en herstel** (wat er wordt bewaard, hoe vaak, en of het terug te zetten is) | ja / nee | |
| 1.5 | **Gezondheids- en statuscontroles** (wat vertelt ons dat het systeem leeft) | ja / nee | |
| 1.6 | **Externe leveranciers** (een nieuwe, een andere, of ander gebruik van een bestaande) | ja / nee | |
| 1.7 | **Geheimen en omgevingsconfiguratie** (nieuwe waarde nodig, andere naam, andere plek) | ja / nee | |
| 1.8 | **Datamodel of migraties** | ja / nee | |
| 1.9 | **Uitrol- en automatiseringsketen** | ja / nee | |

Regels bij dit blok:
- Is 1.7 "ja", dan is de taak minstens risicoklasse C en gaat de securitychecklist
  altijd mee. Het aanmaken of wijzigen van een geheim is een menselijke handeling.
- Is 1.6 "ja" en betreft het een nieuwe betaalde leverancier, dan is dit
  bevoegdheidsklasse B — **altijd**, ongeacht het bedrag, ook bij een gratis
  instapniveau. Voorbereiden mag; in gebruik nemen niet.
- Is 1.1 of 1.2 "ja", vul dan blok 5 (idempotentie) verplicht in.

## 2. Blast radius

| Vraag | Antwoord |
|---|---|
| 2.1 Wie merkt het als deze wijziging fout gaat? (interne gebruiker / klant / eindklant van de klant / niemand) | |
| 2.2 Hoeveel gebruikers of gegevens raakt het in het slechtste geval? | |
| 2.3 Hoe snel na uitrol wordt dat merkbaar? (direct / bij de eerstvolgende geplande run / pas bij een bepaalde gebeurtenis) | |
| 2.4 Kan het stille schade veroorzaken — verlies of vervuiling van gegevens die pas later opvalt? | |
| 2.5 Wat is het slechtst denkbare scenario, in één zin? | |

Is het antwoord op 2.4 "ja", dan is er vóór uitrol een aantoonbaar veilige kopie
van de betrokken gegevens, en staat in het plan hoe je vaststelt dát die er is.

## 3. Terugweg

| Vraag | Antwoord |
|---|---|
| 3.1 Is er een terugweg? (ja / nee) | |
| 3.2 Wat is de exacte handeling om terug te draaien? | |
| 3.3 Hoe lang duurt terugdraaien, van constatering tot herstelde situatie? | |
| 3.4 Zijn gegevens ook terug te draaien, of alleen de code? | |
| 3.5 Wat blijft er achter na terugdraaien — half verwerkte gegevens, verstuurde berichten, wijzigingen bij een externe partij? | |
| 3.6 Wie kan de terugweg uitvoeren: is dat een handeling binnen het mandaat van een agent, of alleen met menselijke toegang? | |

Is 3.1 "nee", dan is de wijziging automatisch bevoegdheidsklasse B: hij wordt
voorbereid en pas na een expliciete beslissing uitgevoerd. Een onomkeerbare
wijziging zonder beslissing is een blokkerende bevinding.

## 4. Detectie — hoe merken we het als het misgaat?

| Vraag | Antwoord |
|---|---|
| 4.1 Welk waarneembaar signaal ontstaat er bij een storing? | |
| 4.2 Waar is dat signaal zichtbaar, en blijft het bewaard? | |
| 4.3 Wie krijgt er een melding, langs welke weg? | |
| 4.4 Binnen hoeveel tijd na het ontstaan is het signaal er? | |
| 4.5 Wat gebeurt er als de storing bij een externe partij ontstaat en onze eigen code geen fout ziet? | |

Harde regel: **elke mislukking in een keten met een externe partij moet zichtbaar
zijn in een duurzame gegevensbron** — een rij met een status en een foutreden —
en niet uitsluitend in een vluchtige logregel. Een storing die alleen bestaat als
uitvoer die niemand bewaart, is niet gedetecteerd.

Is het antwoord op 4.1 "geen signaal", dan hoort er in het plan een stap die er
een maakt, of een expliciete motivatie waarom dat hier niet nodig is.

## 5. Idempotentie en gelijktijdigheid

Verplicht bij 1.1 of 1.2 "ja".

| Vraag | Antwoord |
|---|---|
| 5.1 Wat gebeurt er als dezelfde verwerking twee keer draait? | |
| 5.2 Wat gebeurt er als twee runs elkaar overlappen? | |
| 5.3 Wat gebeurt er als een externe partij dezelfde melding twee keer stuurt? | |
| 5.4 Hoe wordt een poging vastgehouden zodat er niet oneindig opnieuw geprobeerd wordt? | |
| 5.5 Wat is de eindtoestand van iets dat blijvend mislukt, en is die zichtbaar? | |
| 5.6 Blokkeert een fout in één onderdeel de andere onderdelen van dezelfde run? | |

Dubbel uitvoeren mag nooit dubbel effect hebben: geen tweede bericht, geen tweede
regel, geen tweede afschrijving. Kun je dat niet garanderen, dan is dat een
blokkerende bevinding.

## 6. Kosten en limieten

| Vraag | Antwoord |
|---|---|
| 6.1 Verandert het aantal aanroepen naar een betaalde dienst? Met welke factor? | |
| 6.2 Wat zijn de verwachte structurele kosten per maand na deze wijziging? | |
| 6.3 Komt er een nieuwe betaalde dienst bij? | |
| 6.4 Welke limiet van een externe partij komt hiermee in zicht (aantal, tijdslimiet, opslag)? | |
| 6.5 Wat gebeurt er functioneel wanneer die limiet wordt geraakt? | |

Structurele kosten boven €10 per maand, en elke nieuwe betaalde leverancier
ongeacht het bedrag, zijn bevoegdheidsklasse B.

## 7. Uitkomst

Noteer één uitkomst, met motivatie in één alinea:

- **GEEN OPERATIONELE IMPACT** — alle punten in blok 1 zijn "nee"; blok 2 t/m 6
  zijn ingevuld en leveren geen maatregelen op.
- **IMPACT MET MAATREGELEN** — er is impact, en de maatregelen (detectie,
  terugweg, veilige kopie, limietbewaking) staan als genummerde stappen in het
  uitvoeringsplan.
- **BLOKKEREND** — er is geen terugweg, geen detectie, geen garantie tegen dubbel
  effect, of er is een handeling van bevoegdheidsklasse B of C nodig. Ga naar het
  `BLOCKING_DECISION`-formaat in het rolcontract van de Architect.

Elke maatregel die uit deze checklist volgt, is een stap in het uitvoeringsplan of
een acceptatiecriterium. Een maatregel die alleen in deze checklist staat, is niet
ingepland en telt niet.
