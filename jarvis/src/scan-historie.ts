// Scant de VOLLEDIGE git-historie van een repository met de sanitizer: elke
// blob in elke commit, niet alleen de werkboom. Bedoeld voor het moment
// waarop een lokale repository voor het eerst naar een remote gaat: wat ooit
// gecommit is, gaat mee, ook als het inmiddels verwijderd is.
//
// Gebruik: npx tsx jarvis/src/scan-historie.ts <pad-naar-repository>
// Exitcode 0 bij niets gevonden, 1 bij bevindingen, 2 bij gebruiksfout.
// Toont per bevinding het gemaskeerde fragment; nooit de volledige waarde.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { LEGE_ALLOWLIST, scanTekst } from "./sanitize";

const uitvoeren = promisify(execFile);

const TEKST = /\.(md|json|ya?ml|txt|html|css|[cm]?[jt]sx?|sql|env|toml|ini|conf|sh|ps1|csv|svg|xml)$/i;
const OVERSLAAN = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.next\/|node_modules\/)/;

async function main(): Promise<number> {
  const wortel = process.argv[2];
  if (!wortel) {
    console.error("gebruik: scan-historie <pad-naar-repository>");
    return 2;
  }
  const git = async (args: readonly string[], maxBuffer = 64 * 1024 * 1024) =>
    (await uitvoeren("git", [...args], { cwd: path.resolve(wortel), maxBuffer })).stdout;

  const objecten = (await git(["rev-list", "--all", "--objects"]))
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r.includes(" "))
    .map((r) => ({ hash: r.slice(0, r.indexOf(" ")), pad: r.slice(r.indexOf(" ") + 1) }))
    .filter((o) => TEKST.test(o.pad) && !OVERSLAAN.test(o.pad));

  let gescand = 0;
  let totaal = 0;
  const perBestand = new Map<string, number>();
  for (const o of objecten) {
    let soort = "";
    try {
      soort = (await git(["cat-file", "-t", o.hash])).trim();
    } catch {
      continue;
    }
    if (soort !== "blob") continue;
    const inhoud = await git(["cat-file", "-p", o.hash]);
    gescand += 1;
    const bevindingen = scanTekst(inhoud, LEGE_ALLOWLIST, o.pad);
    for (const b of bevindingen) {
      totaal += 1;
      perBestand.set(o.pad, (perBestand.get(o.pad) ?? 0) + 1);
      console.log(`${b.bestand}@${o.hash.slice(0, 7)}:${b.regel} [${b.patroon}] ${b.fragment}`);
    }
  }
  const commits = (await git(["rev-list", "--all", "--count"])).trim();
  console.log(`scan-historie: ${commits} commits, ${gescand} tekstblobs gescand, ${totaal} bevinding(en) in ${perBestand.size} bestand(en).`);
  return totaal === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (fout) => {
    console.error(`scan-historie: ${fout instanceof Error ? fout.message : String(fout)}`);
    process.exit(2);
  },
);
