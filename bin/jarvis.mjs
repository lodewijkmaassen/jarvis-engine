#!/usr/bin/env node
// De opdrachtregel van de engine, ook wanneer hij als afhankelijkheid in
// node_modules staat: `npx jarvis <opdracht>`.
//
// Geen bouwstap. Consumers installeren met `npm ci --ignore-scripts` (zie de
// canonieke workflow), dus er is niets dat TypeScript vooraf zou kunnen
// omzetten. tsx wordt hier geregistreerd en laadt de bron rechtstreeks.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";

register();
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "jarvis", "src", "cli.ts");
await import(pathToFileURL(cli).href);
