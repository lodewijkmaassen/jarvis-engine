# Jarvis AI Core vernieuwd (18 november 2026)

De opdracht: het Command Center laat in één oogopslag zien wat Jarvis uitvoert,
wat eruit kwam en wat er nu volgt, naar twee referentieafbeeldingen (bureaublad
en telefoon). Bestaande architectuur, componenten en gegevensbronnen blijven.

## Waar elk onderdeel vandaan komt

| Onderdeel | Bron | Hoe |
|---|---|---|
| Actieve uitvoering | `jarvis.doelen` | doelen in bezig, review of samengevoegd |
| In wachtrij | `jarvis.doelen` | doelen met status open |
| Vastgelopen | `jarvis.doelen` | doelen met status vast |
| Vandaag afgerond | `jarvis.doelen` | status klaar en bijgewerkt op de dag van vandaag |
| Huidige activiteit: welk doel | `jarvis.doelen` | het actieve doel dat het laatst is bijgewerkt |
| Huidige activiteit: sinds | `jarvis.doelen` | `bijgewerkt` — het moment van de laatste statusovergang |
| Huidige activiteit: tijdlijn | `jarvis.activiteit` | de laatste zes regels van dat doel, oudste bovenaan |
| Laatste activiteit: ... geleden | `jarvis.activiteit` | de nieuwste regel in het logboek |
| Volgende stap | `jarvis.doelen` | de stap die bij de status hoort; bij review de pull request erbij |
| Laatste resultaat | `jarvis.doelen` | het laatst afgeronde doel, met acceptatie-URL of pull request |
| Jouw aandacht | `jarvis.doelen` + `jarvis.berichten`/`jarvis.autorisaties` | vastgelopen doelen plus openstaande akkoorden |
| Recente activiteit | `jarvis.activiteit` | de negen nieuwste regels |
| Projecten, Taken, Nieuw doel | ongewijzigd | zoals zij waren |

Het logboek `jarvis.activiteit` is dezelfde tabel die de V2-pagina al leest, met
een bestaand leesrecht voor de eigenaar. Er komt geen tabel, migratie, functie of
schrijfpad bij, en geen tweede klok: het logboek wordt gelezen in dezelfde ronde
als de doelen, begrensd op zestig regels.

## Wat de pagina niet toont

Voortgangspercentages, werkende agents en verwachte eindtijden staan nergens in
de gegevens; die worden dus niet getoond. Ontbreekt er iets, dan staat er een
neutrale stand: "Niets in uitvoering en niets in de wachtrij", "Geen volgende
stap: er loopt niets", "Nog niets opgeleverd". Is het logboek niet te lezen, dan
zegt de pagina dat, in plaats van een lege lijst te tonen.

## De opnamen

`desktop-*.jpg` en `mobiel-*.jpg` komen uit een lokale kijkkopie van `/v3/` met
regels uit de echte database.

- `*-uitvoering.jpg`: de werkelijke stand van 17 november 21:47 UTC, toen doel
  D-20261117-194904457 in review stond op jarvis-engine#150.
- `*-rust.jpg`: de werkelijke stand van 18 november 12:20 UTC — niets in
  uitvoering, niets in de wachtrij.
