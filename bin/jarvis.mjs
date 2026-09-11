#!/usr/bin/env node
// De opdrachtregel van de engine, ook wanneer hij als afhankelijkheid in
// node_modules staat: `npx jarvis <opdracht>`.
//
// Geen bouwstap. Consumers installeren met `npm ci --ignore-scripts` (zie de
// canonieke workflow), dus er is niets dat TypeScript vooraf zou kunnen
// omzetten. De bron wordt rechtstreeks gedraaid via de tsx-opdrachtregel in
// een kindproces. Niet via een loader-hook in dit proces: Node's eigen
// type-stripping (standaard aan sinds 22.18) weigert .ts-bestanden onder
// node_modules vóór een hook ze te zien krijgt; de tsx-opdrachtregel zet dat
// gedrag uit.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hier = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(hier, "..", "jarvis", "src", "cli.ts");
const tsx = createRequire(import.meta.url).resolve("tsx/cli");

const kind = spawn(process.execPath, [tsx, cli, ...process.argv.slice(2)], { stdio: "inherit" });
kind.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
