import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BOUW = path.join(process.cwd(), "jarvis/interface/app/bouw.mjs");
const HTML = readFileSync(path.join(process.cwd(), "jarvis/interface/v3.html"), "utf8");

describe("de V3-weergave", () => {
  it("leest uitsluitend de V3-views en roept uitsluitend eigenaarsfuncties aan", () => {
    const views = [...HTML.matchAll(/from\("([a-z0-9_]+)"\)/g)].map((m) => m[1]);
    expect(new Set(views)).toEqual(new Set(["v3_voor_jou", "v3_actueel"]));
    const rpcs = new Set([...HTML.matchAll(/rpc\("([a-z0-9_]+)"/g)].map((m) => m[1]));
    expect(rpcs).toEqual(new Set(["v3_nieuwe_opdracht", "v3_geef_mandaat", "v3_wijs_af", "v3_beantwoord"]));
  });
  it("raakt geen V2-document, -tabel of -afleiding", () => {
    for (const verboden of ["documenten", "overzicht/huidig", "regie", "autorisaties", "antwoorden", "berichten"]) {
      expect(HTML, verboden).not.toContain(verboden);
    }
  });
  it("laat tekst uit de database nooit ongeëscaped in de pagina komen", () => {
    // Elke ${…} binnen een template die uit data komt gaat door esc() of lijst().
    const kaarten = HTML.slice(HTML.indexOf("function kaartVoorJou"), HTML.indexOf("async function laad"));
    for (const m of kaarten.matchAll(/\$\{([^}]+)\}/g)) {
      const e = m[1]!.trim();
      if (/^(esc|lijst|voorstelHtml|opties\.map|t\.eindcontrole\.map|klaar|eind)\b/.test(e) || /^esc\(/.test(e)) continue;
      if (/^(\(|\w+ \? )/.test(e)) continue; // voorwaarden die zelf esc() aanroepen
      expect(e, `onbeschermde invoeging: ${e}`).toMatch(/esc\(/);
    }
  });
  it("wordt door de bouw op /v3/ gezet, met het bouwmerk en dezelfde config.js", () => {
    const doel = mkdtempSync(path.join(tmpdir(), "jarvis-v3-"));
    const r = spawnSync("node", [BOUW, doel, "--url", "https://x.invalid", "--sleutel", "sb_publishable_x", "--merk", "deadbeef"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const pagina = readFileSync(path.join(doel, "v3", "index.html"), "utf8");
    expect(pagina).toContain('<meta name="jarvis-bouwmerk" content="deadbeef">');
    expect(pagina).toContain('src="../config.js"');
    expect(existsSync(path.join(doel, "config.js"))).toBe(true);
    expect(existsSync(path.join(doel, "index.html"))).toBe(true); // V2-weergave intact
  });
});
