// Bouwt de eigen app: kopieert ../jarvis.html als index.html naar de doelmap
// (standaard deze map) samen met manifest, service worker en iconen.
// config.js (publieke Supabase-URL en publishable key) staat niet in de
// repository; hij hoort al in de doelmap te staan.
//
//   node bouw.mjs [doelmap]
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hier = path.dirname(fileURLToPath(import.meta.url));
const doel = path.resolve(process.argv[2] ?? hier);
mkdirSync(doel, { recursive: true });
copyFileSync(path.join(hier, "..", "jarvis.html"), path.join(doel, "index.html"));
for (const naam of ["manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png", "vercel.json"]) {
  if (path.resolve(hier) !== doel) copyFileSync(path.join(hier, naam), path.join(doel, naam));
}
if (!existsSync(path.join(doel, "config.js"))) console.warn(`let op: ${path.join(doel, "config.js")} ontbreekt; de app valt dan terug op de artifact-database.`);
console.log(`app gebouwd in ${doel}`);
