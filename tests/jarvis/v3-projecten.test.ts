import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HTML = readFileSync(path.join(process.cwd(), "jarvis/interface/v3.html"), "utf8");

type Def = { sleutel: string; naam: string; omschrijving?: string; repo?: string; subprojecten?: Def[] };
const blok = /\/\/ projecten:begin\n([\s\S]*?)\/\/ projecten:einde/.exec(HTML)?.[1] ?? "";
const { sleutelVan, bouwProjecten } = new Function(`${blok}; return { sleutelVan, bouwProjecten };`)() as {
  sleutelVan: (naam: string) => string;
  bouwProjecten: (vast: Def[], berichten: unknown[], objectVan: (c: unknown) => Record<string, unknown>) => Def[];
};
const objectVan = (c: unknown) => (typeof c === "string" ? JSON.parse(c) : c ?? {});
const vast: Def[] = [
  { sleutel: "kasboek", naam: "Kasboek", omschrijving: "k" },
  { sleutel: "tobias-leert", naam: "Tobias Leert", omschrijving: "t", subprojecten: [{ sleutel: "woordbattle", naam: "WoordBattle" }] },
];
const def = (projectdef: Record<string, unknown>, van = "eigenaar") => ({ van, context: { projectdef } });

// D-20261117-194904457: nieuwe projecten aanmaken, en bij een bestaand project meerdere subprojecten.
describe("Projecten aanmaken in de V3-weergave", () => {
  it("maakt een sleutel die past bij de projectregel van een doel", () => {
    expect(sleutelVan("Mijn Café Project!")).toBe("mijn-cafe-project");
    expect(sleutelVan("  ")).toBe("");
    expect(sleutelVan("Één/twee")).toBe("een-twee");
  });

  it("voegt aangemaakte projecten toe na de vaste, zonder de vaste lijst te veranderen", () => {
    const lijst = bouwProjecten(vast, [def({ sleutel: "tuin", naam: "Tuin", omschrijving: "De tuin", repo: "a/b" })], objectVan);
    expect(lijst.map((p) => p.sleutel)).toEqual(["kasboek", "tobias-leert", "tuin"]);
    expect(lijst[2]).toEqual({ sleutel: "tuin", naam: "Tuin", omschrijving: "De tuin", repo: "a/b", subprojecten: [] });
    expect(vast[1].subprojecten).toHaveLength(1);
  });

  it("voegt meerdere subprojecten toe aan een vast én aan een aangemaakt project", () => {
    const lijst = bouwProjecten(vast, [
      def({ sleutel: "rekenen", naam: "Rekenen", ouder: "tobias-leert" }),
      def({ sleutel: "lezen", naam: "Lezen", ouder: "tobias-leert" }),
      def({ sleutel: "tuin", naam: "Tuin" }),
      { van: "eigenaar", context: JSON.stringify({ projectdef: { sleutel: "moestuin", naam: "Moestuin", ouder: "tuin" } }) },
    ], objectVan);
    expect(lijst.find((p) => p.sleutel === "tobias-leert")?.subprojecten?.map((s) => s.sleutel)).toEqual(["woordbattle", "rekenen", "lezen"]);
    expect(lijst.find((p) => p.sleutel === "tuin")?.subprojecten?.map((s) => s.sleutel)).toEqual(["moestuin"]);
    expect(vast[1].subprojecten?.map((s) => s.sleutel)).toEqual(["woordbattle"]);
  });

  it("negeert dubbele sleutels, onbekende ouders, ongeldige sleutels en berichten van Jarvis", () => {
    const lijst = bouwProjecten(vast, [
      def({ sleutel: "kasboek", naam: "Ander kasboek" }),
      def({ sleutel: "woordbattle", naam: "Dubbel", ouder: "tobias-leert" }),
      def({ sleutel: "x", naam: "Wees", ouder: "bestaat-niet" }),
      def({ sleutel: "a/b", naam: "Fout" }),
      def({ sleutel: "leeg", naam: " " }),
      def({ sleutel: "van-jarvis", naam: "Jarvis" }, "jarvis"),
      { van: "eigenaar", context: { idee: true } },
    ], objectVan);
    expect(lijst.map((p) => p.sleutel)).toEqual(["kasboek", "tobias-leert"]);
    expect(lijst[0].naam).toBe("Kasboek");
    expect(lijst[1].subprojecten?.map((s) => s.naam)).toEqual(["WoordBattle"]);
  });

  it("bewaart een project als verwerkt bericht van de eigenaar en bouwt de lijst opnieuw bij elke verversing", () => {
    expect(HTML).toContain('status: "verwerkt", verwerkt_op: new Date().toISOString(), verwerking: "Project van de eigenaar; geen opdracht.", context: { projectdef } }');
    expect(HTML).toContain("PROJECTEN = bouwProjecten(VASTE_PROJECTEN, berichten, objectVan);");
  });

  it("toont het formulier voor een nieuw project op het overzicht en voor een subproject op de projectpagina", () => {
    expect(HTML).toContain("${projectFormulier(null)}");
    expect(HTML).toContain("koppelProjectFormulier(null);");
    expect(HTML).toContain("extra: extra + projectFormulier(p)");
    expect(HTML).toContain("koppelProjectFormulier(p);");
    expect(HTML).toContain('"Nieuw project"');
    expect(HTML).toContain("Nieuw subproject voor ");
  });
});
