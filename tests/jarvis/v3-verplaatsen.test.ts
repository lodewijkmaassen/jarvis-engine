import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HTML = readFileSync(path.join(process.cwd(), "jarvis/interface/v3.html"), "utf8");

type Project = { sleutel: string; naam: string; subprojecten?: Project[] };
type Doel = { id: string; opdracht?: string };
const blok = /\/\/ verplaatsen:begin\n([\s\S]*?)\/\/ verplaatsen:einde/.exec(HTML)?.[1] ?? "";
const { bouwVerplaatsingen, plekVan, plekKeuzes } = new Function(`${blok}; return { bouwVerplaatsingen, plekVan, plekKeuzes };`)() as {
  bouwVerplaatsingen: (berichten: unknown[], objectVan: (c: unknown) => Record<string, unknown>) => Map<string, string | null>;
  plekVan: (d: Doel, plekken: Map<string, string | null>) => string | null;
  plekKeuzes: (projecten: Project[]) => { plek: string; naam: string }[];
};
const objectVan = (c: unknown) => (typeof c === "string" ? JSON.parse(c) : c ?? {});
const zet = (doel: string, plek: unknown, van = "eigenaar") => ({ van, context: { verplaatsing: { doel, plek } } });

// D-20261118-192315736: taken (doelen) verplaatsen naar een project of subproject.
describe("Taken verplaatsen in de V3-weergave", () => {
  it("leest de plek uit de projectregel zolang een doel niet verplaatst is", () => {
    const leeg = new Map<string, string | null>();
    expect(plekVan({ id: "D-1", opdracht: "Project: kasboek\n\nIets" }, leeg)).toBe("kasboek");
    expect(plekVan({ id: "D-2", opdracht: "Project: Tobias-Leert/woordbattle\n\nIets" }, leeg)).toBe("tobias-leert/woordbattle");
    expect(plekVan({ id: "D-3", opdracht: "Gewoon een doel" }, leeg)).toBeNull();
  });

  it("verplaatst naar een project, een subproject of uit elk project, en de jongste verplaatsing wint", () => {
    const plekken = bouwVerplaatsingen([
      zet("D-1", "tobias-leert"),
      zet("D-1", "tobias-leert/woordbattle"),
      zet("D-2", ""),
      { van: "eigenaar", context: JSON.stringify({ verplaatsing: { doel: "D-3", plek: "kasboek" } }) },
    ], objectVan);
    expect(plekVan({ id: "D-1", opdracht: "Project: kasboek\n\nx" }, plekken)).toBe("tobias-leert/woordbattle");
    expect(plekVan({ id: "D-2", opdracht: "Project: kasboek\n\nx" }, plekken)).toBeNull();
    expect(plekVan({ id: "D-3", opdracht: "x" }, plekken)).toBe("kasboek");
    expect(plekVan({ id: "D-4", opdracht: "Project: kasboek\n\nx" }, plekken)).toBe("kasboek");
  });

  it("negeert berichten van Jarvis, ongeldige plekken en berichten zonder verplaatsing", () => {
    const plekken = bouwVerplaatsingen([
      zet("D-1", "kasboek", "jarvis"),
      zet("D-2", "a/b/c"),
      zet("D-3", "Hoofdletters"),
      zet("D-4", null),
      zet("", "kasboek"),
      { van: "eigenaar", context: { idee: true } },
      { van: "eigenaar", context: { projectdef: { sleutel: "tuin", naam: "Tuin" } } },
    ], objectVan);
    expect(plekken.size).toBe(0);
  });

  it("biedt geen project, elk project en elk subproject als keuze", () => {
    const keuzes = plekKeuzes([
      { sleutel: "kasboek", naam: "Kasboek" },
      { sleutel: "tobias-leert", naam: "Tobias Leert", subprojecten: [{ sleutel: "woordbattle", naam: "WoordBattle" }] },
    ]);
    expect(keuzes.map((k) => k.plek)).toEqual(["", "kasboek", "tobias-leert", "tobias-leert/woordbattle"]);
    expect(keuzes[3].naam).toBe("Tobias Leert · WoordBattle");
  });

  it("bewaart een verplaatsing als verwerkt bericht en past haar toe bij elke verversing", () => {
    expect(HTML).toContain('verwerking: "Verplaatsing door de eigenaar; geen opdracht.", context: { verplaatsing: { doel: id, plek } } }');
    expect(HTML).toContain("verplaatst = bouwVerplaatsingen(berichten, objectVan);");
    expect(HTML).toContain("const projectVan = (d) => plekVan(d, verplaatst);");
    expect(HTML).toContain('<button data-actie="verplaats">Verplaats</button>');
  });
});
