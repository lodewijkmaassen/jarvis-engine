# T-20261118-review-volledig — de onafhankelijke review leest de hele wijziging

## Opdracht van de eigenaar (2026-11-18)

"Herstel de reviewbeperking structureel, maar houd de uitvoering strikt beperkt.
Maximaal één engine-PR voor de reviewcorrectie en één pin-PR voor de uitrol. Geen
nieuwe architectuur, functionaliteit of aanvullende verbeteringen. Grote diffs
moeten volledig worden beoordeeld, zonder stilzwijgend afkappen.
Niet-tekstbestanden moeten expliciet worden herkend en correct worden behandeld.
Behoud de onafhankelijke review en bestaande veiligheidsgrenzen. Test de wijziging
volledig vóór de merge. Voorkom onnodige AI-aanroepen en uitvoeringsrondes. Zorg
dat een volgende grote PR automatisch correct wordt beoordeeld zonder opnieuw een
aanpassing aan de reviewvoorziening nodig te hebben."

## Aanleiding

De reviewer kreeg de diff met twee afkapmaten: `patchPerBestand` (12.000 tekens)
en `diffTekens` (60.000). Een grotere patch ging afgekapt mee, een bestand dat
niet meer in het budget paste werd weggelaten. Gemeten op jarvis-engine#151: een
patch van 22.803 tekens, waarvan de reviewer 12.000 zag, met twee punten van
ernst hoog over precies de knipplek — bevindingen over regels die hij nooit kreeg.

Daarnaast blokkeerde elk bestand zonder tekstdiff de hele pull request: de
volledigheidswacht las "geen patch" als "ongelezen code", ook bij een
schermafdruk. Een oplevering met beeldbewijs erin kon daardoor nooit een GO
halen.

## Acceptatiecriteria

1. Een patch boven de grens wordt in genummerde delen gelezen; de delen achter
   elkaar zijn weer teken voor teken de patch van GitHub. Geen enkele vraag aan
   de reviewer bevat nog afgekapte of weggelaten code.
2. Een diff boven het budget van één vraag wordt over meer leesronden gelezen,
   binnen dezelfde review; de oordelen worden samengevoegd en één correctie in
   een ronde maakt het geheel een correctie.
3. Boven `REVIEW_LIMIETEN.ronden` volgt een NO-GO met die reden: de kosten
   blijven begrensd, en wat te groot is wordt gemeld, niet stil weggelaten.
4. Een bestand zonder tekstdiff (GitHub meldt nul gewijzigde regels) gaat als
   lijst met namen mee, binnen het datablok, met de mededeling dat zijn inhoud
   niet gelezen en dus niet beoordeeld is.
5. Tekst die GitHub niet gaf terwijl hij wél gewijzigde regels meldt, blijft een
   reden voor NO-GO (B3 op jarvis-engine#88).
6. Die wacht staat op beide wegen: de reviewbaan in CI en de losse
   `jarvis review`, die eerder stil afkapte.
7. Een wijziging die in één ronde past, kost één AI-aanroep — net als voorheen.

## Bewijs

- 1488 tests groen (`npx vitest run`), typecheck schoon, `jarvis poort` zonder
  fouten en zonder waarschuwingen.
- Nieuwe tests pinnen: het knippen verliest geen teken (ook niet bij een regel
  die zelf groter is dan de maat), de delen worden genummerd, de ronden worden
  samengevoegd, een bestand zonder tekst blokkeert niet meer en ontbrekende
  tekst nog steeds wel.
- Proef op de echte bestandslijst van jarvis-engine#151, zoals GitHub die aan de
  reviewer geeft: 1 leesronde, `jarvis/interface/v3.html` in deel 1 van 2
  (11.257 tekens) en deel 2 van 2 (11.547 tekens), de vier schermafdrukken als
  bestanden zonder tekstdiff, niets afgekapt, en de delen samengevoegd gelijk aan
  de patch van GitHub.
