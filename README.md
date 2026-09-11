# jarvis-engine

De engine van Jarvis: een provider-onafhankelijke werkomgeving voor AI-agents
met een deterministische governance-poort. Deze repository bevat gereedschap en
regels, geen projectkennis.

## Gebruik in een project

```
npm install --save-dev github:lodewijkmaassen/jarvis-engine#<commit>
npx jarvis <opdracht>
```

Een project levert `jarvis.config.yml`, `knowledge/`, `tasks/`, een
projectkaart en een `CURRENT_STATE`; verder niets. Zie `project/PROJECT.md`.

## Ontwikkelen aan de engine

```
npm ci --ignore-scripts
npm run typecheck
npm test
npm run poort
```

De poort (`.github/workflows/jarvis-lint.yml`) is byte-gelijk aan
`jarvis/canonical/jarvis-lint.yml`; wijzig de canonieke bron, nooit de kopie.
