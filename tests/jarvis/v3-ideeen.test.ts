import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HTML = readFileSync(path.join(process.cwd(), "jarvis/interface/v3.html"), "utf8");

// D-20261117-194518764: een categorie "Ideeën" onder Command Center en Projecten.
describe("Ideeën in de V3-weergave", () => {
  it("staat in de hoofdnavigatie direct onder Command Center en Projecten", () => {
    const nav = /<nav aria-label="Hoofdnavigatie">([\s\S]*?)<\/nav>/.exec(HTML)?.[1] ?? "";
    const labels = [...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
    expect(labels).toEqual(["Command Center", "Projecten", "Ideeën"]);
    expect(nav).toContain('href="#/ideeen" id="nav-id"');
  });

  it("route #/ideeen toont de ideeënpagina en markeert de navigatie", () => {
    expect(HTML).toContain('if (deel === "ideeen") weergaveIdeeen();');
    expect(HTML).toContain('deel === "ideeen" ? "id"');
    expect(HTML).toContain('for (const n of ["nav-cc", "nav-pr", "nav-id"])');
  });

  it("bewaart een idee als verwerkt bericht van de eigenaar, zodat geen wachtrij het als opdracht oppakt", () => {
    expect(HTML).toContain('client.from("berichten").insert({ van: "eigenaar", tekst, status: "verwerkt"');
    expect(HTML).toContain("context: { idee: true");
  });

  it("filtert ideeën uit de berichten en scheidt open van omgezet of gearchiveerd", () => {
    const bron = /(const ideeen = [^\n]*\n\s*const ideeOpen = [^\n]*)\n/.exec(HTML)?.[1];
    expect(bron).toBeTruthy();
    const maak = new Function("berichten", "objectVan", `${bron}; return { ideeen, ideeOpen };`);
    const objectVan = (c: unknown) => (typeof c === "string" ? JSON.parse(c) : c ?? {});
    const berichten = [
      { id: "1", van: "eigenaar", tekst: "a", context: { idee: true } },
      { id: "2", van: "eigenaar", tekst: "b", context: '{"idee":true,"gearchiveerd":true}' },
      { id: "3", van: "eigenaar", tekst: "c", context: { idee: true, doel: "D-1" } },
      { id: "4", van: "eigenaar", tekst: "gewoon bericht", context: {} },
      { id: "5", van: "jarvis", tekst: "x", context: { idee: true } },
    ];
    const { ideeen, ideeOpen } = maak(berichten, objectVan);
    const alle = ideeen();
    expect(alle.map((b: { id: string }) => b.id)).toEqual(["3", "2", "1"]);
    expect(alle.filter(ideeOpen).map((b: { id: string }) => b.id)).toEqual(["1"]);
  });

  it("maakt pas met een expliciete knop en bevestiging een doel van een idee, via doel_nieuw", () => {
    expect(HTML).toContain('data-idee="doel">Maak er een doel van</button>');
    expect(HTML).toContain('confirm("Van dit idee een doel maken? Jarvis gaat het dan bouwen.")');
    expect(HTML).toContain('await rpc("doel_nieuw", { p_titel: titel, p_opdracht: b.tekst, p_acceptatie_url: null })');
    expect(HTML).toContain('client.from("berichten").update({ context: nieuw }).eq("id", b.id)');
  });
});
