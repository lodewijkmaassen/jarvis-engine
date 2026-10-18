import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BOUW = path.join(process.cwd(), "jarvis/interface/app/bouw.mjs");
const HTML = readFileSync(path.join(process.cwd(), "jarvis/interface/v3.html"), "utf8");

describe("de V3-weergave", () => {
  it("leest uitsluitend de doelen en roept uitsluitend de eigenaarsfunctie doel_nieuw aan (T-20261017-jarvis-vereenvoudigen)", () => {
    const views = [...HTML.matchAll(/from\("([a-z0-9_]+)"\)/g)].map((m) => m[1]);
    expect(new Set(views)).toEqual(new Set(["doelen"]));
    const rpcs = new Set([...HTML.matchAll(/rpc\("([a-z0-9_]+)"/g)].map((m) => m[1]));
    expect(rpcs).toEqual(new Set(["doel_nieuw"]));
  });
  it("heeft Projecten als hoofdonderdeel, met Kasboek als eerste project en projectdoelen via de opdrachtregel", () => {
    expect(HTML).toContain('href="#/projecten"');
    expect(HTML).toContain('sleutel: "kasboek"');
    expect(HTML).toContain("Project: ");
    // Projectdoelen blijven uit het algemene Command Center.
    expect(HTML).toContain("filter((d) => !projectVan(d))");
  });
  it("raakt geen V2-document, -tabel of -afleiding", () => {
    for (const verboden of ["documenten", "overzicht/huidig", "regie", "autorisaties", "antwoorden", "berichten"]) {
      expect(HTML, verboden).not.toContain(verboden);
    }
  });
  it("laat tekst uit de database nooit ongeëscaped in de pagina komen", () => {
    // Elke ${…} binnen een template die uit data komt gaat door esc() of lijst().
    const begin = HTML.indexOf("function kaartDoel");
    expect(begin).toBeGreaterThan(0);
    const kaarten = HTML.slice(begin, HTML.indexOf("async function laad"));
    for (const m of kaarten.matchAll(/\$\{([^}]+)\}/g)) {
      const e = m[1]!.trim();
      if (/^(esc|pr)\b/.test(e) || /^esc\(/.test(e)) continue; // pr is zelf uit esc() opgebouwd
      if (/^d\.uitkomst \?/.test(e)) continue; // voorwaarde die zelf esc() aanroept
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
  it("is installeerbaar als PWA: eigen manifest op /v3/, service worker, iconen en koppelingen in de pagina", () => {
    const doel = mkdtempSync(path.join(tmpdir(), "jarvis-v3-pwa-"));
    const r = spawnSync("node", [BOUW, doel, "--url", "https://x.invalid", "--sleutel", "sb_publishable_x", "--merk", "deadbeef"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const manifest = JSON.parse(readFileSync(path.join(doel, "v3", "manifest.webmanifest"), "utf8"));
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/v3/");
    expect(manifest.scope).toBe("/v3/");
    const maten = manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}/${i.purpose}`);
    expect(maten).toEqual(expect.arrayContaining(["192x192/any", "512x512/any", "512x512/maskable"]));
    for (const i of manifest.icons) expect(existsSync(path.join(doel, i.src.replace(/^\//, "")))).toBe(true);
    expect(existsSync(path.join(doel, "v3", "sw.js"))).toBe(true);
    expect(HTML).toContain('<link rel="manifest" href="/v3/manifest.webmanifest">');
    expect(HTML).toContain('navigator.serviceWorker.register("/v3/sw.js", { scope: "/v3/" })');
  });
});
