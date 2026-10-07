// Bouwt de eigen app: kopieert ../jarvis.html als index.html naar de doelmap
// (standaard deze map) samen met manifest, service worker en iconen.
//
//   node bouw.mjs [doelmap] [--url <supabase-url> --sleutel <publishable key>]
//                            [--merk <commit>]
//
// `--merk` schrijft het bouwmerk in de pagina: een `<meta name="jarvis-bouwmerk">`
// met de commit waaruit is gebouwd, die de pagina naast `v${versie}` toont en
// die `jarvis uitrol` na afloop uit de uitgerolde pagina terugleest. Zonder dat
// merk is een uitrol niet na te meten — dat is op 2026-10-02 misgegaan: de
// uitrol verving de bestanden niet, alle controle stopte bij de repositorygrens,
// en "klaar" was een aanname. Het merk is geen geheim: het is de commit die ook
// in de repository staat.
//
// Zonder `config.js` in de doelmap vindt de pagina de database niet en toont
// ze "geen gegevens". Dat is één keer in productie gebeurd: de bouw meldde het
// met een waarschuwing en eindigde met 0, de uitrol ging door, en de fout werd
// pas zichtbaar toen de eigenaar de pagina opende. Daarom faalt de bouw nu:
// een uitrol zonder bron is geen uitrol.
//
// De twee waarden zijn publieke identifiers — ze staan in elke browser die de
// interface opent, en de grens ligt bij RLS, niet bij de sleutel. Ze komen van
// de aanroeper en niet uit een bestand hier: de engine kent geen projecten.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hier = path.dirname(fileURLToPath(import.meta.url));

/** De losse argumenten en de vlaggen uit elkaar, zonder afhankelijkheden. */
function leesArgumenten(argv) {
  const losse = [];
  const vlaggen = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const naam = a.slice(2);
      const volgende = argv[i + 1];
      if (volgende === undefined || volgende.startsWith("--")) {
        console.error(`bouw: --${naam} verwacht een waarde.`);
        process.exit(2);
      }
      vlaggen.set(naam, volgende);
      i += 1;
    } else {
      losse.push(a);
    }
  }
  return { losse, vlaggen };
}

const { losse, vlaggen } = leesArgumenten(process.argv.slice(2));
const doel = path.resolve(losse[0] ?? hier);
mkdirSync(doel, { recursive: true });

const url = vlaggen.get("url");
const sleutel = vlaggen.get("sleutel");
const merk = vlaggen.get("merk");
if (merk !== undefined && !/^[0-9a-f]{7,40}$/.test(merk)) {
  console.error(`bouw: --merk verwacht een commit-sha (7 tot 40 hexadecimale tekens), kreeg ${JSON.stringify(merk)}.`);
  process.exit(2);
}
// Een GitHub-secret die niet bestaat of verkeerd heet, rendert in `env:` als
// de lege string en niet als een afwezige vlag. Zonder deze controle schrijft
// de bouw een `config.js` met lege waarden, slaagt met exitcode 0, en toont
// productie "geen gegevens" terwijl de bouwmerkcontrole groen meldt — precies
// de stille faalwijze die het bouwmerk moest opheffen. Een lege waarde is
// daarom een fout en niet een afwezige vlag.
for (const [naam, waarde] of [
  ["url", url],
  ["sleutel", sleutel],
]) {
  if (waarde !== undefined && waarde.trim() === "") {
    console.error(
      `bouw: --${naam} is leeg. Een secret die niet bestaat of verkeerd heet, komt als de lege\n` +
        `      string binnen; een pagina met een lege config.js vindt de database niet en toont\n` +
        `      "geen gegevens". Er is niets gebouwd.`,
    );
    process.exit(2);
  }
}

if ((url === undefined) !== (sleutel === undefined)) {
  console.error("bouw: geef --url en --sleutel samen, of geen van beide.");
  process.exit(2);
}

const configPad = path.join(doel, "config.js");
if (url !== undefined && sleutel !== undefined) {
  // JSON.stringify ontsnapt de waarden; een aanhalingsteken in een sleutel
  // mag geen geldige JavaScript van een kapot bestand maken.
  writeFileSync(
    configPad,
    `// Gegenereerd door bouw.mjs. Publieke identifiers; RLS bewaakt de toegang.\n` +
      `window.JARVIS_SUPABASE = { url: ${JSON.stringify(url)}, key: ${JSON.stringify(sleutel)} };\n`,
    "utf8",
  );
  console.log(`config.js geschreven in ${doel}`);
} else if (!existsSync(configPad)) {
  console.error(
    `bouw: ${configPad} ontbreekt, en zonder dat bestand toont de pagina "geen gegevens".\n` +
      `      Geef de twee publieke identifiers mee:\n` +
      `        node bouw.mjs ${losse[0] ?? "."} --url https://<ref>.supabase.co --sleutel sb_publishable_…\n` +
      `      of zet zelf een config.js in de doelmap. Er is niets gebouwd.`,
  );
  process.exit(1);
}

// De pagina wordt gelezen en geschreven in plaats van gekopieerd, omdat het
// bouwmerk erin hoort en niet ernaast. Een los `bouwmerk.json` zou de vraag
// beantwoorden "is er een nieuw bestand uitgerold" en niet de vraag die telt:
// "is de pagina die de eigenaar opent de pagina die wij bouwden".
const bron = readFileSync(path.join(hier, "..", "jarvis.html"), "utf8");
const pagina =
  merk === undefined
    ? bron
    : bron.replace("</head>", `<meta name="jarvis-bouwmerk" content="${merk}">\n</head>`);
if (merk !== undefined && pagina === bron) {
  console.error("bouw: de pagina heeft geen </head> om het bouwmerk in te zetten. Er is niets gebouwd.");
  process.exit(1);
}
writeFileSync(path.join(doel, "index.html"), pagina, "utf8");
for (const naam of ["manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png", "vercel.json"]) {
  if (path.resolve(hier) !== doel) copyFileSync(path.join(hier, naam), path.join(doel, naam));
}
console.log(`app gebouwd in ${doel}`);
if (merk === undefined) {
  // Een waarschuwing en geen fout: de bouw zelf is in orde en wie hem met de
  // hand draait heeft geen commit. Maar een uitrol zonder merk is achteraf
  // niet van een mislukte uitrol te onderscheiden, dus zegt de bouw dat hier
  // en eist de uitrolworkflow het merk wel.
  console.warn("bouw: geen --merk meegegeven; `jarvis uitrol` kan deze uitrol niet nameten.");
} else {
  console.log(`bouwmerk ${merk} in index.html`);
}
