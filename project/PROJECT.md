# Jarvis-engine — projectkaart

Eén pagina. Wie dit leest weet daarna wat dit is en waar de rest staat.

## Wat het is

De engine van Jarvis: een provider-onafhankelijke werkomgeving voor
AI-agents met een deterministische governance-poort. Rolcontracten,
checklists, de opdrachtregel (`jarvis`), de canonieke CI-workflow en de
interfacepagina. Geen projectkennis: alles wat over een concreet product gaat
staat in de repository van dat product, in `jarvis.config.yml`, `knowledge/`
en `tasks/` aldaar.

## Voor wie

Projecten van de eigenaar die onder Jarvis werken. Elk project neemt de engine
op als afhankelijkheid op een vastgepinde commit.

## Waar de rest staat

- `jarvis/src/` — de engine; `jarvis/roles/` — de rolcontracten (bron);
  `jarvis/policies/` — de checklists; `jarvis/canonical/` — de goedgekeurde
  CI-workflow; `jarvis/interface/` — de pagina.
- `tests/jarvis/` — de tests, inclusief de portabiliteitstest die bewaakt dat
  hier geen projectkennis in sluipt.
- `knowledge/` en `tasks/` — kennis en taken van de engine zelf.
