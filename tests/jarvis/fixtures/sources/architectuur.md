# Synthetische architectuurnotitie (testdata)

Dit bestand is verzonnen testmateriaal voor het calibratieprototype.
Het beschrijft een fictief systeem "Demo Flow" en bevat geen echte
klantgegevens, telefoonnummers, sleutels of productieconfiguratie.

## Lagen

- Webapplicatie met server-side routes; geen aparte functieruntime.
- Relationele database met rijniveau-autorisatie per huurder.
- Een deterministische state machine bepaalt statusovergangen. Een taalmodel
  bepaalt nooit status, huurder, overname of prijzen.
- Eén centrale uitgaande berichtenlaag met hernieuwde pogingen.

## Waarom deterministisch

Een state machine is te testen, te herhalen en uit te leggen. Een taalmodel
is dat geen van drieën. Daarom staat de logica in code en het taalmodel
alleen in de formulering.
