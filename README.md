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

`npm ci` koppelt `node_modules/jarvis-engine` aan deze repository zelf
(`file:.`), zodat de canonieke workflow hier dezelfde opdracht draait als bij
elke consumer: `node node_modules/jarvis-engine/bin/jarvis.mjs poort`.

De poort (`.github/workflows/jarvis-lint.yml`) is byte-gelijk aan
`jarvis/canonical/jarvis-lint.yml`; wijzig de canonieke bron, nooit de kopie.
