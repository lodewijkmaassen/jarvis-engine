import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HTML = readFileSync(path.join(process.cwd(), "jarvis/interface/v3.html"), "utf8");

// D-20261121-092556439: ook bij "Nieuw doel" meerdere afbeeldingen en bestanden kunnen toevoegen.
describe("Bijlagen bij een nieuw doel", () => {
  it("het formulier Nieuw doel heeft een bijlageknop die meerdere bestanden tegelijk accepteert", () => {
    const blok = /function invoerBlok\(plek\) \{([\s\S]*?)\n  \}/.exec(HTML)?.[1] ?? "";
    expect(blok).toMatch(/<input type="file" id="nbestand" multiple accept="[^"]*image\/png[^"]*application\/pdf[^"]*text\/\*/);
    expect(blok).toContain('id="nbijlage"');
    expect(blok).toContain('id="nvoorbeeld"');
  });

  it("de knop opent de bestandskiezer en slepen en plakken werken ook", () => {
    expect(HTML).toContain("knop.onclick = () => invoer.click();");
    expect(HTML).toContain("kiesDoelBestanden(ev.target.files)");
    expect(HTML).toContain("kiesDoelBestanden(ev.dataTransfer.files)");
    expect(HTML).toMatch(/koppelInvoer\(plek\) \{\s*koppelSpraak\(\);\s*koppelDoelBijlagen\(\);/);
  });

  it("de opdracht noemt alle bijlagen en neemt tekstbestanden letterlijk op", () => {
    const bron = /(function doelBijlageDeel\(lijst\) \{[\s\S]*?\n  \})/.exec(HTML)?.[1];
    expect(bron).toBeTruthy();
    const deel = new Function(`${bron}; return doelBijlageDeel;`)() as (l: unknown[]) => string;
    expect(deel([])).toBe("");
    const uit = deel([
      { soort: "afbeelding", naam: "scherm.png", data: "x" },
      { soort: "pdf", naam: "offerte.pdf", data: "y" },
      { soort: "tekst", naam: "notitie.txt", tekst: "regel één" },
    ]);
    expect(uit).toContain("Bijlagen van de eigenaar (3):\n- scherm.png\n- offerte.pdf\n- notitie.txt");
    expect(uit).toContain("--- Inhoud van notitie.txt ---\nregel één\n--- Einde van notitie.txt ---");
    expect(uit).toContain('context.kanaal = "bijlagen"');
    expect(deel([{ soort: "tekst", naam: "a.md", tekst: "t" }])).not.toContain("kanaal");
  });

  it("afbeeldingen en PDF's gaan als verwerkt bericht met het doel-id mee, buiten elke wachtrij", () => {
    const koppel = /function koppelInvoer\(plek\) \{([\s\S]*?)\n  \}/.exec(HTML)?.[1] ?? "";
    expect(koppel).toContain('const id = await rpc("doel_nieuw"');
    expect(koppel).toContain('status: "verwerkt"');
    expect(koppel).toContain('context: { kanaal: "bijlagen", doel: id, bijlagen: binair }');
    expect(koppel).toContain('x.soort !== "tekst"');
  });

  it("de pagina laadt die zware bijlageberichten niet mee in de berichtenlijst", () => {
    expect(HTML).toContain('.or("context->>kanaal.is.null,context->>kanaal.not.in.(brein,bijlagen)")');
  });

  it("de chat houdt dezelfde grenzen via de gedeelde toevoeging", () => {
    expect(HTML).toContain('voegBijlagenToe(chatBijlagen, bestanden, "bericht")');
    expect(HTML).toContain('voegBijlagenToe(doelBijlagen, bestanden, "doel")');
  });
});
