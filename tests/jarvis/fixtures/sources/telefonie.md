# Synthetische telefonienotitie (testdata)

Verzonnen materiaal. Geen echte nummers, geen echte routering.

## Uitgangspunt

De klant behoudt altijd zijn eigen publieke telefoonnummer. Een
platformnummer vervangt dat nooit, ook niet als noodoplossing. Doorschakeling
loopt via de bestaande provider van de klant.

## Twee scenario's

1. Doorverbinden: de inkomende oproep wordt doorgezet naar het eigen toestel.
2. Alleen doorschakelen: de webhook meldt kort iets en beëindigt de oproep,
   waarna de opvolging via chat verloopt.

## Lessen uit de fictieve testronde

Een wijziging in de telefonieketen geldt pas als werkend na een echte
oproep. Unittests dekken de webhook, niet de keten erachter.
