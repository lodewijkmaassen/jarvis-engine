/**
 * Web Intelligence V1 (D-20261124-200610788): de bronnen van een sparbeurt verschijnen in het Command Center als
 * aanklikbare links, met het aantal zoekopdrachten en de kosten. De echte functie uit v3.html wordt uitgevoerd.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(path.join(process.cwd(), "jarvis/interface/v3.html"), "utf8");

/** Knipt één regel-declaratie of functie op het hoogste niveau van het script uit de pagina. */
function declaratie(naam: string): string {
  const begin = html.search(new RegExp(`\\n  (const ${naam} =|function ${naam}\\()`));
  if (begin < 0) throw new Error(`${naam} niet gevonden`);
  const start = begin + 1;
  if (html.startsWith(`  const ${naam} =`, start)) return html.slice(start, html.indexOf(";\n", start) + 1);
  let diepte = 0;
  for (let i = html.indexOf("{", start); i < html.length; i += 1) {
    if (html[i] === "{") diepte += 1;
    if (html[i] === "}") diepte -= 1;
    if (diepte === 0) return html.slice(start, i + 1);
  }
  throw new Error(`${naam} niet afgesloten`);
}

const bronnenHtml = new Function(`${declaratie("esc")}\n${declaratie("WEBLINK")}\n${declaratie("bronnenHtml")}\nreturn bronnenHtml;`)() as (b: object, k?: number | null) => string;

describe("v3: bronnen van een sparbeurt", () => {
  it("toont webbronnen als links die in een nieuw venster openen, met zoekopdrachten en kosten", () => {
    const uit = bronnenHtml({ geheugen: [{ id: "1", categorie: "besluit" }], doelen: [], web: { beschikbaar: true, zoekopdrachten: ["weer Ede morgen"], opgehaald: [], bronnen: [{ url: "https://www.knmi.nl/x?a=1&b=2", titel: "KNMI <verwachting>", datum: "24 nov" }] } }, 0.0312);
    expect(uit).toContain("Geraadpleegd: 1× besluit · web: 1 zoekopdracht · kosten $0.0312");
    expect(uit).toContain('<a href="https://www.knmi.nl/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">KNMI &lt;verwachting&gt;</a> <span>(24 nov)</span>');
  });
  it("maakt van een adres dat geen http(s) is geen link", () => {
    const uit = bronnenHtml({ web: { zoekopdrachten: ["x"], bronnen: [{ url: "javascript:alert(1)", titel: "kwaad" }] } });
    expect(uit).not.toContain("javascript:");
    expect(uit).not.toContain("<ol");
  });
  it("zonder web blijft het zoals het was, en een geweigerd web wordt genoemd", () => {
    expect(bronnenHtml({ geheugen: [], doelen: [{ project: "p", ids: ["a", "b"] }] })).toBe('<div class="klein">Geraadpleegd: 2 doelen van p</div>');
    expect(bronnenHtml({ web: { beschikbaar: false, zoekopdrachten: [], bronnen: [] } })).toContain("web niet beschikbaar");
  });
});
