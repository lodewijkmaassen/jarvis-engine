import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BOUW = path.join(process.cwd(), "jarvis/interface/app/bouw.mjs");
const HTML = readFileSync(path.join(process.cwd(), "jarvis/interface/v3.html"), "utf8");

describe("de V3-weergave", () => {
  it("zet onder de titel Recente activiteit de subtiele tekst 'Laatste activiteit van Jarvis' (D-20261020-185350597)", () => {
    expect(HTML).toContain('<h2>Recente activiteit</h2><div class="subtekst">Laatste activiteit van Jarvis</div>');
    expect(HTML).toMatch(/\.subtekst \{[^}]*color:var\(--gedempt\)/);
  });
  it("leest uitsluitend de doelen en roept uitsluitend de eigenaarsfuncties voor doelen aan (T-20261017-jarvis-vereenvoudigen, D-20261019-202736404)", () => {
    const views = [...HTML.matchAll(/from\("([a-z0-9_]+)"\)/g)].map((m) => m[1]);
    expect(new Set(views)).toEqual(new Set(["doelen"]));
    const rpcs = new Set([...HTML.matchAll(/rpc\("([a-z0-9_]+)"/g)].map((m) => m[1]));
    expect(rpcs).toEqual(new Set(["doel_nieuw", "doel_reageer", "doel_sluit"]));
  });
  it("geeft een vastgelopen doel een reactieveld, 'Reageer en hervat' en 'Sluiten' (D-20261019-202736404)", () => {
    // Sluiten alleen bij een vastgelopen doel.
    expect(HTML).toContain('d.status === "vast" ? `<button data-actie="sluit">Sluiten</button>`');
    expect(HTML).toContain('data-actie="reageer">${knop}</button>');
    expect(HTML).toContain('"Reageer en hervat"');
    expect(HTML).toContain('rpc("doel_reageer", { p_id: id, p_reactie: reactie })');
    expect(HTML).toContain('rpc("doel_sluit", { p_id: id })');
  });
  it("houdt kaarten compact tot ze worden aangeklikt; dan komen details, reactieveld en knoppen (D-20261020-190814438)", () => {
    expect(HTML).toContain('${(open ? doelActies(d) : "")}');
    expect(HTML).toContain('data-actie="open" aria-expanded="${esc(open)}"');
    expect(HTML).not.toContain('vastActies');
    expect(HTML).toContain('if (geopend.has(wie)) geopend.delete(wie); else geopend.add(wie);');
  });
  it("legt de databasekant van reageren op elk doel vast in het dossier (D-20261020-190814438)", () => {
    const sql = readFileSync(path.join(process.cwd(), "tasks/D-20261020-190814438/0001_reageren_op_elk_doel.sql"), "utf8");
    expect(sql).toContain("create or replace function jarvis.doel_reageer(p_id text, p_reactie text)");
    expect(sql).toContain("if not jarvis.v3_is_eigenaar()");
    expect(sql).toContain("d.status in ('vast', 'klaar', 'gesloten')");
    expect(sql).toContain("old.status in ('vast', 'klaar', 'gesloten') and new.status = 'open'");
    expect(sql).toContain("grant execute on function jarvis.doel_reageer(text, text) to authenticated");
  });
  it("toont klaar en gesloten ingeklapt, met uitklapknop en 10 doelen per pagina (D-20261020-203341354)", () => {
    expect(HTML).toContain("const PER_PAGINA = 10;");
    expect(HTML).toContain('inklapBlok("cc:klaar", "Klaar", klaar,');
    expect(HTML).toContain('inklapBlok(ctx + ":gesloten", "Gesloten", gesloten, "")');
    const bron = /(function inklapBlok[\s\S]*?\n  \})\n/.exec(HTML)?.[1];
    expect(bron).toBeTruthy();
    const bouw = new Function("uitgeklapt", "paginas", "PER_PAGINA", "esc", "lijst", `${bron}; return inklapBlok;`);
    const uitgeklapt = new Set<string>();
    const paginas: Record<string, number> = {};
    const lijst = (arr: unknown[]) => `[${arr.length}]`;
    const inklap = bouw(uitgeklapt, paginas, 10, (t: unknown) => String(t), lijst) as (k: string, t: string, a: number[], l: string) => string;
    const doelen = Array.from({ length: 25 }, (_, i) => i);
    expect(inklap("x", "Klaar", doelen, "")).not.toContain("[");
    uitgeklapt.add("x");
    expect(inklap("x", "Klaar", doelen, "")).toContain("[10]");
    expect(inklap("x", "Klaar", doelen, "")).toContain("Pagina 1 van 3");
    paginas.x = 2;
    expect(inklap("x", "Klaar", doelen, "")).toContain("[5]");
    paginas.x = 9;
    inklap("x", "Klaar", doelen, "");
    expect(paginas.x).toBe(2);
    expect(inklap("x", "Klaar", doelen.slice(0, 10), "")).not.toContain("Pagina");
  });
  it("telt een gesloten doel niet als lopend, vastgelopen of klaar (D-20261019-202736404)", () => {
    const bron = /const splits = (\(doelen\) => \(\{[\s\S]*?\}\));/.exec(HTML)?.[1];
    expect(bron).toBeTruthy();
    const splits = new Function(`return ${bron};`)() as (d: { status: string }[]) => Record<string, { status: string }[]>;
    const t = splits(["open", "bezig", "review", "samengevoegd", "klaar", "vast", "gesloten"].map((status) => ({ status })));
    expect(t.lopend!.map((d) => d.status)).toEqual(["open", "bezig", "review", "samengevoegd"]);
    expect(t.vast!.map((d) => d.status)).toEqual(["vast"]);
    expect(t.klaar!.map((d) => d.status)).toEqual(["klaar"]);
    expect(t.gesloten!.map((d) => d.status)).toEqual(["gesloten"]);
  });
  it("legt de databasekant vast in het dossier: status gesloten, doel_reageer, doel_sluit en een herstart (D-20261019-202736404)", () => {
    const sql = readFileSync(path.join(process.cwd(), "tasks/D-20261019-202736404/0001_vast_reageren_sluiten.sql"), "utf8");
    expect(sql).toContain("'vast', 'gesloten'");
    for (const f of ["doel_reageer(p_id text, p_reactie text)", "doel_sluit(p_id text)"]) expect(sql).toContain(`create or replace function jarvis.${f}`);
    // Beide alleen voor de eigenaar en alleen vanuit 'vast'.
    expect(sql.match(/if not jarvis\.v3_is_eigenaar\(\)/g)).toHaveLength(2);
    expect(sql.match(/if d\.status <> 'vast'/g)).toHaveLength(2);
    expect(sql).toContain("when (old.status = 'vast' and new.status = 'open')");
    expect(sql).toContain("execute function jarvis.doel_start()");
  });
  it("heeft Projecten als hoofdonderdeel, met Kasboek als eerste project en projectdoelen via de opdrachtregel", () => {
    expect(HTML).toContain('href="#/projecten"');
    expect(HTML).toContain('sleutel: "kasboek"');
    expect(HTML).toContain("Project: ");
    // Projectdoelen blijven uit het algemene Command Center.
    expect(HTML).toContain("filter((d) => !projectVan(d))");
  });
  it("heeft ToVas Flow als project met de drie subprojecten van de eigenaar (D-20261019-151236935)", () => {
    expect(HTML).toContain('sleutel: "tovas-flow", naam: "ToVas Flow"');
    for (const [sleutel, naam] of [
      ["gemiste-oproepen", "Gemiste oproepen"],
      ["offerte-opvolging", "Offerte opvolging"],
      ["reviews-verzamelen", "Reviews verzamelen"],
    ]) {
      expect(HTML).toContain(`sleutel: "${sleutel}", naam: "${naam}"`);
    }
    // Een subproject heeft een eigen pagina en een eigen invoer met het label <project>/<subproject>.
    expect(HTML).toContain("weergaveSubproject(project, sub)");
    expect(HTML).toContain('label: p.sleutel + "/" + sp.sleutel');
  });
  it("wijst een doel toe aan project of subproject via de eerste regel van de opdracht", () => {
    const regel = /const projectVan = (\(d\) => \{.*?\});/.exec(HTML)?.[1];
    expect(regel).toBeTruthy();
    const projectVan = new Function(`return ${regel};`)() as (d: { opdracht: string }) => string | null;
    expect(projectVan({ opdracht: "Project: kasboek\n\nIets" })).toBe("kasboek");
    expect(projectVan({ opdracht: "Project: tovas-flow/offerte-opvolging\n\nIets" })).toBe("tovas-flow/offerte-opvolging");
    expect(projectVan({ opdracht: "Project: tovas-flow\n\nIets" })).toBe("tovas-flow");
    expect(projectVan({ opdracht: "Geen project" })).toBeNull();
    expect(projectVan({ opdracht: "Project: a/b/c\n" })).toBeNull();
    // Het projectoverzicht telt de doelen van de subprojecten mee.
    expect(HTML).toContain('(plek ?? "").startsWith(p.sleutel + "/")');
  });
  it("toont het Command Center als HUD-dashboard met vaste zijbalk, AI Core, recente activiteit en de bestaande panelen (D-20261019-220029150)", () => {
    for (const deel of ['class="zijbalk"', "Jarvis AI Core", "Recente activiteit", 'class="dashboard"', "statustegel"]) expect(HTML, deel).toContain(deel);
    for (const naam of ["Lopend", "Vastgelopen", "Klaar", "Gesloten"]) expect(HTML, naam).toContain(`"${naam}")`);
    // Geen nieuwe modules uit het voorbeeld.
    for (const verboden of ["Agents", "Kalender", "Memory", "Voice", "System Monitor", "Knowledge Base"]) expect(HTML, verboden).not.toContain(verboden);
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
