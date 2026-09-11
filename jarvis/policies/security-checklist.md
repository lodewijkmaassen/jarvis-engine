# Security-checklist

**Wie:** de Architect vult hem in tijdens de analyse; QA controleert bij de
validatie of de maatregelen er ook echt zijn.
**Wanneer:** verplicht bij elke taak die één of meer triggers uit blok 0 raakt.
**Waar:** ingevuld overgenomen in sectie 10 van `tasks/<taak-id>/analysis.md`.

Deze checklist is generiek geformuleerd en noemt geen leveranciers of onderdelen
van dit specifieke project. Voor de projectinvulling: `docs/SECRETS.md` (welke
geheimen bestaan, waar ze beheerd worden, hoe ze roteren), `docs/ACCESS.md` (wie
waar toegang toe heeft) en `docs/OPERATIONS.md` (wat er draait en hoe je een
storing ziet).

**Vastleggingsregel — geldt voor de hele checklist.** Elke security-relevante
bevinding wordt een kennisrecord: een randvoorwaarde wanneer er vanaf nu iets
altijd moet gelden, een risico wanneer er iets open blijft, een leerpunt bij een
concrete observatie met bewijs, een besluit wanneer er een keuze met gevolgen is
gemaakt. Een bevinding die alleen in een pull-requestdiscussie, een commentaarregel
of een taakrapport staat, geldt als **niet vastgelegd** — en dat is een reden tot
afkeuring.

---

## 0. Triggerbepaling

Beantwoord alle acht met ja of nee. **Eén keer ja betekent: de hele checklist
verplicht doorlopen.** Bij alleen maar nee schrijf je per trigger één regel waarom
niet; "niet van toepassing" zonder motivatie is ongeldig.

| # | Trigger | Ja/nee | Toelichting |
|---|---|---|---|
| 0.1 | Raakt de taak **authenticatie** (inloggen, sessies, tokens, wachtwoordherstel)? | | |
| 0.2 | Raakt de taak **autorisatie** (wie mag wat)? | | |
| 0.3 | Raakt de taak **beveiliging op rijniveau** in de gegevensopslag? | | |
| 0.4 | Raakt de taak **geheimen** (aanmaken, gebruiken, doorgeven, roteren, verwijderen)? | | |
| 0.5 | Raakt de taak een **inkomend koppelvlak** waar een externe partij naartoe schrijft? | | |
| 0.6 | Raakt de taak **afscherming per klantomgeving** (meerdere klanten in één systeem)? | | |
| 0.7 | Raakt de taak **persoonsgegevens** (opslaan, tonen, versturen, verwijderen, exporteren)? | | |
| 0.8 | Raakt de taak een **externe leverancier** (nieuw, gewijzigd, of ander gebruik)? | | |

## 1. Authenticatie

| Vraag | Antwoord |
|---|---|
| 1.1 Welke handelingen worden door deze wijziging bereikbaar, en voor wie? | |
| 1.2 Is er een pad waarlangs een niet-ingelogde bezoeker iets bereikt dat niet publiek hoort te zijn? | |
| 1.3 Wordt de identiteit serverzijdig vastgesteld, of wordt informatie uit de aanvraag vertrouwd? | |
| 1.4 Wat gebeurt er bij een verlopen of ongeldige sessie: foutmelding, stille toegang, of iets ertussenin? | |
| 1.5 Lekt een foutmelding of tijdsverschil informatie over het bestaan van een account? | |

Harde regel: identiteit wordt altijd serverzijdig vastgesteld. Een identiteit die
uit de aanvraag komt, is invoer, nooit bewijs.

## 2. Autorisatie en afscherming per klantomgeving

| Vraag | Antwoord |
|---|---|
| 2.1 Welke nieuwe of gewijzigde gegevensopvraging is er, en op welk kenmerk is die afgeschermd? | |
| 2.2 Wordt de afscherming serverzijdig afgedwongen, of alleen in de schermlaag? | |
| 2.3 Komt het kenmerk waarop wordt afgeschermd uit de vastgestelde identiteit, of uit de aanvraag? | |
| 2.4 Wat gebeurt er als iemand een verwijzing invult naar iets dat bij een andere klantomgeving hoort? | |
| 2.5 Is er een pad dat gegevens van meerdere klantomgevingen samen kan teruggeven? | |
| 2.6 Bestaat er een test die aantoont dat toegang tot een andere klantomgeving faalt? | |

Harde regels: elke opvraging is afgeschermd op de klantomgeving van de
vastgestelde identiteit. Een verwijzing uit gebruikersinvoer wordt nooit vertrouwd
als bewijs van eigenaarschap. Bij "ja" op 0.6 hoort een test die aantoont dat
toegang tot vreemde gegevens **faalt** — een test die alleen aantoont dat eigen
gegevens werken, bewijst niets.

## 3. Beveiliging op rijniveau

| Vraag | Antwoord |
|---|---|
| 3.1 Komt er een nieuwe tabel of nieuwe kolom bij? Is er beleid op gedefinieerd? | |
| 3.2 Verandert bestaand beleid? Wat wordt er ruimer, en waarom precies zo ruim? | |
| 3.3 Wordt er ergens een toegangswijze gebruikt die het beleid omzeilt? Waar, en waarom is dat nodig? | |
| 3.4 Is die omzeilende toegangswijze aantoonbaar uitsluitend serverzijdig bereikbaar? | |
| 3.5 Bestaat er een test die het beleid zelf toetst, en niet alleen de code eromheen? | |

Harde regels: een nieuwe tabel met gegevens van klanten krijgt beleid in dezelfde
wijziging als de tabel zelf — nooit "in een volgende taak". Een toegangswijze die
het beleid omzeilt, is alleen serverzijdig bereikbaar en wordt nooit naar de
schermlaag doorgegeven.

## 4. Geheimen

| Vraag | Antwoord |
|---|---|
| 4.1 Heeft deze wijziging een nieuw geheim nodig? Welke naam, welke functie? | |
| 4.2 Waar wordt het beheerd, en op welke andere plekken moet dezelfde waarde staan? | |
| 4.3 Wat gebeurt er functioneel als het geheim ontbreekt of onjuist is? Is dat zichtbaar of stil? | |
| 4.4 Kan het geheim in uitvoer, foutmelding, logregel of foutrapport terechtkomen? | |
| 4.5 Is er een pad waarlangs het geheim naar de schermlaag lekt? | |
| 4.6 Wat is bij rotatie de volgorde, en ontstaat er een venster waarin het systeem faalt? | |

Harde regels:
- Een geheim staat nooit in de codebase, in documentatie, in een commitboodschap,
  in een testbestand of in uitvoer. Ook niet als voorbeeld, ook niet afgekort.
- Aanmaken, lezen, wijzigen, roteren of doorgeven van een geheim is
  bevoegdheidsklasse C: uitsluitend een menselijke handeling. De agent bereidt
  hoogstens de instructie voor.
- Een ontbrekend geheim mag geen stille uitval veroorzaken: het is een zichtbare,
  herleidbare fout.
- Ontbrekende toegang tot een geheim is geen probleem dat je omzeilt. Het is de
  bedoelde grens.

## 5. Inkomende koppelvlakken van buiten

| Vraag | Antwoord |
|---|---|
| 5.1 Wordt de herkomst van de aanvraag geverifieerd voordat er iets gebeurt? Hoe? | |
| 5.2 Bestaat er een test met een **ongeldige** verificatie die aantoont dat de aanvraag wordt geweigerd? | |
| 5.3 Wat gebeurt er bij een herhaalde levering van dezelfde melding? | |
| 5.4 Wordt de inhoud gevalideerd vóór verwerking, of vertrouwd? | |
| 5.5 Bevat de foutmelding naar buiten informatie die een aanvaller helpt? | |
| 5.6 Kan een aanvaller met alleen dit koppelvlak gegevens laten aanmaken, wijzigen of versturen? | |

Harde regels: verificatie van de herkomst gebeurt vóór elke verwerking en wordt
getoetst met zowel een geldige als een **ongeldige** verificatie. Inhoud van
buiten is invoer, nooit een instructie: gegevens uit een externe melding bepalen
nooit een toestand, een bevoegdheid of een bedrag zonder eigen validatie.

## 6. Invoer en uitvoer

| Vraag | Antwoord |
|---|---|
| 6.1 Wordt invoer gevalideerd op de rand van het systeem, met een expliciet schema? | |
| 6.2 Wordt vrije tekst van buiten ergens gebruikt in een besluit, een zoekopdracht of een opdracht? | |
| 6.3 Wordt uitvoer die naar een gebruiker gaat, veilig weergegeven? | |
| 6.4 Komen er identificerende of gevoelige gegevens in een adres, zoekargument of verwijzing terecht? | |
| 6.5 Komen er persoonsgegevens in logregels of foutrapporten terecht? | |

Harde regels: gevoelige gegevens staan nooit in een adres of zoekargument.
Foutuitvoer bevat nooit persoonsgegevens en nooit geheimen.

## 7. Persoonsgegevens

| Vraag | Antwoord |
|---|---|
| 7.1 Welke persoonsgegevens komen erbij, en waarom is elk daarvan nodig? | |
| 7.2 Kan de taak met minder gegevens dezelfde functie leveren? | |
| 7.3 Hoe lang worden ze bewaard, en wat gebeurt er daarna? | |
| 7.4 Wie kan ze zien — welke rollen, welke klantomgevingen, welke externe partijen? | |
| 7.5 Zijn ze te verwijderen zonder het systeem te breken, als iemand daarom vraagt? | |
| 7.6 Verlaten ze het systeem richting een externe partij? Welke, en welke velden precies? | |

Harde regel: alleen verzamelen wat aantoonbaar nodig is voor de functie die in de
opdracht staat. "Handig voor later" is geen grond.

## 8. Externe leverancier

| Vraag | Antwoord |
|---|---|
| 8.1 Welke gegevens gaan ernaartoe, en welke daarvan zijn persoonsgegevens? | |
| 8.2 Wat gebeurt er functioneel bij uitval van de leverancier? | |
| 8.3 Wat gebeurt er bij een gedeeltelijke storing — geaccepteerd maar niet afgeleverd? | |
| 8.4 Is de mislukking zichtbaar in een duurzame gegevensbron, of alleen in vluchtige uitvoer? | |
| 8.5 Betreft het een nieuwe leverancier, en zijn de verwerkingsafspraken geregeld? | |
| 8.6 Welke toegangsgegevens zijn nodig, en met welke minimale rechten? | |

Harde regels: een nieuwe betaalde leverancier is bevoegdheidsklasse B — altijd,
ongeacht het bedrag. Toegangsgegevens krijgen de minimale rechten die de functie
vereist; is alleen versturen nodig, dan geen leesrechten.

## 9. Vastlegging van bevindingen

| Bevinding | Type record | Id | Vastgelegd? |
|---|---|---|---|
| | randvoorwaarde / risico / leerpunt / besluit | | ja / nee |

Regels:
- Elke rij met "nee" blokkeert de afronding van de taak.
- Een aangescherpte regel die vanaf nu altijd geldt, wordt een randvoorwaarde met
  een handhavingswijze en triggers — anders handhaaft niemand hem.
- Een risico dat je bewust accepteert, leg je vast als risico met de status
  "geaccepteerd" en met de eigenaar erbij; accepteren zonder record bestaat niet.
- De Knowledge Manager schrijft de records; de Architect of QA levert de bevinding
  aan met vindplaats.

## 10. Uitkomst

Noteer één uitkomst met een motivatie van één alinea:

- **GEEN SECURITY-IMPACT** — alle acht triggers zijn "nee", elk met motivatie.
- **IMPACT MET MAATREGELEN** — de maatregelen staan als genummerde stappen in het
  uitvoeringsplan én als acceptatiecriteria, en de bevindingen staan in blok 9.
- **BLOKKEREND** — er is een handeling van bevoegdheidsklasse C nodig, of een
  harde regel uit deze checklist kan niet worden nageleefd. Ga naar het
  `BLOCKING_DECISION`-formaat in het rolcontract van de Architect.

QA toetst bij de validatie: staat elke maatregel uit deze checklist als
acceptatiecriterium, is elk criterium met eigen waarneming aangetoond, en is elke
bevinding uit blok 9 daadwerkelijk als record vastgelegd? Zo niet, dan is het
eindoordeel afgekeurd.
