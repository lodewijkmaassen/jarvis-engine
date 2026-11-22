import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HTML = readFileSync(path.join(process.cwd(), "jarvis/interface/v3.html"), "utf8");

// D-20261121-235758541: een reactie van Jarvis met één knop kopiëren, delen of laten voorlezen.
describe("Reactie delen in de V3-chat", () => {
  const bron = /(function reactieKnoppen\(i, delen, voorlezen\) \{[\s\S]*?\n {2}\})\n/.exec(HTML)?.[1];
  const maak = (voorleesIndex: number | null) =>
    new Function("voorleesIndex", `${bron}; return reactieKnoppen;`)(voorleesIndex) as (
      i: number,
      delen: boolean,
      voorlezen: boolean,
    ) => string;

  it("toont onder elke reactie van Jarvis de knoppen, niet onder die van de eigenaar", () => {
    expect(HTML).toContain('if (b.rol !== "jij" && reactieTekst(b)) extra += reactieKnoppen(chat.indexOf(b), kanDelen(), kanVoorlezen());');
  });

  it("kopiëren staat er altijd; delen en voorlezen alleen als de browser het kan", () => {
    expect(bron).toBeTruthy();
    const knoppen = maak(null);
    const kaal = knoppen(3, false, false);
    expect(kaal).toContain('data-reactie="kopieer" data-i="3"');
    expect(kaal).not.toContain('data-reactie="deel"');
    expect(kaal).not.toContain('data-reactie="voorlees"');
    const alles = knoppen(3, true, true);
    expect(alles).toContain('data-reactie="deel" data-i="3"');
    expect(alles).toContain('data-reactie="voorlees" data-i="3" aria-pressed="false"');
    expect(alles).toContain("🔊 Lees voor");
  });

  it("de voorleesknop wordt een stopknop zolang die reactie wordt voorgelezen", () => {
    const knoppen = maak(2);
    expect(knoppen(2, false, true)).toContain('aria-pressed="true"');
    expect(knoppen(2, false, true)).toContain("⏹ Stop");
    expect(knoppen(1, false, true)).toContain('aria-pressed="false"');
  });

  it("gebruikt de klembord-API met terugval, de Web Share API en Nederlandse spraaksynthese", () => {
    expect(HTML).toContain("await navigator.clipboard.writeText(tekst)");
    expect(HTML).toContain('document.execCommand("copy")');
    expect(HTML).toContain('await navigator.share({ title: "Reactie van Jarvis", text: tekst })');
    expect(HTML).toContain('u.lang = "nl-NL";');
    expect(HTML).toContain('typeof navigator.share === "function"');
  });

  it("de klik loopt via het chatlogboek en een nieuw gesprek stopt het voorlezen", () => {
    expect(HTML).toContain('const r = ev.target.closest("[data-reactie]");');
    expect(HTML).toContain("if (voorleesIndex !== null) { window.speechSynthesis.cancel(); voorleesIndex = null; }");
  });
});
