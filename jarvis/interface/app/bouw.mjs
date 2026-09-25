// Bouwt de eigen app: kopieert ../jarvis.html als index.html naar de doelmap
// (standaard deze map) samen met manifest, service worker en iconen.
//
//   node bouw.mjs [doelmap] [--url <supabase-url> --sleutel <publishable key>]
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
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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

copyFileSync(path.join(hier, "..", "jarvis.html"), path.join(doel, "index.html"));
for (const naam of ["manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png", "vercel.json"]) {
  if (path.resolve(hier) !== doel) copyFileSync(path.join(hier, naam), path.join(doel, naam));
}
console.log(`app gebouwd in ${doel}`);
