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

// In een cloud-sessie loopt al het uitgaande verkeer via een HTTP-proxy uit
// HTTPS_PROXY; curl volgt die vanzelf, Node's fetch niet. Met deze vlag doet
// Node (24.5+) dat wel; oudere versies negeren haar en cli.ts vangt het op.
const kind = spawn(process.execPath, ["--disable-warning=UNDICI-EHPA", tsx, cli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? "1" },
});
kind.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
