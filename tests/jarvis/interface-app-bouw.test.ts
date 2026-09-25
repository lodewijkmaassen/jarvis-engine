/**
 * De bouw van de eigen app mag geen uitrol opleveren die geen gegevens toont.
 *
 * Dat is één keer gebeurd: `config.js` ontbrak in de doelmap, `bouw.mjs` meldde
 * dat met een waarschuwing en eindigde met 0, en de uitrol ging door. De pagina
 * in productie toonde daarna "geen gegevens — open dit op claude.ai of als
 * eigen app", wat naar de verkeerde oorzaak wijst: dit wás de eigen app.
 *
 * Twee vangrails, elk op de plek waar het misging: de bouw faalt, en de pagina
 * noemt de echte reden.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BOUW = path.join(process.cwd(), "jarvis/interface/app/bouw.mjs");

function bouw(args: readonly string[]): { code: number; uit: string } {
  try {
    const uit = execFileSync("node", [BOUW, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, uit };
  } catch (fout) {
    const f = fout as { status?: number; stdout?: string; stderr?: string };
    return { code: f.status ?? 1, uit: `${f.stdout ?? ""}${f.stderr ?? ""}` };
  }
}

const verse = () => mkdtempSync(path.join(tmpdir(), "jarvis-bouw-"));

describe("bouw.mjs", () => {
  it("weigert te bouwen zonder config.js, en schrijft dan niets", () => {
    const doel = verse();
    const r = bouw([doel]);
    expect(r.code, "een uitrol zonder bron hoort te falen").toBe(1);
    expect(r.uit).toContain("config.js");
    // Niets geschreven: een halve doelmap is erger dan een lege, want
    // `vercel --prod` zou hem alsnog uitrollen.
    expect(existsSync(path.join(doel, "index.html"))).toBe(false);
  });

  it("bouwt wel met --url en --sleutel, en schrijft een config.js die de pagina leest", () => {
    const doel = verse();
    const r = bouw([doel, "--url", "https://voorbeeld.supabase.co", "--sleutel", "sb_publishable_test"]);
    expect(r.code).toBe(0);
    expect(existsSync(path.join(doel, "index.html"))).toBe(true);
    const cfg = readFileSync(path.join(doel, "config.js"), "utf8");
    expect(cfg).toContain("window.JARVIS_SUPABASE");
    expect(cfg).toContain("https://voorbeeld.supabase.co");
    expect(cfg).toContain("sb_publishable_test");
  });

  it("ontsnapt de waarden, zodat een aanhalingsteken geen kapot bestand geeft", () => {
    const doel = verse();
    bouw([doel, "--url", 'https://x.co/"\n//', "--sleutel", "a'b"]);
    const cfg = readFileSync(path.join(doel, "config.js"), "utf8");
    // Geldig JavaScript: uitvoerbaar zonder dat de tekst de regel breekt.
    const zicht: Record<string, unknown> = {};
    new Function("window", cfg)(zicht);
    expect((zicht.JARVIS_SUPABASE as { url: string }).url).toBe('https://x.co/"\n//');
    expect((zicht.JARVIS_SUPABASE as { key: string }).key).toBe("a'b");
  });

  it("laat een bestaande config.js staan en overschrijft hem niet", () => {
    const doel = verse();
    writeFileSync(path.join(doel, "config.js"), "window.JARVIS_SUPABASE = { url: 'eigen', key: 'eigen' };\n", "utf8");
    const r = bouw([doel]);
    expect(r.code).toBe(0);
    expect(readFileSync(path.join(doel, "config.js"), "utf8")).toContain("eigen");
  });

  it("eist --url en --sleutel samen", () => {
    const doel = verse();
    expect(bouw([doel, "--url", "https://x.supabase.co"]).code).toBe(2);
    expect(bouw([doel, "--sleutel", "sb_publishable_x"]).code).toBe(2);
  });
});

describe("de pagina noemt een ontbrekende config.js bij naam", () => {
  const html = readFileSync(path.join(process.cwd(), "jarvis/interface/jarvis.html"), "utf8");

  it("zet een vlag wanneer config.js niet laadt", () => {
    // `onerror="void 0"` slikte de fout door; dan is een ontbrekende config
    // niet te onderscheiden van "geen eigen app".
    expect(html).toMatch(/<script src="config\.js" onerror="window\.JARVIS_CONFIG_ONTBREEKT = true">/);
  });

  it("geeft per oorzaak een eigen tekst", () => {
    const m = /function geenBronTekst\(\) \{([\s\S]*?)\n\}/.exec(html);
    expect(m, "geenBronTekst is niet gevonden").not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function("window", `${m![0]}\nreturn geenBronTekst();`);
    const metConfig = fn({ JARVIS_CONFIG_ONTBREEKT: true }) as string;
    const zonder = fn({}) as string;
    expect(metConfig).toContain("config.js");
    expect(metConfig).not.toBe(zonder);
    expect(zonder).toContain("claude.ai");
  });
});
