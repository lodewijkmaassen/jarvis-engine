// Schrijft de allowlist van SQL-statements voor de Edge Function jarvis-db.
//
// De functie voert uitsluitend statements uit die hier letterlijk in staan;
// de engine roept ze met dezelfde tekst aan (db.ts). Wijzigt db.ts, dan
// draait men dit script opnieuw en toont de test het verschil.
//
//   npx tsx jarvis/scripts/toegestane-sql.ts
import { writeFileSync } from "node:fs";
import path from "node:path";
import { toegestaneSql } from "../src/db";

const doel = path.join(process.cwd(), "jarvis/edge/jarvis-db/toegestaan.json");
writeFileSync(doel, `${JSON.stringify(toegestaneSql(), null, 2)}\n`);
console.log(`${toegestaneSql().length} statements geschreven naar ${doel}`);
